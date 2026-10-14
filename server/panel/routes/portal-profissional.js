// Portal do profissional — único endpoint de dados próprio deste acesso
// restrito (a agenda reaproveita GET /api/agendamentos, já escopada por
// profissional_id quando request.user.profissionalId existe, ver
// routes/agenda.js). Financeiro é CALCULADO (preço do serviço × atendimentos
// concluídos dele) — nunca um filtro sobre lancamentos_financeiros, que é um
// livro-caixa manual sem ligação com profissional/agendamento.
const { mesAtualBrasilia } = require('../lib/datetime');

function registerPortalProfissionalRoutes(fastify, pool) {
  fastify.get(
    '/api/portal-profissional/resumo',
    { preHandler: [fastify.authenticate, fastify.requireProfissional] },
    async (request, reply) => {
      const { tenantId, profissionalId } = request.user;
      const mes = request.query.mes || mesAtualBrasilia();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return reply.code(422).send({ error: 'mes deve estar no formato YYYY-MM' });
      }
      const [ano, mesNum] = mes.split('-').map(Number);
      const mesInicio = new Date(Date.UTC(ano, mesNum - 1, 1)).toISOString();
      const mesFim = new Date(Date.UTC(ano, mesNum, 1)).toISOString();

      // Mesmo padrão de routes/relatorios.js: SUM(preco) sobre atendimentos
      // 'concluido', aqui escopado ao profissional da sessão.
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(s.preco), 0) AS receita, COUNT(*)::int AS atendimentos
           FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
          WHERE a.tenant_id = $1 AND a.profissional_id = $2
            AND a.data_hora >= $3::timestamptz AND a.data_hora < $4::timestamptz
            AND a.status = 'concluido'`,
        [tenantId, profissionalId, mesInicio, mesFim],
      );
      return { mes, receita: Number(rows[0].receita), atendimentos: rows[0].atendimentos };
    },
  );
}

module.exports = { registerPortalProfissionalRoutes };
