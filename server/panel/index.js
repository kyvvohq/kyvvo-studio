// CA01/CA03 (US15) — captura de erros em produção (Sentry). Sentry precisa
// ser exigido antes de qualquer outro módulo pra instrumentar chamadas
// HTTP/DB automaticamente (guia oficial do SDK Node). Só ativa se
// SENTRY_DSN estiver configurado no ambiente — sem DSN, o painel roda
// exatamente como hoje, mesmo raciocínio de "sem credencial, recurso fica
// inerte" já usado em META_WHATSAPP_TOKEN/POSTHOG_KEY.
const Sentry = require('@sentry/node');
// CA03 — nunca manda payload de erro com senha/token/cartão em texto puro.
// Aplica recursivamente porque `event.request.data` pode aninhar o corpo da
// requisição (ex.: `usuario.senha` no POST /admin/api/tenants).
const CAMPOS_SENSIVEIS_SENTRY = /senha|password|token|jwt|authorization|cookie|cvv|numero_cartao|card_number/i;
function limparDadosSensiveisSentry(event) {
  const limpar = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const chave of Object.keys(obj)) {
      if (CAMPOS_SENSIVEIS_SENTRY.test(chave)) obj[chave] = '[redacted]';
      else if (obj[chave] && typeof obj[chave] === 'object') limpar(obj[chave]);
    }
  };
  if (event.request) {
    limpar(event.request.data);
    limpar(event.request.headers);
    delete event.request.cookies;
  }
  return event;
}
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    beforeSend: limparDadosSensiveisSentry,
  });
}

// trustProxy: nginx (na frente do processo) já repassa X-Forwarded-For real —
// necessário pra `request.ip` refletir o IP do cliente, não o do proxy
// interno. Usado pelo `remoteIp` exigido na tokenização de cartão (US32).
const fastify = require('fastify')({ logger: true, trustProxy: true });
// Precisa vir logo após criar a instância, antes de registrar plugins/rotas —
// é o que faz exceções não tratadas em qualquer rota chegarem no Sentry
// (CA01), sem precisar de try/catch manual espalhado pelo código.
if (process.env.SENTRY_DSN) Sentry.setupFastifyErrorHandler(fastify);
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const staticPlugin = require('@fastify/static');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const path = require('path');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const tokenService = require('./token-service');
const asaasService = require('./asaas-service');
// Fase 1 da modularização (ver plano "Kyvvo — modularizar server/panel/index.js")
const datetime = require('./lib/datetime');
const horarioFuncionamento = require('./lib/horario-funcionamento');
const configSistema = require('./lib/configuracoes-sistema');
const trialConta = require('./lib/trial-conta');
const planos = require('./lib/planos');
const eventos = require('./lib/eventos');
const platform = require('./lib/platform');
const { resolverClaims } = require('./lib/resolver-sessao');
const { resolverSessaoProfissional } = require('./lib/sessao-profissional');
const { registerBloqueiosRoutes } = require('./routes/bloqueios');
// Fase 2 da modularização
const profissionaisLib = require('./lib/profissionais');
const { registerServicosRoutes } = require('./routes/servicos');
const { registerProfissionaisRoutes } = require('./routes/profissionais');
// Fase 3 da modularização
const { registerAgendaRoutes } = require('./routes/agenda');
// Fase 4 da modularização
const { registerClientesRoutes } = require('./routes/clientes');
const { registerDisparosRoutes } = require('./routes/disparos');
// Fase 5 da modularização
const { registerFinanceiroRoutes } = require('./routes/financeiro');
const { registerRelatoriosRoutes } = require('./routes/relatorios');
// Fase 6 da modularização
const { registerPerfilRoutes } = require('./routes/perfil');
const { registerEquipeRoutes } = require('./routes/equipe');
const { registerPortalProfissionalRoutes } = require('./routes/portal-profissional');
// Fase 7 da modularização
const { registerWhatsappConfigRoutes } = require('./routes/whatsapp-config');
const { registerAutomacoesRoutes } = require('./routes/automacoes');
const automacoes = require('./lib/automacoes');
const { registerConfiguracaoRoutes } = require('./routes/configuracao');
const { registerNotificacoesRoutes } = require('./routes/notificacoes');
// Fase 9 da modularização — montarResumoPagamentos não é mais usada direto
// em index.js (só pelas rotas admin, já extraídas).
const { registerAdminAuthRoutes } = require('./routes/admin-auth');
const { registerAdminTenantsRoutes } = require('./routes/admin-tenants');
const { registerAdminConfiguracoesRoutes } = require('./routes/admin-configuracoes');
const { registerAdminMonitoramentoRoutes } = require('./routes/admin-monitoramento');
const { registerAdminNumerosProntosRoutes } = require('./routes/admin-numeros-prontos');
const { registerAdminUsuariosRoutes } = require('./routes/admin-usuarios');
// Adapter server-to-server pro Kyvvo Admin (kyvvo-platform) — não usa o JWT
// de admin, autentica por ADMIN_ADAPTER_TOKEN.
const { registerAdminAdapterRoutes } = require('./routes/admin-adapter');
// Fase 10 da modularização
const { registerAuthRoutes } = require('./routes/auth');
const { registerPublicoRoutes } = require('./routes/publico');
const { registerContaRoutes } = require('./routes/conta');
const { registerMensagensRoutes } = require('./routes/mensagens');
// Fase 11 da modularização (última) — anthropicService/parsearIntentIA/
// escolherAgendamentoAlvoIA/IA_INTENTS_VALIDOS/metaWhatsappService/
// evolutionService/sincronizarLancamentoFinanceiro/garantirProfissionalPadrao/
// dentroDoHorarioFuncionamento/buscarBloqueioConflitante não têm mais call
// site direto aqui — só dentro de lib/ia-engine.js e
// routes/webhook-whatsapp.js, que os importam direto.
const disponibilidadeLib = require('./lib/disponibilidade');
const iaEngineLib = require('./lib/ia-engine');
const { iniciarWorkerHandoff } = require('./lib/worker-handoff');
const { iniciarWorkerRetomadaIA } = require('./lib/worker-retomada-ia');
const { registerWebhookWhatsappRoutes } = require('./routes/webhook-whatsapp');
const { openapiConfig, transform: swaggerTransform } = require('./lib/swagger-config');
const { contarHorariosLivresNoDia, contarHorariosLivresPorProfissionalNoDia } = disponibilidadeLib;
const { dataAtualBrasilia } = datetime;
const { calcularBloqueioAssinatura, BLOQUEIO_MENSAGENS } = trialConta;
const { registrarEventoTrialExpiradoUmaVez } = eventos;

