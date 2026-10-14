// Auth + Recuperação de senha (US54) + Cadastro self-service (US20/US34) —
// extraído de index.js (fase 10 da modularização): POST /api/auth/login,
// POST /api/auth/logout, POST /api/auth/esqueci-senha,
// POST /api/auth/redefinir-senha, POST /api/auth/register,
// POST /api/auth/verify-token, POST /api/auth/resend-token.
const bcrypt = require('bcryptjs');
const tokenService = require('../token-service');
const configSistema = require('../lib/configuracoes-sistema');
const { calcularTrialTenant, calcularBloqueioAssinatura } = require('../lib/trial-conta');
const { EMAIL_REGEX, SENHA_REGEX } = require('../lib/validadores');
const { normalizarWhatsapp } = require('../lib/whatsapp');

const REENVIO_COOLDOWN_SEGUNDOS = 60;

// Módulos liberados automaticamente no trial (US77/CA09).
const MODULOS_TRIAL = ['agenda_inteligente', 'financeiro', 'dashboards'];
const TERMOS_VERSAO = '2026-07-22';
const PRIVACIDADE_VERSAO = '2026-07-22';

function registerAuthRoutes(fastify, pool) {
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, senha } = request.body || {};
    if (!email || !senha) {
      return reply.code(400).send({ error: 'E-mail e senha são obrigatórios' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.senha_hash, u.nome, u.token_version, u.email_verified,
              u.role, u.ativo AS usuario_ativo, t.ativo AS tenant_ativo
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    // Acesso de profissional nunca tem senha (login é só por token de
    // convite + sessão longa, ver lib/sessao-profissional.js) — sem esta
    // guarda, bcrypt.compare(senha, null) lança em vez de devolver false,
    // virando 500 em vez de 401 pra uma tentativa de login com esse e-mail.
    if (!usuario.senha_hash) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return reply.code(401).send({ error: 'E-mail ou senha inválidos' });
    }

    // Tenant desativado pela área admin da Kyvvo (US16/CA02) — bloqueia
    // login mesmo com senha correta, em vez de deixar o "desativar" ser só
    // um flag decorativo sem efeito nenhum.
    if (!usuario.tenant_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o suporte da Kyvvo.' });
    }
    // US62 — membro desativado pelo administrador da equipe (distinto do
    // tenant inteiro desativado pela Kyvvo acima).
    if (!usuario.usuario_ativo) {
      return reply.code(403).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }

    const token = fastify.jwt.sign(
      { userId: usuario.id, tenantId: usuario.tenant_id, email: usuario.email, tokenVersion: usuario.token_version },
      { expiresIn: '7d' }
    );

    // email_verified informa ao front se deve redirecionar pra tela de
    // validação (CA10) em vez de entrar direto no portal. role (US62)
    // informa se mostra itens de menu restritos ao administrador.
    return { token, nome: usuario.nome, email: usuario.email, email_verified: usuario.email_verified, role: usuario.role };
  });

  // Checagem de acesso ao módulo "people" (Kyvvo People, produto separado —
  // ver server/panel/index.js#requireModulo) usada pelo backend do Kyvvo
  // People logo após o login acima: reaproveita authenticate+requireModulo
  // sem expor usuarios/tenants a esse outro serviço — só confirma se o
  // tenant do token pode entrar, nada além de tenantId (nome/email o
  // People já tem da resposta do /login).
  fastify.get(
    '/api/auth/people/acesso',
    { preHandler: [fastify.authenticate, fastify.requireModulo('people')] },
    async (request) => ({ tenantId: request.user.tenantId })
  );

  // Invalida o token atual (e qualquer outro emitido antes dele) incrementando
  // token_version: como o JWT é stateless, é essa comparação em `authenticate`
  // que faz o logout ter efeito imediato no servidor, e não só no cliente.
  fastify.post('/api/auth/logout', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query(
      'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1',
      [request.user.userId]
    );
    return { ok: true };
  });

  // Solicita o código de recuperação por e-mail. Sem preHandler: quem
  // esqueceu a senha não tem sessão. Resposta sempre genérica (CA02): não
  // revela se o e-mail existe, senão o endpoint vira um jeito de enumerar
  // contas cadastradas.
  fastify.post('/api/auth/esqueci-senha', async (request, reply) => {
    const email = ((request.body || {}).email || '').toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }

    const respostaGenerica = {
      ok: true,
      message: 'Se este e-mail estiver cadastrado, enviamos um código de recuperação.',
    };

    const { rows } = await pool.query('SELECT id, nome FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    if (!usuario) {
      return respostaGenerica;
    }

    // Mesmo cooldown de 60s do reenvio de verificação de e-mail (CA11) —
    // evita disparar um e-mail novo a cada re-submit do formulário, sem
    // precisar de infra extra de rate limit.
    const { rows: ultimoRows } = await pool.query(
      `SELECT criado_em FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'recuperacao_senha'
       ORDER BY criado_em DESC LIMIT 1`,
      [usuario.id]
    );
    const emCooldown = ultimoRows[0]
      && Date.now() - new Date(ultimoRows[0].criado_em).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000;
    if (emCooldown) {
      return respostaGenerica;
    }

    const codigo = await tokenService.criarToken(pool, { userId: usuario.id, tipo: 'recuperacao_senha' });
    tokenService.enviarPorCanais({ token: codigo, canais: ['email'], email, nome: usuario.nome });

    return respostaGenerica;
  });

  // Confirma o código de 6 dígitos e define a nova senha. Sem preHandler:
  // authenticate — quem está aqui não tem sessão válida (é justamente o
  // caso de esquecer a senha).
  fastify.post('/api/auth/redefinir-senha', async (request, reply) => {
    const { email: emailBruto, token: tokenBruto, senha } = request.body || {};
    const email = (emailBruto || '').toLowerCase().trim();
    const codigo = String(tokenBruto || '').trim();

    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código inválido ou expirado. Solicite um novo.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }

    const mensagens = {
      nao_encontrado: 'Código inválido ou expirado. Solicite um novo.',
      expirado: 'Código expirado. Solicite um novo.',
      bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
      incorreto: 'Código incorreto. Tente novamente.',
    };

    const { rows } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];
    // E-mail não encontrado cai na mesma mensagem de código inválido (CA02)
    // — não revela se a conta existe.
    if (!usuario) {
      return reply.code(400).send({ error: mensagens.nao_encontrado });
    }

    const { valido, motivo } = await tokenService.validate({
      userId: usuario.id,
      tipo: 'recuperacao_senha',
      token: codigo,
    });
    if (!valido) {
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    const hash = await bcrypt.hash(senha, 10);
    // token_version++ derruba qualquer sessão JWT ativa (mesmo efeito do
    // logout) — sessões abertas em outro lugar não devem sobreviver a uma
    // redefinição de senha.
    await pool.query(
      'UPDATE usuarios SET senha_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, usuario.id]
    );

    return { ok: true, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
  });

  fastify.post('/api/auth/register', async (request, reply) => {
    const {
      nome_empresa: nomeEmpresa,
      nome_responsavel: nomeResponsavel,
      email,
      senha,
      segmento_id: segmentoIdBruto,
      telefone: telefoneBruto,
      whatsapp: whatsappBruto,
      aceite_termos: aceiteTermosBruto,
      aceita_marketing: aceitaMarketingBruto,
      plano_slug: planoSlugBruto,
    } = request.body || {};

    const nomeEmpresaLimpo = (nomeEmpresa || '').trim();
    const nomeLimpo = (nomeResponsavel || '').trim();
    const emailLimpo = (email || '').toLowerCase().trim();

    if (nomeEmpresaLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome da empresa.' });
    }
    if (nomeLimpo.length < 2) {
      return reply.code(400).send({ error: 'Informe o nome do responsável.' });
    }
    if (!EMAIL_REGEX.test(emailLimpo)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }
    // US77/CA04 — segmento sai do formulário de cadastro (migra pro
    // onboarding, US82) e passa a ser opcional aqui; sem ele, a conta nasce
    // com onboarding_pendente=true. Continua aceito quando enviado, pra não
    // quebrar nenhum outro chamador que ainda mande o campo.
    let segmentoId = null;
    if (segmentoIdBruto !== undefined && segmentoIdBruto !== null && segmentoIdBruto !== '') {
      segmentoId = parseInt(segmentoIdBruto, 10);
      if (!Number.isInteger(segmentoId)) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
    }
    // Telefone usa a mesma validação/formato do WhatsApp (DDD + número), mas
    // sem checagem de unicidade — diferente do WhatsApp, pode repetir entre
    // contas (CA03 do US34).
    const telefone = normalizarWhatsapp(telefoneBruto);
    if (!telefone) {
      return reply.code(400).send({ error: 'Digite um telefone válido com DDD.' });
    }
    const whatsapp = normalizarWhatsapp(whatsappBruto);
    if (!whatsapp) {
      return reply.code(400).send({ error: 'Digite um número de WhatsApp válido com DDD.' });
    }
    // US79/CA01/CA03 — aceite dos Termos de Uso e da Política de Privacidade
    // é condição pra usar o serviço (não é opcional como o consentimento de
    // marketing) e fica registrado numa trilha de auditoria própria e
    // imutável (CA03). Validado no servidor como rede de segurança — o
    // formulário já bloqueia o envio sem o aceite marcado.
    const aceiteTermos = aceiteTermosBruto === true;
    if (!aceiteTermos) {
      return reply.code(422).send({
        error: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade para criar a conta.',
        erros: { aceite_termos: 'Aceite obrigatório.' },
      });
    }
    const aceitaMarketing = aceitaMarketingBruto === true;

    // Verificação de unicidade antes de criar qualquer registro (CA03).
    const { rows: emailRows } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [emailLimpo]);
    if (emailRows.length > 0) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.' });
    }
    const { rows: whatsappRows } = await pool.query('SELECT 1 FROM tenants WHERE whatsapp = $1', [whatsapp]);
    if (whatsappRows.length > 0) {
      return reply.code(409).send({ error: 'Este número de WhatsApp já está associado a uma conta.' });
    }
    let segmentoSlug = null;
    if (segmentoId !== null) {
      const { rows: segmentoRows } = await pool.query(
        'SELECT slug FROM segmentos WHERE id = $1 AND ativo = true',
        [segmentoId]
      );
      if (!segmentoRows[0]) {
        return reply.code(400).send({ error: 'Selecione um segmento válido.' });
      }
      segmentoSlug = segmentoRows[0].slug;
    }
    // US77/CA04 — sem segmento no cadastro, a conta fica pendente de
    // onboarding (US82 recolhe segmento + nome do negócio depois do login).
    const onboardingPendente = segmentoId === null;

    // US78/CA04 — plano escolhido na landing (?plano=) ou trocado na própria
    // tela de cadastro, pra não perder a referência de preço entre o card e
    // a cobrança. Opcional: sem ele, o tenant nasce sem plano (`'trial'`,
    // igual antes do US78) e escolhe depois no checkout (US32). Aceita tanto
    // o slug atual quanto uma chave legada (mesma resolução do US72), já que
    // o link pode vir de uma página cacheada com o slug antigo.
    let planoChave = null;
    let planoSlugResolvido = null;
    const planoSlugLimpo = typeof planoSlugBruto === 'string' ? planoSlugBruto.trim() : '';
    if (planoSlugLimpo) {
      const { rows: planoRows } = await pool.query(
        'SELECT chave, slug FROM planos WHERE slug = $1 OR chave = $1',
        [planoSlugLimpo]
      );
      if (!planoRows[0]) {
        return reply.code(422).send({ error: 'Plano selecionado inválido.' });
      }
      planoChave = planoRows[0].chave;
      planoSlugResolvido = planoRows[0].slug;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Trial começa imediatamente, antes mesmo da validação do token (CA04).
      // `nome` (nome comercial exibido em "Minha Empresa" e usado pelo bot/IA
      // em toda comunicação com o cliente final) volta a ser coletado no
      // próprio cadastro (nome_empresa), separado do nome do responsável —
      // antes os dois eram o mesmo valor, misturando pessoa física com nome
      // do negócio nas mensagens do WhatsApp. O tenant pode ajustá-lo depois
      // em Minha Empresa (US33).
      const trialExpira = new Date(Date.now() + configSistema.config.trialDias * 24 * 60 * 60 * 1000);
      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, whatsapp, segmento, segmento_id, plano, status, trial_expires_at, onboarding_pendente)
         VALUES ($1, $2, $3, $4, $5, $6, 'trial', $7, $8)
         RETURNING id`,
        [nomeEmpresaLimpo, telefone, whatsapp, segmentoSlug, segmentoId, planoChave || 'trial', trialExpira.toISOString(), onboardingPendente]
      );
      const tenantId = tenantRows[0].id;

      // Libera os módulos do trial (CA09).
      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo)
         SELECT $1, key, true FROM modulos WHERE key = ANY($2::text[])
         ON CONFLICT (tenant_id, modulo_key) DO NOTHING`,
        [tenantId, MODULOS_TRIAL]
      );

      const hash = await bcrypt.hash(senha, 10);
      const { rows: usuarioRows } = await client.query(
        `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, email_verified)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id, token_version`,
        [tenantId, emailLimpo, hash, nomeLimpo]
      );
      const usuarioId = usuarioRows[0].id;

      // US79/CA03 — trilha de auditoria do consentimento: versão dos
      // documentos aceitos, IP de origem e o consentimento (opcional) de
      // marketing, na mesma transação da criação da conta.
      await client.query(
        `INSERT INTO consentimentos_cadastro (tenant_id, termos_versao, privacidade_versao, aceita_marketing, ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, TERMOS_VERSAO, PRIVACIDADE_VERSAO, aceitaMarketing, request.ip]
      );

      // Gera e persiste o token dentro da mesma transação da criação do
      // usuário (US21/CA01/CA05). O envio por e-mail/WhatsApp (chamada de
      // rede pra provedor externo) é disparado depois do COMMIT e sem await
      // bloqueando a resposta: uma chamada de rede lenta ou travada não pode
      // segurar uma conexão do pool nem atrasar o cadastro. `enviarPorCanais`
      // nunca lança (usa Promise.allSettled internamente).
      const codigo = await tokenService.criarToken(client, { userId: usuarioId, tipo: 'email_verificacao' });

      await client.query('COMMIT');

      tokenService.enviarPorCanais({ token: codigo, email: emailLimpo, whatsapp, nome: nomeLimpo });

      // Loga o usuário já autenticado (mas com email_verified=false) pra ele
      // seguir direto pra tela de validação do token (CA07).
      const token = fastify.jwt.sign(
        { userId: usuarioId, tenantId, email: emailLimpo, tokenVersion: usuarioRows[0].token_version },
        { expiresIn: '7d' }
      );

      reply.code(201);
      return {
        token,
        nome: nomeLimpo,
        email: emailLimpo,
        email_verified: false,
        email_mascarado: tokenService.mascararEmail(emailLimpo),
        plano_slug: planoSlugResolvido,
        segmento: segmentoSlug,
        onboarding_pendente: onboardingPendente,
      };
    } catch (erro) {
      await client.query('ROLLBACK');
      // Corrida entre a verificação acima e o INSERT (unique keys do banco).
      if (erro.code === '23505') {
        const msg = /whatsapp/i.test(erro.constraint || '')
          ? 'Este número de WhatsApp já está associado a uma conta.'
          : 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.';
        return reply.code(409).send({ error: msg });
      }
      throw erro;
    } finally {
      client.release();
    }
  });

  // Valida o token de 6 dígitos e ativa o e-mail (CA08). Autenticado: o
  // usuário já está logado desde o cadastro (ou desde o login sem validação —
  // CA10).
  fastify.post('/api/auth/verify-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, tenantId } = request.user;
    const codigo = String((request.body || {}).token || '').trim();

    if (!/^\d{6}$/.test(codigo)) {
      return reply.code(400).send({ error: 'Código incorreto. Tente novamente.' });
    }

    const { valido, motivo } = await tokenService.validate({ userId, tipo: 'email_verificacao', token: codigo });
    if (!valido) {
      const mensagens = {
        nao_encontrado: 'Nenhum código pendente. Solicite um novo.',
        expirado: 'Código expirado. Solicite um novo.',
        bloqueado: 'Número máximo de tentativas atingido. Solicite um novo código.',
        incorreto: 'Código incorreto. Tente novamente.',
      };
      return reply.code(400).send({ error: mensagens[motivo] || mensagens.incorreto });
    }

    // Token correto (validado e marcado como usado por `tokenService.validate`
    // — uso único, CA05): verifica o e-mail.
    await pool.query('UPDATE usuarios SET email_verified = true WHERE id = $1', [userId]);
    // ativado_em (US30) marca o momento exato da ativação — usado depois pra
    // calcular o trial (ativado_em + 14 dias). COALESCE garante que revalidar
    // um token (ou reprocessar) nunca sobrescreva a data já registrada.
    await pool.query('UPDATE tenants SET ativado_em = COALESCE(ativado_em, now()) WHERE id = $1', [tenantId]);

    return { ok: true, message: 'E-mail verificado! Seu trial de 14 dias está ativo.' };
  });

  // Reenvio de token (CA11): novo token, invalida o anterior, cooldown de 60s
  // e limite de 5 por hora.
  fastify.post('/api/auth/resend-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, email } = request.user;

    const { rows: contagem } = await pool.query(
      `SELECT
         COUNT(*)::int AS na_hora,
         MAX(criado_em) AS ultimo
       FROM tokens_validacao
       WHERE user_id = $1 AND tipo = 'email_verificacao' AND criado_em > now() - interval '1 hour'`,
      [userId]
    );
    if (contagem[0].na_hora >= configSistema.config.maxReenviosHora) {
      return reply.code(429).send({ error: 'Limite de reenvios atingido. Tente novamente mais tarde.' });
    }
    if (contagem[0].ultimo && Date.now() - new Date(contagem[0].ultimo).getTime() < REENVIO_COOLDOWN_SEGUNDOS * 1000) {
      return reply.code(429).send({ error: 'Aguarde alguns segundos antes de solicitar um novo código.' });
    }

    // Precisa do WhatsApp do tenant pra reenviar pelo mesmo canal do cadastro.
    const { rows: tenantRows } = await pool.query(
      `SELECT t.whatsapp FROM usuarios u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId]
    );
    const whatsapp = tenantRows[0] ? tenantRows[0].whatsapp : null;

    const client = await pool.connect();
    let codigo;
    try {
      await client.query('BEGIN');
      // Invalida qualquer token pendente do mesmo tipo antes de gerar o novo
      // (feito internamente por `criarToken` — US21/CA05).
      codigo = await tokenService.criarToken(client, { userId, tipo: 'email_verificacao' });
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    // Tenant criado pela área admin (US16) pode não ter WhatsApp cadastrado —
    // nesse caso reenvia só por e-mail em vez de disparar pro provedor com um
    // número inexistente.
    tokenService.enviarPorCanais({ token: codigo, email, whatsapp: whatsapp || undefined });

    return { ok: true };
  });
}

module.exports = { registerAuthRoutes };
