// Equipe (US62) — extraído de index.js (fase 6 da modularização):
// GET /api/equipe, POST/DELETE /api/equipe/convites[/:id],
// GET /api/equipe/convites/:token, POST /api/equipe/convites/:token/aceitar,
// PATCH/DELETE /api/equipe/membros/:id.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { EMAIL_REGEX, SENHA_REGEX } = require('../lib/validadores');
const { enviarEmail } = require('../lib/email');
const { criarSessaoProfissional, revogarSessoesProfissional } = require('../lib/sessao-profissional');

const ROLES_VALIDOS = ['administrador', 'operador', 'profissional'];

// Rede interna do compose — mesmo default de lib/platform.js.
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://platform:3003';

function registerEquipeRoutes(fastify, pool) {
  const CONVITE_EXPIRACAO_DIAS = 7;

  // Token opaco (link de convite) — diferente do código de 6 dígitos do
  // token-service.js: aqui é um clique só, não algo pra digitar.
  function gerarTokenConvite() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Best-effort pelo serviço de e-mail da plataforma (lib/email.js) — sem
  // provedor configurado cai em modo log (dev/homolog).
  async function enviarConviteEmail({ email, tenantNome, convidadoPorNome, link, role }) {
    const perfilLabel = { administrador: 'administrador', operador: 'operador', profissional: 'profissional' }[role] || 'operador';

    if (!process.env.PLATFORM_EMAIL_TOKEN && !process.env.RESEND_API_KEY) {
      console.log(`[equipe] (dev) convite para ${email} (${perfilLabel} de ${tenantNome}) — link: ${link}`);
      return;
    }

    await enviarEmail({
      to: email,
      tag: 'convite_equipe',
      // Textos editáveis no admin (E-mail > Modelos > Convite de equipe);
      // o html abaixo é o fallback.
      modelo: 'convite_equipe',
      variaveis: { empresa: tenantNome, convidado_por: convidadoPorNome || '', perfil: perfilLabel, dias: CONVITE_EXPIRACAO_DIAS },
      layout: {
        tipo: 'convite',
        titulo: `Você foi convidado para ${tenantNome}`,
        paragrafos: [`${convidadoPorNome || 'Um administrador'} te convidou para fazer parte da equipe no Kyvvo Studio, como ${perfilLabel}.`],
        cta: { texto: 'Aceitar convite', url: link },
        motivo: `O convite expira em ${CONVITE_EXPIRACAO_DIAS} dias. Se você não esperava por isso, pode ignorar este e-mail.`,
      },
      subject: `${convidadoPorNome || 'Alguém'} te convidou para o Kyvvo`,
      html: `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#080b14;padding:32px;color:#f2f2f7">
        <div style="max-width:420px;margin:0 auto;background:#12162a;border:1px solid #232847;border-radius:16px;padding:32px">
          <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;margin-bottom:24px">
            ky<span style="color:#a688ff">vv</span>o
          </div>
          <h1 style="font-size:18px;margin:0 0 12px">Você foi convidado para ${tenantNome}</h1>
          <p style="color:#a1a5c4;font-size:14px;line-height:1.6;margin:0 0 24px">
            ${convidadoPorNome || 'Um administrador'} te convidou pra fazer parte da equipe no Kyvvo, como <strong>${perfilLabel}</strong>.
          </p>
          <a href="${link}" style="display:inline-block;background:#7c5cfc;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Aceitar convite</a>
          <p style="color:#6b7099;font-size:12px;line-height:1.6;margin:24px 0 0">
            O convite expira em ${CONVITE_EXPIRACAO_DIAS} dias. Se não foi você quem esperava isso, ignore este e-mail.
          </p>
        </div>
      </div>`,
    });
  }

  // CA "convite possui status pendente/aceito/expirado" — 'expirado' nunca é
  // gravado no banco, é computado na leitura (evita precisar de um job
  // periódico só pra atualizar a coluna).
  fastify.get('/api/equipe', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request) => {
    const { tenantId } = request.user;
    const { rows: membros } = await pool.query(
      `SELECT id, nome, email, role, ativo, criado_em
       FROM usuarios WHERE tenant_id = $1 ORDER BY criado_em`,
      [tenantId]
    );
    const { rows: convites } = await pool.query(
      `SELECT id, email, role,
              CASE WHEN status = 'pendente' AND expires_at < now() THEN 'expirado' ELSE status END AS status,
              expires_at, criado_em
       FROM convites_equipe
       WHERE tenant_id = $1 AND status IN ('pendente', 'expirado')
       ORDER BY criado_em DESC`,
      [tenantId]
    );
    return { membros, convites };
  });

  fastify.post('/api/equipe/convites', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const { email: emailBruto, role, profissional_id: profissionalId } = request.body || {};
    const email = (emailBruto || '').toLowerCase().trim();

    if (!EMAIL_REGEX.test(email)) {
      return reply.code(400).send({ error: 'Digite um e-mail válido.' });
    }
    if (!ROLES_VALIDOS.includes(role)) {
      return reply.code(400).send({ error: 'Selecione um perfil de acesso válido.' });
    }
    // Acesso de profissional é sempre vinculado a um profissional específico
    // (1:1 — a FK uq_usuarios_profissional garante só um login por
    // profissional) e nunca pede senha (ver aceite do convite abaixo).
    if (role === 'profissional') {
      if (!profissionalId) {
        return reply.code(400).send({ error: 'Selecione o profissional vinculado a este convite.' });
      }
      const { rows: profRows } = await pool.query(
        'SELECT id FROM profissionais WHERE id = $1 AND tenant_id = $2',
        [profissionalId, tenantId],
      );
      if (profRows.length === 0) {
        return reply.code(400).send({ error: 'Profissional não encontrado.' });
      }
      const { rows: jaVinculado } = await pool.query(
        `SELECT 1 FROM usuarios WHERE profissional_id = $1
         UNION ALL
         SELECT 1 FROM convites_equipe WHERE profissional_id = $1 AND status = 'pendente'`,
        [profissionalId],
      );
      if (jaVinculado.length > 0) {
        return reply.code(409).send({ error: 'Este profissional já tem um acesso ou convite pendente.' });
      }
    }

    const { rows: usuarioExistente } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.length > 0) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado no Kyvvo.' });
    }

    const { rows: quemConvida } = await pool.query(
      `SELECT u.nome AS convidado_por_nome, t.nome AS tenant_nome FROM usuarios u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId]
    );
    const { convidado_por_nome: convidadoPorNome, tenant_nome: tenantNome } = quemConvida[0];

    const token = gerarTokenConvite();
    const expiresAt = new Date(Date.now() + CONVITE_EXPIRACAO_DIAS * 24 * 60 * 60000);

    const client = await pool.connect();
    let convite;
    try {
      await client.query('BEGIN');
      // Reenviar convite pro mesmo e-mail cancela o pendente anterior antes
      // de criar o novo — o índice único (tenant_id, lower(email)) WHERE
      // status='pendente' é o cinto de segurança contra corrida.
      await client.query(
        `UPDATE convites_equipe SET status = 'cancelado' WHERE tenant_id = $1 AND lower(email) = $2 AND status = 'pendente'`,
        [tenantId, email]
      );
      const { rows } = await client.query(
        `INSERT INTO convites_equipe (tenant_id, email, role, token, convidado_por, expires_at, profissional_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, role, status, expires_at, criado_em`,
        [tenantId, email, role, token, userId, expiresAt.toISOString(), role === 'profissional' ? profissionalId : null]
      );
      convite = rows[0];
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Já existe um convite pendente para este e-mail.' });
      }
      throw erro;
    } finally {
      client.release();
    }

    const origemApp = `${request.protocol}://${request.hostname}`;
    const link = `${origemApp}/equipe-convite.html?token=${token}`;
    enviarConviteEmail({ email, tenantNome, convidadoPorNome, link, role });

    reply.code(201);
    return convite;
  });

  fastify.delete('/api/equipe/convites/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `UPDATE convites_equipe SET status = 'cancelado'
       WHERE id = $1 AND tenant_id = $2 AND status = 'pendente'
       RETURNING id`,
      [request.params.id, tenantId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Convite pendente não encontrado.' });
    }
    return { ok: true };
  });

  // Pública (sem fastify.authenticate) — quem recebeu o convite ainda não
  // tem sessão. Só devolve o mínimo pra montar a tela (CA "convite possui
  // status"): nunca vaza o token de volta, nem dados de outros convites.
  fastify.get('/api/equipe/convites/:token', async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT c.email, c.role,
              CASE WHEN c.status = 'pendente' AND c.expires_at < now() THEN 'expirado' ELSE c.status END AS status,
              t.nome AS tenant_nome, p.nome AS profissional_nome
       FROM convites_equipe c JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN profissionais p ON p.id = c.profissional_id
       WHERE c.token = $1`,
      [request.params.token]
    );
    const convite = rows[0];
    if (!convite) {
      return reply.code(404).send({ error: 'Convite não encontrado.' });
    }
    return convite;
  });

  fastify.post('/api/equipe/convites/:token/aceitar', async (request, reply) => {
    const { nome: nomeBruto, senha } = request.body || {};
    const nome = (nomeBruto || '').trim();

    if (nome.length < 2) {
      return reply.code(400).send({ error: 'Informe seu nome.' });
    }

    const { rows } = await pool.query(
      `SELECT id, tenant_id, email, role, profissional_id,
              CASE WHEN status = 'pendente' AND expires_at < now() THEN 'expirado' ELSE status END AS status
       FROM convites_equipe WHERE token = $1`,
      [request.params.token]
    );
    const convite = rows[0];
    if (!convite) {
      return reply.code(404).send({ error: 'Convite não encontrado.' });
    }
    if (convite.status !== 'pendente') {
      const mensagens = {
        aceito: 'Este convite já foi aceito.',
        expirado: 'Este convite expirou. Peça um novo convite ao administrador.',
        cancelado: 'Este convite foi cancelado.',
      };
      return reply.code(400).send({ error: mensagens[convite.status] || 'Convite inválido.' });
    }

    // Acesso de profissional nunca tem senha — login é só pelo token de
    // sessão de 90 dias criado abaixo (lib/sessao-profissional.js). Pros
    // demais perfis, continua exigindo senha como hoje.
    const ehProfissional = convite.role === 'profissional';
    if (!ehProfissional && !SENHA_REGEX.test(senha || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // E-mail já veio de um convite enviado pela própria Kyvvo — nasce
      // verificado, sem precisar do fluxo de token de 6 dígitos da US20.
      const hash = ehProfissional ? null : await bcrypt.hash(senha, 10);
      const { rows: usuarioRows } = await client.query(
        `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, role, email_verified, profissional_id)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         RETURNING id, token_version`,
        [convite.tenant_id, convite.email, hash, nome, convite.role, ehProfissional ? convite.profissional_id : null]
      );
      await client.query(`UPDATE convites_equipe SET status = 'aceito', aceito_em = now() WHERE id = $1`, [convite.id]);
      await client.query('COMMIT');

      if (ehProfissional) {
        // Nunca chama o kyvvo-platform (que é só usuário/senha) — a sessão
        // de profissional é um mecanismo paralelo, próprio deste papel.
        const token = await criarSessaoProfissional(pool, { usuarioId: usuarioRows[0].id, tenantId: convite.tenant_id });
        return { token, nome, email: convite.email, role: convite.role, email_verified: true };
      }

      // Corte P3 — sessão é RS256, emitida só pelo kyvvo-platform. O membro
      // acabou de definir a senha (em texto, ainda neste request), então
      // logamos ele server-to-server em vez de assinar nosso próprio token
      // — mesma UX de antes (já entra logado), sem @fastify/jwt aqui.
      let token = null;
      try {
        const resp = await fetch(`${PLATFORM_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: convite.email, senha }),
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          token = (await resp.json()).token || null;
        }
      } catch {
        // platform indisponível — a conta já foi criada (COMMIT acima); o
        // membro entra pela tela de login normalmente.
      }

      return {
        token,
        nome,
        email: convite.email,
        role: convite.role,
        email_verified: true,
        ...(token ? {} : { aviso: 'Conta criada. Faça login com seu e-mail e senha.' }),
      };
    } catch (erro) {
      await client.query('ROLLBACK');
      // Corrida: o e-mail virou usuário em outro tenant entre a checagem e o
      // INSERT (unicidade global de usuarios.email).
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Este e-mail já está cadastrado no Kyvvo.' });
      }
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/api/equipe/membros/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const { ativo } = request.body || {};
    if (typeof ativo !== 'boolean') {
      return reply.code(400).send({ error: 'Campo "ativo" deve ser verdadeiro ou falso.' });
    }
    if (request.params.id === userId) {
      return reply.code(400).send({ error: 'Você não pode desativar sua própria conta.' });
    }

    const { rows: membroRows } = await pool.query(
      'SELECT role FROM usuarios WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenantId]
    );
    const membro = membroRows[0];
    if (!membro) {
      return reply.code(404).send({ error: 'Membro não encontrado.' });
    }
    if (!ativo && membro.role === 'administrador') {
      const { rows: outrosAdmins } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM usuarios WHERE tenant_id = $1 AND role = 'administrador' AND ativo AND id <> $2`,
        [tenantId, request.params.id]
      );
      if (outrosAdmins[0].total === 0) {
        return reply.code(400).send({ error: 'Não é possível desativar o último administrador da conta.' });
      }
    }

    const { rows } = await pool.query(
      'UPDATE usuarios SET ativo = $3, token_version = token_version + 1 WHERE id = $1 AND tenant_id = $2 RETURNING id, nome, email, role, ativo',
      [request.params.id, tenantId, ativo]
    );
    // Sem isto, desativar não mataria uma sessão de 90 dias já aberta no
    // navegador do profissional (token_version acima não afeta esse
    // mecanismo paralelo). Inofensivo pros demais papéis (afeta 0 linhas).
    await revogarSessoesProfissional(pool, request.params.id);
    return rows[0];
  });

  fastify.delete('/api/equipe/membros/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    if (request.params.id === userId) {
      return reply.code(400).send({ error: 'Você não pode remover sua própria conta.' });
    }

    const { rows: membroRows } = await pool.query(
      'SELECT role FROM usuarios WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenantId]
    );
    const membro = membroRows[0];
    if (!membro) {
      return reply.code(404).send({ error: 'Membro não encontrado.' });
    }
    if (membro.role === 'administrador') {
      const { rows: outrosAdmins } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM usuarios WHERE tenant_id = $1 AND role = 'administrador' AND ativo AND id <> $2`,
        [tenantId, request.params.id]
      );
      if (outrosAdmins[0].total === 0) {
        return reply.code(400).send({ error: 'Não é possível remover o último administrador da conta.' });
      }
    }

    await pool.query('DELETE FROM usuarios WHERE id = $1 AND tenant_id = $2', [request.params.id, tenantId]);
    return { ok: true };
  });
}

module.exports = { registerEquipeRoutes };