// ---------- Cadastro self-service (US20) ----------
// TRIAL_DIAS/MAX_REENVIOS_HORA/CARENCIA_DIAS_INADIMPLENCIA/EMAIL_SUPORTE/
// WHATSAPP_SUPORTE viraram `configSistema.config` (lib/configuracoes-sistema.js,
// fase 1 da modularização) — editáveis em runtime via
// /admin/api/configuracoes/sistema, sem deploy.
// EMAIL_REGEX/SENHA_REGEX viraram lib/validadores.js (fase 1 da modularização).
// REENVIO_COOLDOWN_SEGUNDOS/MODULOS_TRIAL/TERMOS_VERSAO/PRIVACIDADE_VERSAO/
// SEGMENTOS_VALIDOS/TECNOLOGIA_VALIDA viraram constantes privadas de
// routes/auth.js (fase 10) e routes/admin-tenants.js (fase 9) — únicos call
// sites já extraídos.

// normalizarWhatsapp virou lib/whatsapp.js (fase 6 da modularização) — usada
// por Perfil e por POST /api/auth/register, ambos já extraídos (nenhum call
// site sobra aqui, o require saiu do topo do arquivo).
// normalizarTelefoneCliente virou lib/clientes.js (fase 3 da modularização)
// — usada por Agenda (já extraída) e pelo grupo Clientes (ainda aqui).

const PORT = process.env.PORT || 3001;
// JWT_SECRET (token de tenant) saiu no corte P3 — sessão de tenant é RS256 do
// kyvvo-platform. Sobra só o secret do JWT de admin (US16).
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_JWT_SECRET) throw new Error('ADMIN_JWT_SECRET não configurado');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
tokenService.init(pool);
horarioFuncionamento.init(pool);
configSistema.init(pool);
planos.init(pool);
eventos.init(pool);
profissionaisLib.init(pool);
disponibilidadeLib.init(pool);
iaEngineLib.init(pool, fastify);

// proximaOcorrenciaRecorrencia virou função privada de routes/agenda.js
// (fase 3 da modularização) — único call site era dentro de
// POST /api/agendamentos, já extraído.

// proximaCobrancaRespeitandoTrial virou função privada de
// routes/pagamentos.js (fase 8 da modularização) — único call site era
// dentro de POST /api/pagamentos/cadastrar, já extraído.

// EVENTOS_ANALYTICS_TIPOS/EVENTOS_ANALYTICS_TIPOS_FRONTEND/registrarEvento
// (lib/eventos.js desde a fase 1) não têm mais call site direto aqui —
// POST /api/eventos virou routes/conta.js (fase 10), que importa os dois
// últimos direto da lib. Só registrarEventoTrialExpiradoUmaVez segue
// destructurado acima, usada pelo decorator `authenticate`.

// US68 — IA Engine (motor conversacional Claude Haiku 4.5) — extraído pra
// lib/ia-engine.js (fase 11 da modularização, a última): montarContextoIA,
// buscarHistoricoIA, salvarMensagemIA, executarAcaoIA, acionarFallbackHumanoIA,
// processarMensagemIA. calcularDisponibilidadeIA/contarHorariosLivresNoDia
// viraram lib/disponibilidade.js (cross-cutting, contarHorariosLivresNoDia
// também usada por GET /api/inicio/resumo, mais abaixo).


