// Motor de automações do Studio — mensagens de WhatsApp por gatilho de
// agendamento (schema: db/068_automacoes.sql + db/069_whatsapp_travas.sql).
// Espelha kyvvo-people/lib/automacoes.js, adaptado: contexto de agendamento,
// só canal WhatsApp, várias automações por gatilho (tenant-wide), número/WABA Meta POR TENANT
// (tenants.meta_phone_number_id/meta_waba_id, token de System User
// compartilhado — @kyvvohq/whatsapp v1.1.0 aceita phoneNumberId/wabaId por
// chamada).
//
// Quatro gatilhos: agendamento_criado (Confirmação de agenda) e
// agendamento_concluido (Feedback do serviço) são de EVENTO;
// aniversario_cliente e cliente_inativo (Clientes inativos) são por TEMPO.
//
// Três responsabilidades:
//  - garantirAutomacoesPadrao(pool, tenantId): semeia a automação padrão de
//    cada gatilho (idempotente).
//  - dispararAutomacoes(pool, {gatilho, agendamento}): gatilhos de EVENTO,
//    chamado por routes/agenda.js (criar / concluir).
//  - processarAniversarios/Inativos(pool) + processarFilaWhatsapp:
//    gatilhos por TEMPO e a fila de fora-do-horário, chamados pelo worker
//    (server/panel/index.js) a cada 5 min.
//
// Best-effort em todo lugar: uma automação mal configurada ou a Meta fora do
// ar nunca pode derrubar a rota (ou o worker) que chamou.
const crypto = require('crypto');
const { estaNoHorarioComercial } = require('./horario-comercial');
const planosCatalogo = require('./planos');
const { sincronizarLancamentoFinanceiro } = require('./financeiro');
const { dispararNotificacaoEvento } = require('./notificacoes');

// Lazy: os testes unitários exercitam só as funções puras (renderizar,
// montarParametrosWhatsapp, telefoneParaE164...) sem precisar do pacote
// instalado. As funções de envio/fila resolvem o require na 1ª chamada.
let _whatsapp;
function whatsapp() { return _whatsapp || (_whatsapp = require('@kyvvohq/whatsapp')); }
const enviarTemplate = (...a) => whatsapp().enviarTemplate(...a);
const listarTemplates = (...a) => whatsapp().listarTemplates(...a);

// A automação PADRÃO de cada gatilho, criada sem o tenant precisar abrir a
// tela. O tenant pode adicionar/duplicar outras pela tela (várias por
// gatilho). `corpo` é preview/referência editável — o texto que o cliente
// recebe é o do template aprovado na Meta. `whatsapp_template` nasce nulo:
// o tenant escolhe na tela um modelo aprovado na WABA dele (a automação só
// dispara depois disso).
const SEEDS = [
  { gatilho: 'agendamento_criado', nome: 'Confirmação de agenda',
    corpo: 'Oi, {{cliente}}! Seu horário de {{servico}} com {{profissional}} está confirmado para {{data}} às {{hora}}. Até lá! — {{salao}}' },
  { gatilho: 'agendamento_concluido', nome: 'Feedback do serviço', ativo: false,
    corpo: 'Oi, {{cliente}}! Esperamos que tenha gostado do seu {{servico}} com {{profissional}}. Conta pra gente como foi? — {{salao}}' },
  { gatilho: 'aniversario_cliente', nome: 'Aniversário do cliente', ativo: false,
    corpo: 'Feliz aniversário, {{cliente}}! 🎉 Passa aqui pra comemorar com a gente. — {{salao}}' },
  { gatilho: 'cliente_inativo', nome: 'Clientes inativos', ativo: false,
    corpo: 'Oi, {{cliente}}! Faz um tempo que a gente não se vê. Bora marcar um horário? — {{salao}}' },
];

