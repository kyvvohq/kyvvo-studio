// Validação de horário de funcionamento e bloqueios de agenda — extraído de
// index.js (fase 1 da modularização). `buscarBloqueioConflitante` precisa do
// pool do Postgres; segue o mesmo padrão `init(pool)` já usado em
// token-service.js — chamar init() uma vez em index.js antes de qualquer
// rota usar este módulo.
const { diaDaSemanaBrasilia, componentesBrasilia, isoDeComponentesBrasilia, horarioParaMinutos, minutosNoDia } = require('./datetime');
const { ehFeriadoNacional } = require('./feriados');

let pool;
function init(poolInstance) {
  pool = poolInstance;
}

// Valida um agendamento (dia da semana + feriado nacional, se bloqueado +
// intervalo abertura/fechamento + intervalo de almoço, se ativo) contra a
// configuração de horário do tenant. `duracaoMinutos` (padrão 0) deixa o fim
// do agendamento também respeitar o fechamento/almoço, não só o início —
// usado tanto pra validar POST/PATCH de agendamentos quanto pra filtrar
// slots de disponibilidade.
function dentroDoHorarioFuncionamento(tenant, dataHoraISO, duracaoMinutos = 0) {
  const diasFuncionamento = tenant.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  if (!diasFuncionamento.includes(diaDaSemanaBrasilia(dataHoraISO))) {
    return { valido: false, motivo: 'O estabelecimento não abre nesse dia.' };
  }

  if (tenant.feriados_bloqueados) {
    const { ano, mes, dia } = componentesBrasilia(dataHoraISO);
    if (ehFeriadoNacional(ano, mes + 1, dia)) {
      return { valido: false, motivo: 'Essa data é feriado nacional — agenda fechada.' };
    }
  }

  const inicioMinutos = minutosNoDia(dataHoraISO);
  const fimMinutos = inicioMinutos + duracaoMinutos;
  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  if (inicioMinutos < aberturaMinutos || fimMinutos > fechamentoMinutos) {
    return {
      valido: false,
      motivo: `Horário fora do funcionamento do salão (${tenant.horario_abertura.slice(0, 5)}–${tenant.horario_fechamento.slice(0, 5)}).`,
    };
  }

  if (tenant.horario_almoco_ativo) {
    const almocoInicioMinutos = horarioParaMinutos(tenant.horario_almoco_inicio);
    const almocoFimMinutos = horarioParaMinutos(tenant.horario_almoco_fim);
    if (inicioMinutos < almocoFimMinutos && almocoInicioMinutos < fimMinutos) {
      return { valido: false, motivo: 'Esse horário cai no intervalo de almoço.' };
    }
  }

  return { valido: true };
}

// US61 — checa se [dataHoraISO, dataHoraISO + duracaoMinutos) cai dentro de
// algum bloqueio manual de agenda ativo (profissional_id nulo = bloqueio
// vale pra agenda inteira). Mesmo padrão de overlap já usado nas queries de
// conflito de agendamento (a.inicio < fim_novo AND inicio_novo < a.fim).
// Usada tanto pra criar/reagendar agendamentos quanto pro cálculo de
// disponibilidade — aplica mesmo em encaixe, já que um bloqueio manual
// significa "agenda indisponível", não só "já tem algo marcado".
async function buscarBloqueioConflitante(tenantId, profissionalId, dataHoraISO, duracaoMinutos) {
  const { rows } = await pool.query(
    `SELECT motivo FROM bloqueios_agenda
     WHERE tenant_id = $1 AND ativo AND (profissional_id IS NULL OR profissional_id = $2)
       AND inicio < $3::timestamptz + ($4 * interval '1 minute')
       AND $3::timestamptz < fim
     LIMIT 1`,
    [tenantId, profissionalId, dataHoraISO, duracaoMinutos]
  );
  return rows[0] || null;
}

// Empurra pro primeiro dia seguinte presente em `dias_funcionamento` (e, se
// `feriadosBloqueados`, que também não seja feriado nacional), mantendo o
// mesmo horário — mesma regra já usada em PATCH /api/configuracoes quando o
// expediente muda e um agendamento existente cai num dia que deixou de
// funcionar; reaproveitada pelo switch de feriados (bloqueio de agenda) pra
// mover pro primeiro dia útil quem já estava marcado num feriado. Limite de
// 14 tentativas (uma volta completa da semana): trava de segurança contra
// loop infinito se dias_funcionamento vier vazio. Não precisa reconferir
// abertura/fechamento/almoço — esses três são fixos pro tenant inteiro (não
// variam por dia da semana), então se o horário da âncora já passou nessa
// validação, continua válido em qualquer outro dia, só o dia em si pode
// estar fechado/feriado.
function empurrarProximoDiaAberto(componentes, diasFuncionamento, feriadosBloqueados = false) {
  let atual = componentes;
  let tentativas = 0;
  const fechado = (c) => {
    if (!diasFuncionamento.includes(diaDaSemanaBrasilia(isoDeComponentesBrasilia(c)))) return true;
    return feriadosBloqueados && ehFeriadoNacional(c.ano, c.mes + 1, c.dia);
  };
  while (fechado(atual) && tentativas < 14) {
    const proximoDia = new Date(Date.UTC(atual.ano, atual.mes, atual.dia + 1));
    atual = { ...atual, ano: proximoDia.getUTCFullYear(), mes: proximoDia.getUTCMonth(), dia: proximoDia.getUTCDate() };
    tentativas += 1;
  }
  return tentativas < 14 ? atual : null;
}

module.exports = { init, dentroDoHorarioFuncionamento, buscarBloqueioConflitante, empurrarProximoDiaAberto };
