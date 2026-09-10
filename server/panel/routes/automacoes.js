// Automações do Studio (menu Config > Automações) — CRUD mínimo: a tela lista
// as automações (uma por gatilho, semeadas na 1ª visita), o tenant liga/
// desliga, edita o texto de referência, escolhe o template aprovado da WABA
// dele e ajusta "horas antes" do lembrete. Sem POST/DELETE — o conjunto de
// gatilhos é fixo. Motor em lib/automacoes.js.
const { garantirAutomacoesPadrao } = require('../lib/automacoes');
const { listarTemplates } = require('@kyvvohq/whatsapp');

function registerAutomacoesRoutes(fastify, pool) {
  // Lista as automações do tenant (garante os seeds antes — cobre quem nunca
  // abriu a tela).
  fastify.get('/api/automacoes', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    await garantirAutomacoesPadrao(pool, tenantId);
    const { rows } = await pool.query(
      `SELECT id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template,
              lembrete_horas_antes, atualizado_em
       FROM automacoes WHERE tenant_id = $1 ORDER BY gatilho`,
      [tenantId]
    );
    return { automacoes: rows };
  });

  // Templates de WhatsApp aprovados na WABA do tenant — vira o <select> da
  // tela. Sem número/WABA vinculado ainda, devolve lista vazia (a tela mostra
  // o aviso de "conecte o WhatsApp primeiro").
  fastify.get('/api/automacoes/templates-whatsapp', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT meta_waba_id FROM tenants WHERE id = $1',
      [tenantId]
    );
    const wabaId = rows[0] && rows[0].meta_waba_id;
    if (!wabaId) return { templates: [] };
    const templates = await listarTemplates({ wabaId });
    return { templates };
  });

  // Edita ativo / corpo / template / horas-antes de uma automação.
  fastify.patch('/api/automacoes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { ativo, corpo, whatsapp_template: whatsappTemplate, lembrete_horas_antes: lembreteHorasAntes } = request.body || {};

    const { rows: atuais } = await pool.query(
      'SELECT gatilho, removivel FROM automacoes WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const atual = atuais[0];
    if (!atual) return reply.code(404).send({ error: 'Automação não encontrada' });

    if (ativo === false && atual.removivel === false) {
      return reply.code(400).send({ error: 'Esta automação é obrigatória e não pode ser desligada.' });
    }
    if (lembreteHorasAntes !== undefined) {
      if (atual.gatilho !== 'lembrete_agendamento') {
        return reply.code(400).send({ error: '"lembrete_horas_antes" só se aplica ao lembrete de agendamento.' });
      }
      const n = Number(lembreteHorasAntes);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        return reply.code(400).send({ error: '"lembrete_horas_antes" deve ser um inteiro entre 1 e 168.' });
      }
    }

    const sets = [];
    const valores = [id, tenantId];
    for (const [col, val] of [
      ['ativo', ativo],
      ['corpo', corpo],
      ['whatsapp_template', whatsappTemplate],
      ['lembrete_horas_antes', lembreteHorasAntes],
    ]) {
      if (val === undefined) continue;
      valores.push(val);
      sets.push(`${col} = $${valores.length}`);
    }
    if (!sets.length) return reply.code(400).send({ error: 'Nada para atualizar.' });

    await pool.query(
      `UPDATE automacoes SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1 AND tenant_id = $2`,
      valores
    );
    const { rows } = await pool.query(
      `SELECT id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template,
              lembrete_horas_antes, atualizado_em
       FROM automacoes WHERE id = $1`,
      [id]
    );
    return rows[0];
  });
}

module.exports = { registerAutomacoesRoutes };