// Fallback pra template SEM parâmetro nomeado (posicional {{1}}, {{2}}...).
// Com parâmetro nomeado (o caso esperado nos templates provisionados na
// Fase 2), os valores vêm de `dados` pelo nome — ver montarParametrosWhatsapp.
const PARAMETROS_CORPO_TEMPLATE = {
  agendamento_criado: (d) => [d.cliente, d.servico, d.profissional, d.data, d.hora],
  agendamento_concluido: (d) => [d.cliente, d.servico, d.profissional],
  aniversario_cliente: (d) => [d.cliente, d.salao],
  cliente_inativo: (d) => [d.cliente, d.salao],
};

function renderizar(texto, dados) {
  if (!texto) return texto;
  return String(texto).replace(/\{\{(\w+)\}\}/g, (m, chave) => (dados[chave] != null ? String(dados[chave]) : ''));
}

// Formata o data_hora do agendamento (timestamptz) pro fuso de Brasília.
function formatarDataHora(dataHora) {
  const d = dataHora instanceof Date ? dataHora : new Date(dataHora);
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { data: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}` };
}

// `dados` pras variáveis {{cliente}} {{servico}} {{data}} {{hora}}
// {{profissional}} {{salao}}. `ag` = linha do SELECT `detalhado` de agenda.js
// (cliente, servico, profissional, data_hora) + salao (nome do tenant).
function dadosDoAgendamento(ag, salao) {
  const { data, hora } = ag.data_hora ? formatarDataHora(ag.data_hora) : { data: '', hora: '' };
  return {
    cliente: ag.cliente || '',
    servico: ag.servico || '',
    profissional: ag.profissional || '',
    data, hora,
    salao: salao || '',
  };
}

// Reaproveita a lógica do People (@kyvvohq/whatsapp devolve parametros
// nomeados/posicionais em listarTemplates). Studio v1 não tem template com
// botão de URL — parametroBotao é sempre null.
function montarParametrosWhatsapp(gatilho, dados, templateInfo) {
  let parametrosCorpo;
  if (templateInfo && templateInfo.parametros_nomeados) {
    parametrosCorpo = templateInfo.parametros_corpo.map((nome) => ({
      nome, nomeado: true, valor: dados[nome] != null ? dados[nome] : '',
    }));
  } else {
    const montar = PARAMETROS_CORPO_TEMPLATE[gatilho];
    parametrosCorpo = (montar ? montar(dados) : []).map((valor) => ({ valor, nomeado: false }));
  }
  return { parametrosCorpo, parametroBotao: null };
}

async function garantirAutomacoesPadrao(pool, tenantId) {
  const { rows: existentes } = await pool.query(
    'select gatilho from automacoes where tenant_id = $1',
    [tenantId]
  );
  const jaTem = new Set(existentes.map((r) => r.gatilho));
  for (const seed of SEEDS) {
    if (jaTem.has(seed.gatilho)) continue;
    await pool.query(
      `insert into automacoes (id, tenant_id, gatilho, nome, ativo, corpo)
       values ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), tenantId, seed.gatilho, seed.nome, seed.ativo !== false, seed.corpo]
    );
  }
}

// --- Travas -----------------------------------------------------------------

async function enviadoRecentemente(pool, telefoneE164) {
  const { rows } = await pool.query(
    `select 1 from whatsapp_envios where telefone_e164 = $1 and enviado_em > now() - interval '24 hours' limit 1`,
    [telefoneE164]
  );
  return rows.length > 0;
}

async function registrarEnvioWhatsapp(pool, tenantId, telefoneE164) {
  await pool.query(
    'insert into whatsapp_envios (id, tenant_id, telefone_e164) values ($1, $2, $3)',
    [crypto.randomUUID(), tenantId, telefoneE164]
  );
}

