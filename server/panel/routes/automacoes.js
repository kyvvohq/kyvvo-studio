// Automações do Studio (menu Config > Automações). Espelha a tela do
// kyvvo-people: a lista mostra Nome / Gatilho / Ativa com ações Editar /
// Duplicar / Excluir, e o tenant pode ter VÁRIAS automações por gatilho
// (ex.: duas mensagens de "Confirmação de agenda"). O conjunto padrão é
// semeado na 1ª visita (garantirAutomacoesPadrao). Canal é sempre 'whatsapp'
// (não aparece na tela). Motor em lib/automacoes.js. O texto que o cliente
// recebe é o do template aprovado na Meta (whatsapp_template); `corpo` é só
// referência editável.
const crypto = require('crypto');
const { garantirAutomacoesPadrao } = require('../lib/automacoes');
const planosCatalogo = require('../lib/planos');
const { listarTemplates } = require('@kyvvohq/whatsapp');

// Mesmos valores do CHECK em db/070_automacoes_4_gatilhos.sql.
const GATILHOS_VALIDOS = [
  'agendamento_criado', 'agendamento_concluido',
  'aniversario_cliente', 'cliente_inativo',
];

const COLUNAS = `id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template, atualizado_em`;

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
      'SELECT meta_waba_id, meta_phone_number_id FROM tenants WHERE id = $1',
      [tenantId]
    );
    const wabaId = rows[0] && rows[0].meta_waba_id;
    // `conectado` separa "WhatsApp não conectado" de "conectado mas sem
    // modelo na lista" — a tela só pode mandar o cliente conectar o WhatsApp
    // no primeiro caso (antes qualquer lista vazia mostrava esse aviso, mesmo
    // com o número ativo e os modelos aprovados, achado 2026-09-11).
    const conectado = !!(wabaId || (rows[0] && rows[0].meta_phone_number_id));
    if (!wabaId) return { templates: [], conectado };
    try {
      const templates = await listarTemplates({ wabaId });
      return { templates, conectado };
    } catch (erro) {
      // Falha na Graph API não pode virar 500 nem o aviso errado de "conecte
      // o WhatsApp" — a tela mostra que não conseguiu carregar os modelos.
      fastify.log.error({ erro: erro.message, tenantId }, 'Falha ao listar templates do WhatsApp (automações)');
      return { templates: [], conectado, erro: true };
    }
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

    const { rows } = await pool.query(
      `INSERT INTO automacoes (id, tenant_id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template)
       VALUES ($1, $2, $3, 'whatsapp', $4, $5, true, $6, $7)
       RETURNING ${COLUNAS}`,
      [crypto.randomUUID(), tenantId, gatilho, nome, b.ativo !== false, corpo, b.whatsapp_template || null]
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
      `INSERT INTO automacoes (id, tenant_id, gatilho, canal, nome, ativo, removivel, corpo, whatsapp_template)
       VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)
       RETURNING ${COLUNAS}`,
      [crypto.randomUUID(), tenantId, a.gatilho, a.canal, `${a.nome} (cópia)`, a.corpo, a.whatsapp_template]
    );
    return reply.code(201).send(rows[0]);
  });

  // Edita nome / gatilho / ativo / corpo / template.
  fastify.patch('/api/automacoes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const {
      nome, gatilho, ativo, corpo,
      whatsapp_template: whatsappTemplate,
    } = request.body || {};

    const { rows: atuais } = await pool.query(
      'SELECT removivel FROM automacoes WHERE id = $1 AND tenant_id = $2',
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
    if (gatilho !== undefined) push('gatilho', String(gatilho));
    if (ativo !== undefined) push('ativo', ativo);
    if (corpo !== undefined) {
      const c = String(corpo).trim();
      if (!c) return reply.code(400).send({ error: 'Informe o texto de referência.' });
      push('corpo', c);
    }
    if (whatsappTemplate !== undefined) push('whatsapp_template', whatsappTemplate || null);

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

  // Relatório de disparos do próprio tenant (pedido do Bruno, 2026-09-20:
  // o cliente também precisa ver o que a Kyvvo já mostra no admin — uso do
  // mês vs. limite do plano + histórico). Sempre escopado por tenantId do
  // token, nunca recebe id de fora — um tenant nunca vê disparo de outro.
  fastify.get('/api/automacoes/disparos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows: disparos } = await pool.query(
      `select d.telefone_e164, d.template_nome, d.gatilho, d.status, d.criado_em, d.mensagem_texto,
              c.nome as cliente_nome
       from whatsapp_disparos d
       left join clientes c on c.tenant_id = d.tenant_id and c.telefone = replace(d.telefone_e164, '+', '')
       where d.tenant_id = $1 order by d.criado_em desc limit 200`,
      [tenantId]
    );
    const total = disparos.length;
    const realizados = disparos.filter((d) => d.status === 'enviado').length;

    const { rows: tRows } = await pool.query('select plano from tenants where id = $1', [tenantId]);
    const planoChave = tRows[0] ? tRows[0].plano : null;
    let limitePlano = null;
    if (planoChave) {
      const plano = planosCatalogo.obterPlano(planoChave);
      if (plano) {
        const inicioDoMes = new Date(); inicioDoMes.setDate(1); inicioDoMes.setHours(0, 0, 0, 0);
        const usadoMesAtual = disparos.filter((d) => d.status === 'enviado' && new Date(d.criado_em) >= inicioDoMes).length;
        limitePlano = { planoNome: plano.nome, limite: plano.limite_disparos, usadoMesAtual };
      }
    }

    return { total, realizados, disparos, limitePlano };
  });
}

module.exports = { registerAutomacoesRoutes };
