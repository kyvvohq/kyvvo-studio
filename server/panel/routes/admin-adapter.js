// Adapter admin — endpoint server-to-server consumido pelo Kyvvo Admin
// (kyvvo-platform) pra montar o painel "Produtos" da visão 360° de um tenant.
//
// NÃO usa o JWT de admin: é chamada de serviço pra serviço, na rede interna
// do compose (http://studio:3001), autenticada por um segredo compartilhado
// — ADMIN_ADAPTER_TOKEN, provisionado no SSM em /kyvvo/studio/ e
// /kyvvo/platform/ com o mesmo valor. Sem esse token no ambiente o endpoint
// responde 503 e o Admin degrada mostrando "painel do produto indisponível".
//
// Só leitura. Contrato (envelope comum a todos os produtos):
//   { produto, rotulo, metricas: [{ chave, rotulo, valor }], ultima_atividade }

const crypto = require('crypto');

function tokenConfere(header) {
  const esperado = process.env.ADMIN_ADAPTER_TOKEN;
  if (!esperado) return false;
  const recebido = String(header || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function registerAdminAdapterRoutes(fastify, pool) {
  fastify.get('/admin-adapter/tenants/:id', async (request, reply) => {
    if (!process.env.ADMIN_ADAPTER_TOKEN) {
      return reply.code(503).send({ error: 'Adapter não configurado neste ambiente.' });
    }
    if (!tokenConfere(request.headers.authorization)) {
      return reply.code(401).send({ error: 'Não autorizado.' });
    }

    const { id } = request.params;
    const { rows: existe } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [id]);
    if (!existe[0]) {
      return reply.code(404).send({ error: 'Tenant não encontrado neste produto.' });
    }

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM servicos       WHERE tenant_id = $1) AS servicos,
         (SELECT count(*)::int FROM profissionais  WHERE tenant_id = $1) AS profissionais,
         (SELECT count(*)::int FROM clientes       WHERE tenant_id = $1 AND excluido_em IS NULL) AS clientes,
         (SELECT count(*)::int FROM agendamentos   WHERE tenant_id = $1) AS agendamentos_total,
         (SELECT count(*)::int FROM agendamentos   WHERE tenant_id = $1 AND data_hora >= now() - interval '30 days') AS agendamentos_30d,
         (SELECT max(data_hora) FROM agendamentos  WHERE tenant_id = $1) AS ultimo_agendamento`,
      [id],
    );
    const c = rows[0];

    return {
      produto: 'studio',
      rotulo: 'Kyvvo Studio',
      metricas: [
        { chave: 'profissionais', rotulo: 'Profissionais', valor: c.profissionais },
        { chave: 'servicos', rotulo: 'Serviços', valor: c.servicos },
        { chave: 'clientes', rotulo: 'Clientes', valor: c.clientes },
        { chave: 'agendamentos_total', rotulo: 'Agendamentos (total)', valor: c.agendamentos_total },
        { chave: 'agendamentos_30d', rotulo: 'Agendamentos (30 dias)', valor: c.agendamentos_30d },
      ],
      ultima_atividade: c.ultimo_agendamento,
    };
  });
}

module.exports = { registerAdminAdapterRoutes, tokenConfere };