// Trava de limite do plano (pedido do Bruno, 2026-09-19): cada plano tem um
// `limite_disparos` (editável no admin, Produtos > Studio > Editar plano) —
// até agora só era texto de marketing na página pública, nunca foi
// verificado de verdade. Mês corrente = calendário (dia 1 até agora), não
// "30 dias corridos" — é como o número aparece anunciado ("até N
// disparos/mês"). `limite_disparos` nulo (a maioria dos planos hoje) =
// sem trava, igual ao "ilimitado" já mostrado no admin.
async function limiteDoPlanoExcedido(pool, tenantId, planoChave) {
  if (!planoChave) return false;
  const plano = planosCatalogo.obterPlano(planoChave);
  if (!plano || plano.limite_disparos == null) return false;
  const { rows } = await pool.query(
    `select count(*)::int as total from whatsapp_disparos
     where tenant_id = $1 and status = 'enviado' and criado_em >= date_trunc('month', now())`,
    [tenantId]
  );
  return rows[0].total >= plano.limite_disparos;
}

// Histórico pro admin (US: aba WhatsApp > Disparos, Studio+People) — só
// desfechos finais (enviado/erro/bloqueado), nunca "enfileirado" (ver
// comentário da migration 078): evita contar a mesma tentativa duas vezes.
async function registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status, mensagemTexto }) {
  await pool.query(
    `insert into whatsapp_disparos (id, tenant_id, telefone_e164, template_nome, gatilho, status, mensagem_texto)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), tenantId, telefoneE164, templateNome || null, gatilho || null, status, mensagemTexto || null]
  );
}

async function enfileirarWhatsapp(pool, { tenantId, telefoneE164, templateNome, parametrosCorpo, parametroBotao, mensagemTexto }) {
  await pool.query(
    `insert into whatsapp_fila (id, tenant_id, telefone_e164, template_nome, parametros_corpo, parametro_botao, mensagem_texto)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), tenantId, telefoneE164, templateNome, JSON.stringify(parametrosCorpo), parametroBotao || null, mensagemTexto || null]
  );
}

// Reconstrói o texto final de um template (corpo aprovado na Meta, com
// placeholders {{nome_do_parametro}} nomeados ou {{1}}/{{2}}... posicionais)
// pra exibir na tela de Disparos — a Meta só recebe os parâmetros separados
// (enviarTemplate), nunca o texto já montado, então isso precisa ser
// refeito no nosso lado no momento do disparo (não dá pra recuperar depois,
// se o template mudar). `parametrosCorpo` é o mesmo array que já vai pro
// enviarTemplate: `[{nome?, valor, nomeado}]`.
function renderizarCorpoTemplate(corpo, parametrosCorpo) {
  if (!corpo) return '';
  if (!parametrosCorpo || !parametrosCorpo.length) return corpo;
  if (parametrosCorpo[0].nomeado) {
    return parametrosCorpo.reduce((texto, p) => texto.split(`{{${p.nome}}}`).join(String(p.valor)), corpo);
  }
  return parametrosCorpo.reduce((texto, p, i) => texto.split(`{{${i + 1}}}`).join(String(p.valor)), corpo);
}

// Match exato (mensagem inteira, sem acento, minúscula) — não substring, pra
// não confundir "vou parar de vir aqui" com um opt-out de verdade.
const PALAVRAS_OPT_OUT = ['parar', 'pare', 'sair', 'cancelar', 'stop', 'descadastrar', 'unsubscribe'];
function detectarOptOut(texto) {
  if (!texto) return false;
  const normalizado = String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return PALAVRAS_OPT_OUT.includes(normalizado);
}

// --- Envio (decisão: manda agora / enfileira / trava de 24h) ---------------

