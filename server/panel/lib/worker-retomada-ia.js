// Retomada proativa de atendimento da IA (Configurações > Preferências,
// pedido do Bruno 2026-10-21, opcional por tenant — ia_retomada_ativa):
// quando o cliente para de responder depois de uma pergunta do bot, o Studio
// manda um "nudge" de volta, até ia_retomada_tentativas vezes (1-3),
// espaçadas ia_retomada_intervalo_horas (1-3h), só dentro do horário de
// funcionamento do salão — e nunca depois que a janela de encerramento
// (ia_janela_encerramento_minutos, ver lib/ia-engine.js) já teria feito a
// próxima mensagem do cliente recomeçar a conversa do zero.
//
// Diferente do CRM (bot de fluxo fixo, sessão própria em
// crm_conversas_whatsapp): a IA Engine não tem sessão explícita — "o bot foi
// quem falou por último" é inferido pelo ÚLTIMO turno de `conversas_ia`
// (role='assistant'). O contador de tentativas/timestamp do último nudge
// mora em `clientes` (ia_retomada_tentativas/ia_retomada_ultima_em), mesmo
// padrão já usado por `aguardando_humano_desde` do worker-handoff.
//
// Mesmo princípio dos outros workers deste arquivo: setInterval dentro do
// próprio processo do painel, iniciado só no boot real (index.js), nunca em
// teste (build()/require não chega aqui).
const { dentroDoHorarioFuncionamento } = require('./horario-funcionamento');
const metaWhatsappService = require('../meta-whatsapp-service');

const INTERVALO_MS = 5 * 60 * 1000;

const MENSAGEM_RETOMADA_IA = 'Oi! 👋 Vi que paramos por aqui — ainda posso te ajudar com alguma coisa?';

// Testável sem Postgres real: pool.query + as 2 dependências de envio
// (enviarTexto, log) injetadas.
async function buscarCandidatosRetomada(pool) {
  const { rows } = await pool.query(
    `SELECT c.id AS cliente_id, c.tenant_id, c.telefone,
            t.meta_phone_number_id,
            t.dias_funcionamento, t.horario_abertura, t.horario_fechamento,
            t.horario_almoco_ativo, t.horario_almoco_inicio, t.horario_almoco_fim, t.feriados_bloqueados
       FROM clientes c
       JOIN tenants t ON t.id = c.tenant_id
       JOIN LATERAL (
         SELECT role, criado_em FROM conversas_ia
          WHERE tenant_id = c.tenant_id AND cliente_id = c.id
          ORDER BY criado_em DESC LIMIT 1
       ) ultima ON true
      WHERE t.ia_retomada_ativa = true
        AND t.tecnologia = 'ia'
        AND c.excluido_em IS NULL
        AND (c.status_conversa IS NULL OR c.status_conversa <> 'aguardando_humano')
        AND ultima.role = 'assistant'
        AND c.ia_retomada_tentativas < t.ia_retomada_tentativas
        AND ultima.criado_em > now() - (t.ia_janela_encerramento_minutos || ' minutes')::interval
        AND COALESCE(c.ia_retomada_ultima_em, ultima.criado_em) < now() - (t.ia_retomada_intervalo_horas || ' hours')::interval`
  );
  return rows;
}

async function processarRetomadasIA(pool, { enviarTexto, log } = {}) {
  const candidatos = await buscarCandidatosRetomada(pool);
  let enviados = 0;
  for (const c of candidatos) {
    const validacao = dentroDoHorarioFuncionamento(c, new Date().toISOString(), 0);
    if (!validacao.valido) continue; // eslint-disable-line no-continue

    try {
      // eslint-disable-next-line no-await-in-loop
      await enviarTexto(c.meta_phone_number_id, c.telefone, MENSAGEM_RETOMADA_IA);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO conversas_ia (tenant_id, cliente_id, role, conteudo) VALUES ($1, $2, 'assistant', $3)`,
        [c.tenant_id, c.cliente_id, MENSAGEM_RETOMADA_IA]
      );
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        'UPDATE clientes SET ia_retomada_tentativas = ia_retomada_tentativas + 1, ia_retomada_ultima_em = now() WHERE id = $1',
        [c.cliente_id]
      );
      enviados += 1;
    } catch (erro) {
      log && log.error({ erro: erro.message, clienteId: c.cliente_id }, '[worker-retomada-ia] falha ao enviar nudge');
    }
  }
  return { enviados };
}

function iniciarWorkerRetomadaIA(pool, log) {
  const ciclo = async () => {
    try {
      const { enviados } = await processarRetomadasIA(pool, { enviarTexto: metaWhatsappService.enviarTexto, log });
      if (enviados) log.info({ enviados }, '[worker-retomada-ia] nudges enviados');
    } catch (erro) {
      log.error({ erro: erro.message }, '[worker-retomada-ia] falha no ciclo');
    }
  };
  const timer = setInterval(ciclo, INTERVALO_MS);
  if (timer.unref) timer.unref();
  ciclo();
  return timer;
}

module.exports = {
  buscarCandidatosRetomada, processarRetomadasIA, iniciarWorkerRetomadaIA, INTERVALO_MS, MENSAGEM_RETOMADA_IA,
};
