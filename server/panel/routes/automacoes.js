// Automações do Studio (menu Config > Automações). Espelha a tela do
// kyvvo-people: a lista mostra Nome / Gatilho / Canal / Ativo com ações
// Editar / Duplicar / Excluir, e o tenant pode ter VÁRIAS automações por
// gatilho (ex.: dois lembretes em horas diferentes, ou duas mensagens de
// "agendamento criado"). O conjunto padrão é semeado na 1ª visita
// (garantirAutomacoesPadrao). Canal é sempre 'whatsapp' no v1. Motor em
// lib/automacoes.js. O texto que o cliente recebe é o do template aprovado
// na Meta (whatsapp_template); `corpo` é só referência editável.
const crypto = require('crypto');
const { garantirAutomacoesPadrao } = require('../lib/automacoes');
const { listarTemplates } = require('@kyvvohq/whatsapp');

// Mesmos valores do CHECK em db/068_automacoes.sql.
const GATILHOS_VALIDOS = [
  'agendamento_criado', 'agendamento_cancelado', 'agendamento_concluido',
  'agendamento_falta', 'agendamento_reagendado',
  'lembrete_agendamento', 'aniversario_cliente', 'cliente_inativo',
];

const COLUNAS = `id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template,
                 lembrete_horas_antes, atualizado_em`;

// Normaliza lembrete_horas_antes conforme o CHECK do banco: obrigatório
// (1-168) quando o gatilho é lembrete_agendamento, sempre null nos demais.
// `entrada` pode vir undefined (não mexer / usar default).
function normalizarHoras(gatilho, entrada, atual) {
  if (gatilho !== 'lembrete_agendamento') return { ok: true, valor: null };
  const bruto = entrada !== undefined ? entrada : (atual != null ? atual : 24);
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 1 || n > 168) {
    return { ok: false, erro: '"lembrete_horas_antes" deve ser um inteiro entre 1 e 168.' };
  }
  return { ok: true, valor: n };
}

function registerAutomacoesRoutes(fastify, pool) {
  // Lista as automações do tenant (garante os seeds antes — cobre quem nunca
  // abriu a tela).
  fastify.get('/api/automacoes', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    await garantirAutomacoesPadrao(pool, tenantId);
    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM automacoes WHERE tenant_id = $1 ORDER BY gatilho, criado_em`,
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

  // Cria uma automação nova (botão "+ Nova automação").
  fastify.post('/api/automacoes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const b = request.body || {};
    const gatilho = String(b.gatilho || '');
    const nome = String(b.nome || '').trim();
    const corpo = String(b.corpo || '').trim();
    if (!GATILHOS_VALIDOS.includes(gatilho)) return reply.code(400).send({ error: 'Gatilho inválido.' });
    if (!nome) return reply.code(400).send({ error: 'Informe um nome.' });
    if (!corpo) return reply.code(400).send({ error: 'Informe o texto de referência.' });
    const horas = normalizarHoras(gatilho, b.lembrete_horas_antes, null);
    if (!horas.ok) return reply.code(400).send({ error: horas.erro });

    const { rows } = await pool.query(
      `INSERT INTO automacoes (id, tenant_id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template, lembrete_horas_antes)
       VALUES ($1, $2, $3, 'whatsapp', $4, $5, true, $6, $7, $8)
       RETURNING ${COLUNAS}`,
      [crypto.randomUUID(), tenantId, gatilho, nome, b.ativo !== false, corpo,
       b.whatsapp_template || null, horas.valor]
    );
    return reply.code(201).send(rows[0]);
  });

  // Duplica uma automação existente — a cópia nasce desativada pro tenant
  // revisar antes de ligar.
  fastify.post('/api/automacoes/:id/duplicar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows: base } = await pool.query(
      'SELECT * FROM automacoes WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenantId]
    );
    if (!base[0]) return reply.code(404).send({ error: 'Automação não encontrada' });
    const a = base[0];
    const { rows } = await pool.query(
      `INSERT INTO automacoes (id, tenant_id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template, lembrete_horas_antes)
       VALUES ($1, $2, $3, $4, $5, false, true, $6, $7, $8)
       RETURNING ${COLUNAS}`,
      [crypto.randomUUID(), tenantId, a.gatilho, a.canal, `${a.nome} (cópia)`,
       a.corpo, a.whatsapp_template, a.lembrete_horas_antes]
    );
    return reply.code(201).send(rows[0]);
  });

  // Edita nome / gatilho / ativo / corpo / template / horas-antes.
  fastify.patch('/api/automacoes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const {
      nome, gatilho, ativo, corpo,
      whatsapp_template: whatsappTemplate,
      lembrete_horas_antes: lembreteHorasAntes,
    } = request.body || {};

    const { rows: atuais } = await pool.query(
      'SELECT gatilho, removivel, lembrete_horas_antes FROM automacoes WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const atual = atuais[0];
    if (!atual) return reply.code(404).send({ error: 'Automação não encontrada' });

    if (ativo === false && atual.removivel === false) {
      return reply.code(400).send({ error: 'Esta automação é obrigatória e não pode ser desligada.' });
    }
    if (gatilho !== undefined && !GATILHOS_VALIDOS.includes(String(gatilho))) {
      return reply.code(400).send({ error: 'Gatilho inválido.' });
    }

    const sets = [];
    const valores = [id, tenantId];
    const push = (col, val) => { valores.push(val); sets.push(`${col} = $${valores.length}`); };

    if (nome !== undefined) {
      const n = String(nome).trim();
      if (!n) return reply.code(400).send({ error: 'Informe um nome.' });
      push('nome', n);
    }
    if (ativo !== undefined) push('ativo', ativo);
    if (corpo !== undefined) {
      const c = String(corpo).trim();
      if (!c) return reply.code(400).send({ error: 'Informe o texto de referência.' });
      push('corpo', c);
    }
    if (whatsappTemplate !== undefined) push('whatsapp_template', whatsappTemplate || null);

    // gatilho e horas andam juntos: mudar o gatilho pode exigir setar/limpar
    // lembrete_horas_antes pro CHECK do banco bater.
    const gatilhoFinal = gatilho !== undefined ? String(gatilho) : atual.gatilho;
    if (gatilho !== undefined) push('gatilho', gatilhoFinal);
    if (gatilho !== undefined || lembreteHorasAntes !== undefined) {
      const horas = normalizarHoras(gatilhoFinal, lembreteHorasAntes, atual.lembrete_horas_antes);
      if (!horas.ok) return reply.code(400).send({ error: horas.erro });
      push('lembrete_horas_antes', horas.valor);
    }

    if (!sets.length) return reply.code(400).send({ error: 'Nada para atualizar.' });

    await pool.query(
      `UPDATE automacoes SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1 AND tenant_id = $2`,
      valores
    );
    const { rows } = await pool.query(`SELECT ${COLUNAS} FROM automacoes WHERE id = $1`, [id]);
    return rows[0];
  });

  // Exclui uma automação. Bloqueia as obrigatórias (removivel=false), igual
  // no People. automacao_disparos cai por ON DELETE CASCADE (db/069).
  fastify.delete('/api/automacoes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT removivel FROM automacoes WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenantId]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Automação não encontrada' });
    if (rows[0].removivel === false) {
      return reply.code(403).send({ error: 'Esta automação é obrigatória e não pode ser excluída.' });
    }
    await pool.query('DELETE FROM automacoes WHERE id = $1 AND tenant_id = $2', [request.params.id, tenantId]);
    return { ok: true };
  });
}

module.exports = { registerAutomacoesRoutes };