// `optOut` é flag do cliente (o caller já trouxe do SELECT). `instantaneo`:
// agendamento_criado sai na hora mesmo fora do horário (pedido do Bruno no
// People — a confirmação não pode atrasar); o resto respeita o horário.
async function enviarOuEnfileirar(pool, {
  tenantId, telefoneE164, optOut, gatilho, templateNome, parametrosCorpo, parametroBotao, phoneNumberId, wabaId, planoChave, corpoTemplate,
}) {
  if (!telefoneE164 || !templateNome) return;
  const mensagemTexto = renderizarCorpoTemplate(corpoTemplate, parametrosCorpo);
  if (optOut) { await registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status: 'bloqueado_optout', mensagemTexto }); return; }
  if (await enviadoRecentemente(pool, telefoneE164)) { await registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status: 'bloqueado_24h', mensagemTexto }); return; }
  if (await limiteDoPlanoExcedido(pool, tenantId, planoChave)) { await registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status: 'bloqueado_limite_plano', mensagemTexto }); return; }

  const instantaneo = gatilho === 'agendamento_criado' || (await estaNoHorarioComercial());
  if (!instantaneo) {
    await enfileirarWhatsapp(pool, { tenantId, telefoneE164, templateNome, parametrosCorpo, parametroBotao, mensagemTexto });
    return;
  }
  const enviado = await enviarTemplate({
    to: telefoneE164, templateName: templateNome, parametrosCorpo, parametroBotao, phoneNumberId,
  });
  if (enviado) {
    await registrarEnvioWhatsapp(pool, tenantId, telefoneE164);
    await registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status: 'enviado', mensagemTexto });
  } else {
    await registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status: 'erro', mensagemTexto });
  }
}

// Resolve TODAS as automações ativas do gatilho (com template escolhido) + o
// número/WABA/nome do tenant + o templateInfo, e chama enviarOuEnfileirar pra
// cada uma. A trava de 24h dentro de enviarOuEnfileirar (enviadoRecentemente,
// por telefone) garante que, se houver mais de uma automação no mesmo
// gatilho, o cliente recebe no máximo uma mensagem — mesma regra anti-spam
// do People, que cruza todas as automações.
async function dispararGatilho(pool, { tenantId, gatilho, telefoneE164, optOut, dados }) {
  const { rows: autos } = await pool.query(
    `select * from automacoes
     where tenant_id = $1 and gatilho = $2 and ativo = true and whatsapp_template is not null`,
    [tenantId, gatilho]
  );
  if (!autos.length) return false;

  const { rows: tRows } = await pool.query(
    'select nome, meta_phone_number_id, meta_waba_id, plano from tenants where id = $1',
    [tenantId]
  );
  const tenant = tRows[0];
  if (!tenant || !tenant.meta_phone_number_id) return false;

  const templates = await listarTemplates({ wabaId: tenant.meta_waba_id });
  for (const automacao of autos) {
    const templateInfo = templates.find((t) => t.nome === automacao.whatsapp_template);
    const { parametrosCorpo, parametroBotao } = montarParametrosWhatsapp(gatilho, dados, templateInfo);
    await enviarOuEnfileirar(pool, {
      tenantId, telefoneE164, optOut, gatilho,
      templateNome: automacao.whatsapp_template, parametrosCorpo, parametroBotao,
      phoneNumberId: tenant.meta_phone_number_id, wabaId: tenant.meta_waba_id, planoChave: tenant.plano,
      corpoTemplate: templateInfo && templateInfo.corpo,
    });
  }
  return true;
}

// --- Gatilhos de evento (routes/agenda.js) --------------------------------

// `agendamento` = a linha `detalhado` de agenda.js (cliente, cliente_telefone,
// servico, profissional, data_hora). Best-effort — nunca lança.
async function dispararAutomacoes(pool, { tenantId, gatilho, agendamento }) {
  try {
    await garantirAutomacoesPadrao(pool, tenantId);

    const { rows: cRows } = await pool.query(
      `select c.telefone, c.whatsapp_opt_out, t.nome as salao
       from clientes c join tenants t on t.id = c.tenant_id
       where c.tenant_id = $1 and c.telefone = $2 limit 1`,
      [tenantId, agendamento.cliente_telefone]
    );
    const cli = cRows[0];
    const telefoneE164 = telefoneParaE164(agendamento.cliente_telefone);
    if (!telefoneE164) return;

    await dispararGatilho(pool, {
      tenantId, gatilho, telefoneE164,
      optOut: !!(cli && cli.whatsapp_opt_out),
      dados: dadosDoAgendamento(agendamento, cli ? cli.salao : ''),
    });
  } catch (err) {
    console.error(`[automacoes] disparo ${gatilho} falhou: ${err.message}`);
  }
}

