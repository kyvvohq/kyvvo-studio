// Disparo manual de WhatsApp por seleção de clientes (tela de Clientes) —
// separado de clientes.js/automacoes.js porque a lógica genérica de
// cota+envio+registro agora vive em @kyvvohq/disparos (construído sobre
// @kyvvohq/whatsapp), não neste produto. Este arquivo só faz a parte
// específica do Studio: autenticação, resolver o plano/WABA do tenant,
// buscar os clientes selecionados e montar os parâmetros do template antes
// de delegar pro pacote.
const { telefoneParaE164 } = require('../lib/automacoes');
const planosCatalogo = require('../lib/planos');
const { listarTemplates } = require('@kyvvohq/whatsapp');
const { checarCotaDisparo, dispararEmLote } = require('@kyvvohq/disparos');

// Disparo manual só sabe preencher {{cliente}}/{{salao}} — não há
// agendamento associado pra {{servico}}/{{data}}/{{hora}}/{{profissional}}.
// O front já filtra o dropdown pra só esses templates (ver
// opcoesTemplateDisparoManual em app.js), mas a rota confere de novo (nunca
// confiar só no filtro do cliente).
const PARAMETROS_SUPORTADOS = new Set(['cliente', 'salao']);

// Sem parâmetro nenhum (ex.: "hello_world") sempre serve. Com parâmetro,
// só serve se for NOMEADO e todos os nomes forem dos que o disparo manual
// sabe preencher — template posicional antigo ({{1}}, {{2}}...) nunca serve
// (não dá pra saber o que cada posição significa fora do contexto de
// agendamento). Mesma regra em app.js (opcoesTemplateDisparoManual), pro
// dropdown já nascer filtrado.
function templateCompativelComDisparoManual(t) {
  if (!t.parametros_corpo.length) return true;
  return t.parametros_nomeados && t.parametros_corpo.every((nome) => PARAMETROS_SUPORTADOS.has(nome));
}

function registerDisparosRoutes(fastify, pool) {
  fastify.post('/api/clientes/disparo-lote', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const b = request.body || {};
    const clienteIds = Array.isArray(b.clienteIds) ? b.clienteIds : [];
    const templateNome = String(b.templateNome || '').trim();
    if (!clienteIds.length) return reply.code(400).send({ error: 'Selecione ao menos um cliente.' });
    if (!templateNome) return reply.code(400).send({ error: 'Escolha um modelo aprovado.' });

    const { rows: tRows } = await pool.query(
      'select nome, plano, meta_phone_number_id, meta_waba_id from tenants where id = $1',
      [tenantId]
    );
    const tenant = tRows[0];
    if (!tenant || !tenant.meta_phone_number_id) {
      return reply.code(400).send({ error: 'Conecte o WhatsApp antes de disparar.' });
    }

    const plano = tenant.plano ? planosCatalogo.obterPlano(tenant.plano) : null;
    const limiteDisparos = plano ? plano.limite_disparos : null;
    const cota = await checarCotaDisparo(pool, { tenantId, limiteDisparos, quantidade: clienteIds.length });
    if (!cota.ok) {
      return reply.code(409).send({ ok: false, erro: 'limite_plano', limite: cota.limite, usadoMesAtual: cota.usadoMesAtual, restante: cota.restante });
    }

    const templates = await listarTemplates({ wabaId: tenant.meta_waba_id });
    const templateInfo = templates.find((t) => t.nome === templateNome);
    if (!templateInfo) return reply.code(400).send({ error: 'Modelo não encontrado ou não aprovado.' });
    if (!templateCompativelComDisparoManual(templateInfo)) {
      return reply.code(400).send({ error: 'Esse modelo tem parâmetros que o disparo manual não sabe preencher.' });
    }

    const { rows: clientes } = await pool.query(
      'select id, nome, telefone, whatsapp_opt_out from clientes where tenant_id = $1 and id = any($2::uuid[])',
      [tenantId, clienteIds]
    );

    const dadosPorParametro = { salao: tenant.nome || '' };
    const destinatarios = clientes
      .map((c) => ({ c, telefoneE164: telefoneParaE164(c.telefone) }))
      .filter((d) => d.telefoneE164)
      .map(({ c, telefoneE164 }) => ({
        telefoneE164,
        optOut: !!c.whatsapp_opt_out,
        parametrosCorpo: templateInfo.parametros_corpo.map((nome) => ({
          nome, nomeado: true, valor: nome === 'cliente' ? (c.nome || '') : (dadosPorParametro[nome] || ''),
        })),
      }));

    const resultado = await dispararEmLote(pool, {
      tenantId, destinatarios, templateNome, phoneNumberId: tenant.meta_phone_number_id, gatilho: 'manual',
    });
    return { ok: true, ...resultado };
  });
}

module.exports = { registerDisparosRoutes };
