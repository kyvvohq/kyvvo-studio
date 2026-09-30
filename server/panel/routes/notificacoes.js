// Serviço de notificações — GET /api/notificacoes, consumido pelo balão do
// topo (polling, app.js). A ativação/desativação por tipo vive em
// routes/configuracao.js (campo notificacoes_ativas), reaproveitando o
// mesmo endpoint/padrão de save que Preferências já usa — este arquivo cuida
// da leitura dos pendentes, marcar como lida e o histórico (aba
// Configurações > Notificações > Histórico).
const {
  listarNotificacoesPendentes, marcarNotificacaoLida, marcarTodasNotificacoesLidas, listarHistoricoNotificacoes,
} = require('../lib/notificacoes');

function registerNotificacoesRoutes(fastify, pool) {
  fastify.get('/api/notificacoes', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT notificacoes_ativas FROM tenants WHERE id = $1', [tenantId]);
    const notificacoesAtivas = rows[0] && rows[0].notificacoes_ativas;
    const notificacoes = await listarNotificacoesPendentes(pool, tenantId, notificacoesAtivas);
    return { notificacoes };
  });

  fastify.patch('/api/notificacoes/:id/lida', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const ok = await marcarNotificacaoLida(pool, tenantId, request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Notificação não encontrada' });
    return { ok: true };
  });

  fastify.post('/api/notificacoes/marcar-todas-lidas', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const marcadas = await marcarTodasNotificacoesLidas(pool, tenantId);
    return { ok: true, marcadas };
  });

  fastify.get('/api/notificacoes/historico', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const historico = await listarHistoricoNotificacoes(pool, tenantId);
    return { historico };
  });
}

module.exports = { registerNotificacoesRoutes };