// --- Botão "Confirmar" da automação de Confirmação de agenda ---------------

// Chamado pelo webhook (routes/webhook-whatsapp.js) quando o cliente toca o
// botão de resposta rápida "Confirmar" no template da automação
// `agendamento_criado`. Confirma o atendimento 'a_confirmar' mais próximo do
// cliente (telefone já no formato salvo em clientes.telefone, sem tratar
// E.164 — mesmo valor que chega em `msg.from` do webhook da Meta). Não
// precisa de contexto de IA nenhum: é uma ação direta, sem conversa. Devolve
// o agendamento confirmado (pro chamador montar a mensagem de resposta) ou
// null se não achou nenhum 'a_confirmar' pendente pra esse telefone.
async function confirmarAgendamentoPorBotao(pool, { tenantId, telefone }) {
  const { rows } = await pool.query(
    `SELECT a.id, a.data_hora, s.nome AS servico, s.preco AS servico_preco,
            p.nome AS profissional, c.nome AS cliente, c.telefone AS cliente_telefone
     FROM agendamentos a
     JOIN clientes c ON c.id = a.cliente_id
     JOIN servicos s ON s.id = a.servico_id
     JOIN profissionais p ON p.id = a.profissional_id
     WHERE a.tenant_id = $1 AND c.telefone = $2 AND a.status = 'a_confirmar' AND a.data_hora > now()
     ORDER BY a.data_hora ASC LIMIT 1`,
    [tenantId, telefone]
  );
  const ag = rows[0];
  if (!ag) return null;

  await pool.query("UPDATE agendamentos SET status = 'confirmado', updated_at = now() WHERE id = $1", [ag.id]);
  await sincronizarLancamentoFinanceiro(pool, {
    tenantId, agendamentoId: ag.id, servicoNome: ag.servico, servicoPreco: ag.servico_preco,
    dataHora: ag.data_hora, statusAgendamento: 'confirmado',
  });

  const dataFormatada = new Date(ag.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  dispararNotificacaoEvento(pool, tenantId, 'agenda_confirmada', {
    titulo: 'Agendamento confirmado',
    detalhe: `${ag.servico} com ${ag.cliente || ag.cliente_telefone} — ${ag.profissional}, ${dataFormatada}`,
  }).catch(() => {});

  return ag;
}

// clientes.telefone no Studio guarda com DDI 55 (ver 056_clientes_telefone_ddi);
// a Meta quer E.164 com o '+'. Aceita também o formato sem DDI (10-11 díg) por
// segurança — nesse caso assume BR e prefixa 55.
function telefoneParaE164(telefone) {
  if (!telefone) return null;
  let d = String(telefone).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  else if (!d.startsWith('55') || d.length < 12 || d.length > 13) return null;
  return `+${d}`;
}

// --- Gatilhos por tempo (worker) -----------------------------------------

async function jaDisparou(pool, automacaoId, chave) {
  const { rows } = await pool.query(
    'select 1 from automacao_disparos where automacao_id = $1 and chave = $2',
    [automacaoId, chave]
  );
  return rows.length > 0;
}
async function marcarDisparo(pool, automacaoId, chave) {
  await pool.query(
    'insert into automacao_disparos (automacao_id, chave) values ($1, $2) on conflict do nothing',
    [automacaoId, chave]
  );
}

// Aniversário: clientes cujo dia/mês de data_nascimento == hoje (Brasília).
// Dedupe por cliente_id + ano.
async function processarAniversarios(pool) {
  const { rows: autos } = await pool.query(
    `select a.*, t.nome as salao, t.meta_phone_number_id, t.meta_waba_id, t.plano
     from automacoes a join tenants t on t.id = a.tenant_id
     where a.gatilho = 'aniversario_cliente' and a.ativo = true
       and a.whatsapp_template is not null and t.meta_phone_number_id is not null`
  );
  const ano = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date());
  let enviados = 0;
  for (const auto of autos) {
    const { rows: clis } = await pool.query(
      `select c.id, c.telefone as cliente_telefone, c.nome as cliente, c.whatsapp_opt_out
       from clientes c
       where c.tenant_id = $1 and c.excluido_em is null and c.data_nascimento is not null
         and to_char(c.data_nascimento, 'MM-DD') = to_char((now() at time zone 'America/Sao_Paulo'), 'MM-DD')`,
      [auto.tenant_id]
    );
    for (const cli of clis) {
      const chave = `${cli.id}-${ano}`;
      if (await jaDisparou(pool, auto.id, chave)) continue;
      const telefoneE164 = telefoneParaE164(cli.cliente_telefone);
      if (!telefoneE164) { await marcarDisparo(pool, auto.id, chave); continue; }
      await enviarComAuto(pool, auto, telefoneE164, !!cli.whatsapp_opt_out, { cliente: cli.cliente, salao: auto.salao });
      await marcarDisparo(pool, auto.id, chave);
      enviados++;
    }
  }
  return { enviados };
}

