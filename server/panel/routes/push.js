// Assinatura de notificação push no navegador — Configurações > Notificações
// > Regras (canal "Push", lib/notificacoes.js). O botão "Ativar notificações
// push" (app/modulos/notificacoes.js) busca a chave pública aqui, registra o
// service worker e manda a assinatura resultante do navegador pra /subscribe.
const { VAPID_PUBLIC_KEY } = require('../lib/push');

function registerPushRoutes(fastify, pool) {
  fastify.get('/api/push/vapid-public-key', { preHandler: [fastify.authenticate] }, async () => {
    return { publicKey: VAPID_PUBLIC_KEY || null };
  });

  // ON CONFLICT (endpoint): o mesmo navegador pode re-assinar (ex: depois de
  // limpar o site data) sem gerar linha duplicada — sempre atualiza pro
  // usuário/tenant que está logado agora.
  fastify.post('/api/push/subscribe', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const { endpoint, keys } = request.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return reply.code(400).send({ error: 'Assinatura push inválida.' });
    }
    await pool.query(
      `INSERT INTO push_subscriptions (tenant_id, usuario_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         usuario_id = EXCLUDED.usuario_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent`,
      [tenantId, userId, endpoint, keys.p256dh, keys.auth, request.headers['user-agent'] || null]
    );
    return { ok: true };
  });

  fastify.post('/api/push/unsubscribe', { preHandler: [fastify.authenticate] }, async (request) => {
    const { endpoint } = request.body || {};
    if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    return { ok: true };
  });
}

module.exports = { registerPushRoutes };