async function start() {
  await fastify.register(cors, { origin: true });
  // JWT do tenant saiu no corte P3 — o token de sessão é RS256 emitido pelo
  // kyvvo-platform e verificado em `authenticate` (lib/resolver-sessao.js).
  // JWT completamente separado pra área admin da Kyvvo (US16) — secret
  // próprio, namespace próprio (fastify.jwt.admin.*, request.adminJwtVerify,
  // reply.adminJwtSign) e decoratorName próprio (request.admin em vez de
  // request.user), pra nunca ter qualquer ambiguidade com o JWT de tenant.
  await fastify.register(jwt, {
    secret: ADMIN_JWT_SECRET,
    namespace: 'admin',
    decoratorName: 'admin',
  });
  await fastify.register(staticPlugin, {
    root: path.join(__dirname, 'public'),
    prefix: '/',
    // Permite acessar /painel em vez de /painel.html (URLs limpas no portal
    // do tenant) — o `send` por trás do @fastify/static tenta essa extensão
    // quando o caminho exato não bate com nenhum arquivo. Não quebra links
    // antigos com `.html`: continuam resolvendo normalmente também.
    extensions: ['html'],
  });
  // /ds/* (tokens.css, components.css/js, logos) NÃO é mais servido por este
  // app: o nginx atende /ds/ direto de /opt/kyvvo/design-system/, sincronizado a
  // cada push na main do kyvvo-design-system (consumo em tempo real, sem npm/
  // lockfile por produto). Ver README do kyvvo-design-system.

  // Documentação interativa da API (Swagger/OpenAPI) — precisa registrar
  // ANTES de qualquer rota (inclusive as dos routes/*.js exigidos abaixo),
  // já que @fastify/swagger captura cada rota no momento em que ela é
  // registrada no Fastify. Ver lib/swagger-config.js pra como a tag de cada
  // rota é derivada automaticamente do próprio path (sem schema manual por
  // rota) e como só rotas /api, /admin/api e /webhook* entram no doc.
  await fastify.register(swagger, { openapi: openapiConfig, transform: swaggerTransform });
  await fastify.register(swaggerUi, { routePrefix: '/admin/docs' });

  // Página de detalhe do tenant (US28/CA01) — rota dinâmica que o
  // @fastify/static não resolve sozinho, já que não existe um arquivo físico
  // `/admin/tenants/<id>.html`. Autenticação é feita do mesmo jeito das
  // outras páginas admin: client-side (token no localStorage) + servidor via
  // a API JSON que a página consome.
  fastify.get('/admin/tenants/:id', async (request, reply) => {
    return reply.type('text/html').sendFile('admin/tenant-detalhe.html');
  });

  // Roteamento client-side do portal do tenant (SPA) — cada seção do menu
  // ganha URL própria (favoritar/compartilhar/recarregar direto numa seção,
  // botão voltar funcionando entre elas). Antes só /painel existia; clicar
  // em qualquer item do menu não mudava a URL. O HTML servido é sempre o
  // mesmo painel.html — app.js lê o path no carregamento e decide qual
  // seção mostrar (ver ROTAS_MENU/menuDoCaminho em app.js). Mantém o mesmo
  // padrão do /admin/tenants/:id acima: sem arquivo físico, sem auth aqui
  // (client-side, igual todo o resto do painel).
  const ROTAS_PAINEL_TENANT = [
    // /servicos, /profissionais, /bloqueios e /equipe viraram abas de
    // /cadastro (Config > Cadastro) mas seguem registrados: o app.js os
    // trata como deep link pra aba correspondente.
    '/quadro', '/agenda', '/cadastro', '/servicos', '/profissionais', '/clientes', '/bloqueios',
    '/whatsapp', '/automacoes', '/cobranca', '/perfil', '/empresa', '/equipe',
    '/preferencias', '/ajuda',
  ];
  for (const rota of ROTAS_PAINEL_TENANT) {
    fastify.get(rota, async (request, reply) => reply.type('text/html').sendFile('painel.html'));
  }
  // Módulos (Financeiro hoje, outros a caminho — agenda_inteligente,
  // campanhas_proativas, comissao, dashboards, estoque) — uma rota dinâmica
  // só, em vez de registrar uma por módulo.
  fastify.get('/modulo/:chave', async (request, reply) => reply.type('text/html').sendFile('painel.html'));

  // Rotas que uma conta ainda não verificada (US20/CA10) precisa continuar
  // acessando pra completar a verificação, pedir reenvio ou sair — checado
  // direto em `authenticate` (em vez de um preHandler à parte que cada rota
  // nova precisaria lembrar de encadear) pra que o bloqueio nunca dependa de
  // alguém adicionar a checagem rota por rota.
  const ROTAS_LIVRES_SEM_VERIFICACAO = new Set([
    'POST /api/auth/logout',
    'POST /api/auth/verify-token',
    'POST /api/auth/resend-token',
    'GET /api/tenant/status',
  ]);

  // US52/CA03 — acesso limitado: com trial vencido/inadimplente/suspenso/
  // cancelado, GET nunca é bloqueado (o tenant continua vendo os dados reais
  // normalmente, só não consegue criar/editar/excluir nada) — só as rotas de
  // ESCRITA abaixo continuam liberadas: sair da conta e o endpoint de
  // analytics. Qualquer outra escrita (agenda, clientes, serviços,
  // configuração...) fica bloqueada até regularizar. Plano e cobrança não
  // aparece mais aqui — corte P3 (billing): /api/pagamentos/* e
  // /webhooks/asaas são roteados pelo nginx direto pro kyvvo-platform
  // (:3003), nunca chegam neste serviço.
  const ROTAS_LIVRES_SEM_ASSINATURA = new Set([
    'POST /api/auth/logout',
    'POST /api/eventos',
  ]);

  // Acesso de profissional (login sem senha, sessão paralela de 90 dias —
  // ver lib/sessao-profissional.js): o modelo de autorização de hoje é um
  // DENYLIST (a maioria das rotas só exige `authenticate`, sem
  // `requireAdmin`; só 4 telas são bloqueadas pro 'operador'). Sem este
  // allowlist, uma sessão de profissional herdaria acesso de operador
  // completo a clientes/serviços/financeiro/etc — o oposto do pedido
  // (só a própria agenda + um financeiro calculado). Defesa em
  // profundidade: barra em authenticate, antes de qualquer handler rodar,
  // então nem um erro futuro em outra rota vaza dado.
  const ROTAS_LIVRES_PROFISSIONAL = new Set([
    'POST /api/auth/logout',
    'GET /api/agendamentos',
    'GET /api/portal-profissional/resumo',
  ]);

  fastify.decorate('authenticate', async (request, reply) => {
    const token = String(request.headers.authorization || '').replace(/^Bearer /i, '').trim();
    if (!token) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    // Corte P3: verifica o token RS256 no serviço kyvvo-platform (JWKS local),
    // com fallback pro HS256 legado do painel enquanto sessões de 7 dias
    // abertas antes do corte ainda circulam (lib/resolver-sessao.js).
    const claims = await resolverClaims({
      authorizationHeader: request.headers.authorization,
      verificarRs256: (t) => platform.verifyToken(t),
    });

    // Acesso de profissional: nunca passa por resolverClaims/platform (não
    // tem senha, não emite RS256) — só tentado quando o token não é um RS256
    // nem um HS256 legado válido, então nunca atrasa/intercepta o caminho de
    // admin/operador existente.
    let sessaoProfissional = null;
    if (!claims) {
      sessaoProfissional = await resolverSessaoProfissional(pool, token);
      if (!sessaoProfissional) {
        return reply.code(401).send({ error: 'Não autenticado' });
      }
    }

    request.user = claims
      ? { userId: claims.userId, tenantId: claims.tenantId, email: claims.email, tokenVersion: claims.tokenVersion }
      : { userId: sessaoProfissional.usuario_id, tenantId: sessaoProfissional.tenant_id };

    const { rows } = await pool.query(
      `SELECT u.token_version, u.email_verified, u.role, u.ativo, u.profissional_id,
              t.status AS tenant_status, t.ativado_em, t.status_alterado_em, t.acesso_ate
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [request.user.userId]
    );
    const usuario = rows[0];
    // claims só existe no caminho RS256/HS256 — a checagem de token_version
    // (sessão invalidada por logout/token_version++) continua exata pro
    // admin/operador. No caminho de sessão de profissional a invalidação é
    // via revogado_em/expira_em, já filtrados em resolverSessaoProfissional.
    if (!usuario || (claims && usuario.token_version !== claims.tokenVersion)) {
      return reply.code(401).send({ error: 'Sessão expirada. Faça login novamente.' });
    }
    // US62 — membro desativado pelo administrador da equipe perde acesso na
    // próxima requisição, mesmo com um JWT ainda válido (mesmo espírito do
    // token_version acima, só que pra "conta inteira desligada" em vez de
    // "essa sessão específica").
    if (!usuario.ativo) {
      return reply.code(401).send({ error: 'Acesso desativado. Fale com o administrador da sua equipe.' });
    }
    // Sempre a fonte de verdade do banco, nunca um claim do JWT — uma
    // mudança de perfil feita pelo administrador vale já na próxima
    // requisição, sem esperar o membro deslogar e logar de novo.
    request.user.role = usuario.role;
    if (usuario.profissional_id) {
      request.user.profissionalId = usuario.profissional_id;
    }

    const rotaAtual = `${request.method} ${request.routeOptions.url}`;
    if (request.user.role === 'profissional' && !ROTAS_LIVRES_PROFISSIONAL.has(rotaAtual)) {
      return reply.code(403).send({ error: 'Acesso restrito à agenda e ao financeiro do profissional.' });
    }

    if (!usuario.email_verified) {
      if (!ROTAS_LIVRES_SEM_VERIFICACAO.has(rotaAtual)) {
        return reply.code(403).send({ error: 'Confirme seu cadastro para continuar. Verifique seu e-mail ou WhatsApp.' });
      }
      return;
    }

    // US52/CA01-CA07 + bloqueio por inadimplência/suspensão/cancelamento
    // vencido (calcularBloqueioAssinatura, mesma fonte de verdade usada em
    // GET /api/tenant/status e na Cobrança): bloqueia módulos operacionais,
    // mantém acesso à regularização. Só avaliado depois da verificação de
    // e-mail acima — um tenant recém-cadastrado (ativado_em ainda nulo)
    // sempre bate em `!trialAtivo`, mas nesse caso email_verified também é
    // false e o early return acima já resolveu a rota.
    const bloqueioMotivo = calcularBloqueioAssinatura({
      status: usuario.tenant_status,
      ativado_em: usuario.ativado_em,
      status_alterado_em: usuario.status_alterado_em,
      acesso_ate: usuario.acesso_ate,
    });
    if (bloqueioMotivo) {
      if (bloqueioMotivo === 'trial_expirado') {
        await registrarEventoTrialExpiradoUmaVez(request.user.tenantId);
      }
      // Acesso limitado (não binário): GET sempre passa (dados reais,
      // sem esconder nada); só escrita fora do whitelist acima é bloqueada.
      if (request.method !== 'GET' && !ROTAS_LIVRES_SEM_ASSINATURA.has(rotaAtual)) {
        return reply.code(403).send({
          error: BLOQUEIO_MENSAGENS[bloqueioMotivo],
          bloqueio: bloqueioMotivo,
        });
      }
    }
  });

  // Autenticação da área admin da Kyvvo (US16) — totalmente isolada da
  // autenticação de tenant acima (secret diferente, tabela diferente,
  // decorator diferente). Nunca compartilhar preHandler entre as duas.
  fastify.decorate('authenticateAdmin', async (request, reply) => {
    try {
      await request.adminJwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
  });

  // Versão do backend atualmente rodando (US66) — lê version.json gravado
  // pelo próprio workflow de deploy (commit + horário), fora de public/ pra
  // não virar arquivo estático público. Comparado no front com
  // window.KYVVO_FRONT_VERSION (admin/version.js) pra detectar quando o
  // navegador está com JS em cache desatualizado em relação ao backend.
  fastify.get('/admin/api/versao', { preHandler: [fastify.authenticateAdmin] }, async () => {
    try {
      const conteudo = await fsPromises.readFile(path.join(__dirname, 'version.json'), 'utf8');
      return JSON.parse(conteudo);
    } catch {
      return { commit: null, deployedAt: null };
    }
  });

  // requireModulo('financeiro') devolve um preHandler que barra a rota com 403
  // se o tenant autenticado não tiver aquele módulo ativo em tenant_modulos
  // (US10 / CA03). Deve ser encadeado SEMPRE depois de `authenticate` no array
  // de preHandler, pois depende de request.user.tenantId já resolvido.
  // Uso: preHandler: [fastify.authenticate, fastify.requireModulo('financeiro')]
  fastify.decorate('requireModulo', (moduloKey) => async (request, reply) => {
    const { tenantId } = request.user || {};
    if (!tenantId) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }

    const { rows } = await pool.query(
      'SELECT 1 FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = $2 AND ativo LIMIT 1',
      [tenantId, moduloKey]
    );
    if (rows.length === 0) {
      return reply.code(403).send({
        error: `Módulo "${moduloKey}" não está ativo para este salão.`,
      });
    }
  });

  // US62 — restringe rotas ao perfil administrador (gestão de equipe,
  // cobrança/financeiro, configurações do negócio). Encadear sempre depois
  // de fastify.authenticate, que já resolve request.user.role a partir do
  // banco (nunca do JWT).
  fastify.decorate('requireAdmin', async (request, reply) => {
    if (request.user.role !== 'administrador') {
      return reply.code(403).send({ error: 'Ação restrita ao administrador da conta.' });
    }
  });

  // Acesso de profissional — defesa redundante com ROTAS_LIVRES_PROFISSIONAL
  // (authenticate), útil se uma rota futura reusar a mesma entrada do Set
  // sem querer encadear este preHandler também.
  fastify.decorate('requireProfissional', async (request, reply) => {
    if (request.user.role !== 'profissional' || !request.user.profissionalId) {
      return reply.code(403).send({ error: 'Rota restrita ao acesso de profissional.' });
    }
  });

  // Auth + Recuperação de senha + Cadastro self-service — extraído pra
  // routes/auth.js (fase 10 da modularização): POST /api/auth/login|logout|
  // esqueci-senha|redefinir-senha|register|verify-token|resend-token.
  registerAuthRoutes(fastify, pool);


  // Rotas públicas — extraído pra routes/publico.js (fase 10 da
  // modularização): GET /api/config-publica, GET /api/segmentos,
  // GET /api/planos[/:slug].
  registerPublicoRoutes(fastify, pool);
  registerMensagensRoutes(fastify);

  // WhatsApp webhook — extraído pra routes/webhook-whatsapp.js (fase 11 da
  // modularização, a última): GET/POST /webhook/whatsapp (handshake +
  // roteador IA Engine / repasse pro n8n).
  registerWebhookWhatsappRoutes(fastify, pool);


  // Conta do tenant logado — extraído pra routes/conta.js (fase 10 da
  // modularização): GET /api/tenant/status, POST /api/onboarding/dispensar,
  // POST /api/eventos.
  registerContaRoutes(fastify, pool);


  // Agenda — extraído pra routes/agenda.js (fase 3 da modularização):
  // GET/PATCH /api/agendamentos[/:id], GET /api/agendamentos/disponibilidade
  // e POST /api/agendamentos (mais abaixo, onde vivia antes — ver comentário
  // lá).
  registerAgendaRoutes(fastify, pool);

  // CRUD de Serviços (US17/ST17.1) — extraído pra routes/servicos.js (fase 2
  // da modularização): GET/POST/PATCH/DELETE /api/servicos[/:id].
  registerServicosRoutes(fastify, pool);

  // Clientes (menu Clientes) — extraído pra routes/clientes.js (fase 4 da
  // modularização): GET/POST/DELETE /api/clientes[/:id], GET
  // /api/clientes/buscar-por-telefone, GET/PATCH /api/clientes/:id.
  registerClientesRoutes(fastify, pool);

  // Disparo manual de WhatsApp por seleção de clientes — POST
  // /api/clientes/disparo-lote. Lógica de cota/envio/registro em
  // @kyvvohq/disparos (compartilhado com outros produtos Kyvvo).
  registerDisparosRoutes(fastify, pool);

  // CRUD de Profissionais (US17/ST17.2, incluindo GET pro dropdown do
  // formulário de agendamento) — extraído pra routes/profissionais.js (fase
  // 2 da modularização): GET/POST/PATCH/DELETE /api/profissionais[/:id].
  registerProfissionaisRoutes(fastify, pool);

  // Bloqueios manuais de agenda (US61) + Feriados nacionais (Configurações >
  // Bloqueio de agenda) — extraídos pra routes/bloqueios.js (fase 1 da
  // modularização): GET/POST/DELETE /api/bloqueios, GET/PATCH /api/feriados.
  registerBloqueiosRoutes(fastify, pool);

  // POST /api/agendamentos (âncora + recorrência) também foi pra
  // routes/agenda.js — registerAgendaRoutes já cobre as 4 rotas de Agenda de
  // uma vez só, mais acima (onde GET/PATCH/disponibilidade viviam).

  // Perfil — extraído pra routes/perfil.js (fase 6 da modularização):
  // GET/PATCH /api/perfil, PATCH /api/perfil/senha.
  registerPerfilRoutes(fastify, pool);

  // Equipe — extraído pra routes/equipe.js (fase 6 da modularização):
  // GET /api/equipe, POST/DELETE /api/equipe/convites[/:id],
  // GET /api/equipe/convites/:token, POST /api/equipe/convites/:token/aceitar,
  // PATCH/DELETE /api/equipe/membros/:id.
  registerEquipeRoutes(fastify, pool);
  registerPortalProfissionalRoutes(fastify, pool);

  // WhatsApp (self-service) — extraído pra routes/whatsapp-config.js (fase
  // 7 da modularização): GET /api/whatsapp/config-publica|status|conversas,
  // POST /api/whatsapp/solicitar-numero-novo|conectar.
  registerWhatsappConfigRoutes(fastify, pool);

  // Automações (menu Config > Automações) — GET /api/automacoes[/templates-
  // whatsapp], PATCH /api/automacoes/:id. Motor + worker em lib/automacoes.js.
  registerAutomacoesRoutes(fastify, pool);

  // Configuração — extraído pra routes/configuracao.js (fase 7 da
  // modularização): GET/PATCH /api/configuracao, GET /api/tenant/modulos.
  registerConfiguracaoRoutes(fastify, pool);

  // Serviço de notificações — balão do topo (GET /api/notificacoes).
  registerNotificacoesRoutes(fastify, pool);


  // Financeiro — extraído pra routes/financeiro.js (fase 5 da modularização):
  // GET /api/financeiro/resumo, GET /api/financeiro/resumo-dashboard,
  // GET/POST/PATCH /api/financeiro/lancamentos[/:id].
  registerFinanceiroRoutes(fastify, pool);

  // Início (dashboard) reformulado em 5 seções — um único endpoint agregando
  // tudo (em vez de N chamadas), já que a tela renderiza tudo de uma vez.
  // Seção "Atendimento agente Kyvvo" só existe pra tecnologia='ia' (bot de
  // menu no n8n não grava conversas_ia); Seção "Financeiro" só pra quem tem
  // o módulo financeiro ativo E é administrador (mesmo critério de
  // /api/financeiro/resumo-dashboard, só que sem 403 — aqui o resto da tela
  // continua funcionando pra quem não pode ver dinheiro, só essa seção some).
  fastify.get('/api/inicio/resumo', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId, role } = request.user;
    const hoje = dataAtualBrasilia();
    const amanha = new Date(new Date(`${hoje}T12:00:00-03:00`).getTime() + 86400000).toISOString().slice(0, 10);

    const { rows: tenantRows } = await pool.query(
      `SELECT id, tecnologia, dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, cliente_inativo_dias
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantRows[0];

    const [
      { rows: atendimentosRows },
      { rows: previstoRows },
      horariosLivresHoje,
      horariosLivresAmanhaPorProfissional,
      { rows: semRetornoRows },
    ] = await Promise.all([
      // Soma de todos os profissionais do tenant (não filtra por
      // profissional_id) — validado 2026-09-17, já era o comportamento.
      pool.query(
        `SELECT count(*)::int AS total FROM agendamentos
         WHERE tenant_id = $1 AND status != 'cancelado'
           AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
        [tenantId, hoje]
      ),
      // Soma dos lancamentos_financeiros 'previsto' do dia — já reflete
      // qualquer atualização de preço de serviço feita DEPOIS do agendamento
      // criado, porque PATCH /api/servicos/:id agora re-sincroniza os
      // lançamentos futuros afetados (ver routes/servicos.js) em vez de
      // deixar o valor travado no preço da hora da criação.
      pool.query(
        `SELECT COALESCE(SUM(valor) FILTER (WHERE status = 'previsto' AND data = $2), 0) AS previsto
         FROM lancamentos_financeiros WHERE tenant_id = $1 AND tipo = 'entrada'`,
        [tenantId, hoje]
      ),
      // Também soma todos os profissionais — validado 2026-09-17.
      contarHorariosLivresNoDia(tenant, hoje),
      // Amanhã: detalhe por profissional + hora cheia (pedido explícito —
      // ver contarHorariosLivresPorProfissionalNoDia).
      contarHorariosLivresPorProfissionalNoDia(tenant, amanha),
      // "Sem retorno" exige que o cliente já tenha tido pelo menos 1
      // atendimento antes — cliente novo que nunca agendou não é "sem
      // retorno" (nunca teve retorno nenhum pra medir). Limiar configurável
      // por tenant (Preferências, cliente_inativo_dias) — mesmo número usado
      // em CLIENTE_STATUS_SQL (routes/clientes.js) pro status "inativo".
      pool.query(
        `SELECT count(*)::int AS total FROM clientes c
         WHERE c.tenant_id = $1
           AND EXISTS (SELECT 1 FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado')
           AND (SELECT max(a.data_hora) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado') < now() - make_interval(days => $2::int)`,
        [tenantId, tenant.cliente_inativo_dias]
      ),
    ]);

    let atendimentoIa = null;
    if (tenant.tecnologia === 'ia') {
      // "Conversas hoje" tem que ser a SOMA de "Não concluíram" +
      // "Concluídos" (pedido explícito 2026-09-17) — antes conversas_hoje
      // vinha de uma contagem independente (clientes distintos que mandaram
      // mensagem) enquanto concluidos_hoje contava AGENDAMENTOS (não
      // clientes distintos), então os 3 números podiam não bater (cliente
      // com 2 agendamentos no dia inflava concluidos_hoje sem inflar
      // conversas_hoje). Agora concluidos_hoje também conta clientes
      // distintos (a CTE `agendados` já faz DISTINCT cliente_id) e
      // conversas_hoje é sempre a soma dos outros dois, nunca uma medida à
      // parte.
      const { rows } = await pool.query(
        `WITH conversas AS (
           SELECT DISTINCT cliente_id FROM conversas_ia
           WHERE tenant_id = $1 AND role = 'user'
             AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
         ),
         agendados AS (
           SELECT DISTINCT cliente_id FROM agendamentos
           WHERE tenant_id = $1 AND origem = 'whatsapp' AND status != 'cancelado'
             AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
         )
         SELECT
           (SELECT count(*) FROM (SELECT cliente_id FROM conversas EXCEPT SELECT cliente_id FROM agendados) t) AS nao_concluiram_hoje,
           (SELECT count(*) FROM agendados) AS concluidos_hoje,
           (SELECT COALESCE(SUM(s.duracao_minutos), 0) FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
             WHERE a.tenant_id = $1 AND a.origem = 'whatsapp' AND a.status != 'cancelado'
               AND (a.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date) AS minutos_economizados_hoje`,
        [tenantId, hoje]
      );
      const r = rows[0];
      const naoConcluiramHoje = Number(r.nao_concluiram_hoje);
      const concluidosHoje = Number(r.concluidos_hoje);
      atendimentoIa = {
        conversas_hoje: naoConcluiramHoje + concluidosHoje,
        nao_concluiram_hoje: naoConcluiramHoje,
        concluidos_hoje: concluidosHoje,
        minutos_economizados_hoje: Number(r.minutos_economizados_hoje),
      };
    }

    let financeiro = null;
    if (role === 'administrador') {
      const { rows: moduloRows } = await pool.query(
        "SELECT 1 FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = 'financeiro' AND ativo LIMIT 1",
        [tenantId]
      );
      if (moduloRows.length) {
        const { rows } = await pool.query(
          `SELECT
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data, 'YYYY-MM') = to_char($2::date, 'YYYY-MM')), 0) AS faturado_mes,
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data, 'YYYY-MM') = to_char($2::date - interval '1 month', 'YYYY-MM')), 0) AS faturado_mes_anterior
           FROM lancamentos_financeiros WHERE tenant_id = $1 AND tipo = 'entrada'`,
          [tenantId, hoje]
        );
        const r = rows[0];
        const faturadoMes = Number(r.faturado_mes);
        const faturadoMesAnterior = Number(r.faturado_mes_anterior);
        financeiro = {
          faturado_mes: faturadoMes,
          variacao_pct: faturadoMesAnterior > 0 ? ((faturadoMes - faturadoMesAnterior) / faturadoMesAnterior) * 100 : null,
        };
      }
    }

    return {
      atendimentos_hoje: atendimentosRows[0].total,
      horarios_livres_hoje: horariosLivresHoje,
      previsto_hoje: Number(previstoRows[0].previsto),
      oportunidades: {
        clientes_sem_retorno: semRetornoRows[0].total,
        // Nunca mais hardcoded no texto do front — o front monta a frase
        // "há mais de N dias" com esse número (pedido explícito 2026-09-17).
        cliente_inativo_dias: tenant.cliente_inativo_dias,
        horarios_livres_amanha: horariosLivresAmanhaPorProfissional.reduce((soma, p) => soma + p.livres, 0),
        horarios_livres_amanha_por_profissional: horariosLivresAmanhaPorProfissional,
      },
      atendimento_ia: atendimentoIa,
      financeiro,
    };
  });

  // Relatórios — extraído pra routes/relatorios.js (fase 5 da
  // modularização): GET /api/relatorios/resumo (dashboard mensal de
  // negócio, modulo_key='dashboards').
  registerRelatoriosRoutes(fastify, pool);

  // Pagamentos / Asaas — routes/pagamentos.js (fase 8 da modularização)
  // removido no corte P3 (billing): GET /api/pagamentos[/status],
  // POST /api/pagamentos/cadastrar, PATCH /api/pagamentos/plano,
  // DELETE /api/pagamentos/assinatura e POST /webhooks/asaas agora são
  // servidos pelo kyvvo-platform (:3003) — nginx roteia direto, nunca
  // chegam aqui. lib/pagamentos.js (montarResumoPagamentos) continua
  // existindo só porque routes/admin-tenants.js ainda usa pra montar a
  // visão 360° do tenant dentro da área admin interna.

  // Área admin da Kyvvo (US16) — extraída pra vários routes/admin-*.js
  // (fase 9 da modularização): auth, tenants (CRUD + assinaturas + módulos),
  // configurações do sistema/planos, monitoramento (whatsapp/status +
  // ia-uso) e números prontos.
  registerAdminAuthRoutes(fastify, pool);
  registerAdminTenantsRoutes(fastify, pool);
  registerAdminConfiguracoesRoutes(fastify, pool);
  registerAdminMonitoramentoRoutes(fastify, pool);
  registerAdminNumerosProntosRoutes(fastify, pool);
  registerAdminUsuariosRoutes(fastify, pool);
  registerAdminAdapterRoutes(fastify, pool);


  // CA09 — carrega os valores configuráveis do banco antes de aceitar
  // requisições, pra nunca servir com os literais hardcoded quando já existe
  // uma configuração diferente salva.
  await configSistema.carregar();
  await planos.carregar();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Painel Kyvvo rodando na porta ${PORT}`);

  // Retorno automático de handoff — devolve ao atendimento por IA as conversas
  // que ficaram em 'aguardando_humano' além do limite sem o salão retomar.
  iniciarWorkerHandoff(pool, configSistema, fastify.log);
  // Retomada de atendimento da IA (Configurações > Preferências) — ver
  // lib/worker-retomada-ia.js.
  iniciarWorkerRetomadaIA(pool, fastify.log);
  iniciarWorkerAutomacoes();
  iniciarRecargaPlanos();
}

// Achado 2026-09-23: o admin (kyvvo-admin) edita `limite_disparos`/preço
// direto na tabela `planos` compartilhada (mesmo Postgres), mas o
// `planosCache` deste processo só recarregava no boot — a edição nunca
// chegava até o Studio sem reiniciar o container. Sem infra nova (endpoint
// server-to-server + token) pra invalidar sob demanda, um recarregamento
// periódico curto já resolve a maior parte do problema prático (o dono edita
// e testa minutos depois, não no mesmo segundo).
const INTERVALO_RECARGA_PLANOS_MS = 60 * 1000;
function iniciarRecargaPlanos() {
  setInterval(() => {
    planos.carregar().catch((err) => console.error(`[planos] recarga periódica falhou: ${err.message}`));
  }, INTERVALO_RECARGA_PLANOS_MS);
}

// Worker das automações — o painel nunca teve processo em background; um
// setInterval no próprio processo já resolve (volume baixo, 1 container).
// Roda a cada 5 min: drena a fila de WhatsApp de fora-do-horário e checa os
// gatilhos por tempo (lembrete / aniversário / cliente inativo). Best-effort
// — uma falha numa rodada loga e não derruba o processo. Só no processo real
// (start()), nunca em teste (build()/require não chega aqui).
const INTERVALO_WORKER_AUTOMACOES_MS = 5 * 60 * 1000;
function iniciarWorkerAutomacoes() {
  setInterval(async () => {
    for (const [nome, fn] of [
      ['fila-whatsapp', automacoes.processarFilaWhatsapp],
      ['aniversarios', automacoes.processarAniversarios],
      ['inativos', automacoes.processarInativos],
    ]) {
      try {
        const r = await fn(pool);
        const n = (r && (r.processados || r.enviados)) || 0;
        if (n) console.log(`[automacoes] ${nome}: ${n} envio(s)`);
      } catch (err) {
        console.error(`[automacoes] worker ${nome} falhou: ${err.message}`);
      }
    }
  }, INTERVALO_WORKER_AUTOMACOES_MS);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