// Cliente inativo: sem agendamento (confirmado/concluido) há mais de
// tenants.cliente_inativo_dias. Dedupe por cliente_id + AAAAMM (no máximo 1x
// por mês por cliente).
async function processarInativos(pool) {
  const { rows: autos } = await pool.query(
    `select a.*, t.nome as salao, t.cliente_inativo_dias, t.meta_phone_number_id, t.meta_waba_id, t.plano
     from automacoes a join tenants t on t.id = a.tenant_id
     where a.gatilho = 'cliente_inativo' and a.ativo = true
       and a.whatsapp_template is not null and t.meta_phone_number_id is not null`
  );
  const aaaamm = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .format(new Date()).replace('-', '');
  let enviados = 0;
  for (const auto of autos) {
    const dias = auto.cliente_inativo_dias || 30;
    const { rows: clis } = await pool.query(
      `select c.id, c.telefone as cliente_telefone, c.nome as cliente, c.whatsapp_opt_out
       from clientes c
       where c.tenant_id = $1 and c.excluido_em is null
         and not exists (
           select 1 from agendamentos ag
           where ag.cliente_id = c.id and ag.status in ('confirmado', 'a_confirmar', 'concluido')
             and ag.data_hora > now() - ($2 * interval '1 day')
         )
         and exists (
           select 1 from agendamentos ag2 where ag2.cliente_id = c.id
         )`,
      [auto.tenant_id, dias]
    );
    for (const cli of clis) {
      const chave = `${cli.id}-${aaaamm}`;
      if (await jaDisparou(pool, auto.id, chave)) continue;
      const telefoneE164 = telefoneParaE164(cli.cliente_telefone);
      if (!telefoneE164) { await marcarDisparo(pool, auto.id, chave); continue; }
      await enviarComAuto(pool, auto, telefoneE164, !!cli.whatsapp_opt_out, { cliente: cli.cliente, salao: auto.salao });
      await marcarDisparo(pool, auto.id, chave);
      enviados++;
    }
  }
  return { enviados };
}

