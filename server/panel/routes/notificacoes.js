// Serviço de notificações — GET /api/notificacoes, consumido pelo balão do
// topo (polling, app.js). A ativação/desativação por tipo vive em
// routes/configuracao.js (campo notificacoes_ativas), reaproveitando o
// mesmo endpoint/padrão de save que Preferências já usa — este arquivo é só
// leitura dos pendentes.
const { listarNotificacoesPendentes } = require('../lib/notificacoes');

function registerNotificacoesRoutes(fastify, pool) {
  fastify.get('/api/notificacoes', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT notificacoes_ativas FROM tenants WHERE id = $1', [tenantId]);
    const notificacoesAtivas = rows[0] && rows[0].notificacoes_ativas;
    const notificacoes = await listarNotificacoesPendentes(pool, tenantId, notificacoesAtivas);
    return { notificacoes };
  });
}

module.exports = { registerNotificacoesRoutes };