// Compartilhado pelos 3 processar* de tempo: já tem a automação + tenant
// (com meta_*) na mão, só monta os params e chama enviarOuEnfileirar.
async function enviarComAuto(pool, auto, telefoneE164, optOut, dados) {
  try {
    const templates = await listarTemplates({ wabaId: auto.meta_waba_id });
    const templateInfo = templates.find((t) => t.nome === auto.whatsapp_template);
    const { parametrosCorpo, parametroBotao } = montarParametrosWhatsapp(auto.gatilho, dados, templateInfo);
    await enviarOuEnfileirar(pool, {
      tenantId: auto.tenant_id, telefoneE164, optOut, gatilho: auto.gatilho,
      templateNome: auto.whatsapp_template, parametrosCorpo, parametroBotao,
      phoneNumberId: auto.meta_phone_number_id, wabaId: auto.meta_waba_id, planoChave: auto.plano,
      corpoTemplate: templateInfo && templateInfo.corpo,
    });
  } catch (err) {
    console.error(`[automacoes] envio ${auto.gatilho} falhou: ${err.message}`);
  }
}

// --- Fila de fora-do-horário (worker) -----------------------------------

async function processarFilaWhatsapp(pool) {
  if (!(await estaNoHorarioComercial())) return { processados: 0 };

  const { rows: pendentes } = await pool.query(
    `select f.*, c.whatsapp_opt_out, t.meta_phone_number_id, t.plano
     from whatsapp_fila f
     left join clientes c on c.tenant_id = f.tenant_id and c.telefone = replace(f.telefone_e164, '+', '')
     left join tenants t on t.id = f.tenant_id
     where f.processado_em is null order by f.criado_em limit 50`
  );

  let processados = 0;
  for (const item of pendentes) {
    try {
      if (item.whatsapp_opt_out || !item.meta_phone_number_id) {
        await pool.query('update whatsapp_fila set processado_em = now() where id = $1', [item.id]);
        if (item.whatsapp_opt_out) await registrarDisparo(pool, { tenantId: item.tenant_id, telefoneE164: item.telefone_e164, templateNome: item.template_nome, status: 'bloqueado_optout', mensagemTexto: item.mensagem_texto });
        continue;
      }
      if (await enviadoRecentemente(pool, item.telefone_e164)) continue; // tenta na próxima rodada
      if (await limiteDoPlanoExcedido(pool, item.tenant_id, item.plano)) {
        await pool.query('update whatsapp_fila set processado_em = now() where id = $1', [item.id]);
        await registrarDisparo(pool, { tenantId: item.tenant_id, telefoneE164: item.telefone_e164, templateNome: item.template_nome, status: 'bloqueado_limite_plano', mensagemTexto: item.mensagem_texto });
        continue;
      }

      const enviado = await enviarTemplate({
        to: item.telefone_e164, templateName: item.template_nome,
        parametrosCorpo: item.parametros_corpo, parametroBotao: item.parametro_botao,
        phoneNumberId: item.meta_phone_number_id,
      });
      await pool.query('update whatsapp_fila set processado_em = now() where id = $1', [item.id]);
      if (enviado) {
        await registrarEnvioWhatsapp(pool, item.tenant_id, item.telefone_e164);
        await registrarDisparo(pool, { tenantId: item.tenant_id, telefoneE164: item.telefone_e164, templateNome: item.template_nome, status: 'enviado', mensagemTexto: item.mensagem_texto });
        processados++;
      } else {
        await registrarDisparo(pool, { tenantId: item.tenant_id, telefoneE164: item.telefone_e164, templateNome: item.template_nome, status: 'erro', mensagemTexto: item.mensagem_texto });
      }
    } catch (err) {
      console.error(`[automacoes] falha no item ${item.id} da fila: ${err.message}`);
    }
  }
  return { processados, pendentesNaRodada: pendentes.length };
}

module.exports = {
  SEEDS,
  garantirAutomacoesPadrao,
  dispararAutomacoes,
  detectarOptOut,
  confirmarAgendamentoPorBotao,
  processarAniversarios,
  processarInativos,
  processarFilaWhatsapp,
  // exportados pros testes unitários
  renderizar,
  montarParametrosWhatsapp,
  telefoneParaE164,
  formatarDataHora,
  dadosDoAgendamento,
  registrarDisparo,
  limiteDoPlanoExcedido,
  renderizarCorpoTemplate,
};
