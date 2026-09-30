// Disponibilidade de horários — extraído de index.js (fase 11 da
// modularização, US68 IA Engine). Cross-cutting: calcularDisponibilidadeIA
// (IA Engine) e contarHorariosLivresNoDia (GET /api/inicio/resumo, dashboard
// Início) compartilham a mesma grade de slots (IA_DURACAO_PADRAO_MINUTOS) —
// por isso viram lib em vez de ficar privadas num único módulo.
const { horarioParaMinutos, OFFSET_BRASILIA_MINUTOS } = require('./datetime');
const { dentroDoHorarioFuncionamento, buscarBloqueioConflitante } = require('./horario-funcionamento');

const IA_DIAS_DISPONIBILIDADE = 7;
const IA_SLOTS_POR_DIA_PROFISSIONAL = 3;
const IA_DURACAO_PADRAO_MINUTOS = 30;
// Depois de aceitar uma sugestão, pula essa quantidade de minutos antes de
// procurar a próxima no mesmo dia — sem isso, os 30min de passo do loop
// sempre encontram os primeiros horários livres em sequência a partir da
// abertura (ex.: 09:00, 09:30, 10:00), o que na prática só sugere manhã.
// Com o pulo, as sugestões saem espalhadas pelo dia (manhã/tarde).
const IA_INTERVALO_ENTRE_SUGESTOES_MINUTOS = 120;

let pool;
function init(poolInstance) {
  pool = poolInstance;
}

// US68/CA02 — disponibilidade real dos próximos N dias por profissional,
// calculada contra a agenda do banco (nunca hardcoded/alucinada pela IA).
// Reaproveita dentroDoHorarioFuncionamento/buscarBloqueioConflitante — mesma
// validação já usada em POST/PATCH /api/agendamentos — pra não ter dois
// critérios de "horário válido" divergentes no sistema.
//
// ACHADO (fase 11 da modularização, 2026-08-21): esta função referenciava
// `OFFSET_BRASILIA_MINUTOS` como identificador solto — funcionava no
// monólito original (tudo no mesmo escopo de módulo), mas a fase 1 moveu a
// constante pra lib/datetime.js sem atualizar este bloco (que só foi
// modularizado agora, na fase 11), deixando um ReferenceError latente
// sempre que calcularDisponibilidadeIA/montarContextoIA rodassem de
// verdade — ou seja, toda mensagem real de um tenant tecnologia='ia' desde
// o deploy da fase 1. Corrigido aqui importando OFFSET_BRASILIA_MINUTOS de
// lib/datetime.js (já exportada de lá, só faltava ser consumida). Bruno
// avisado — vale checar os logs/Sentry entre a fase 1 e esta fase.
async function calcularDisponibilidadeIA(tenant) {
  const { rows: profissionais } = await pool.query(
    'SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL AND ativo ORDER BY nome',
    [tenant.id]
  );
  if (!profissionais.length) return [];

  const { rows: agendamentosFuturos } = await pool.query(
    `SELECT profissional_id, data_hora FROM agendamentos
     WHERE tenant_id = $1 AND status IN ('confirmado', 'a_confirmar') AND data_hora > now()
       AND data_hora < now() + ($2 * interval '1 day')`,
    [tenant.id, IA_DIAS_DISPONIBILIDADE]
  );
  const ocupadosPorProfissional = new Map();
  for (const ag of agendamentosFuturos) {
    const lista = ocupadosPorProfissional.get(ag.profissional_id) || [];
    lista.push(new Date(ag.data_hora).getTime());
    ocupadosPorProfissional.set(ag.profissional_id, lista);
  }

  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  const resultado = [];

  for (const prof of profissionais) {
    const slots = [];
    for (let dia = 0; dia < IA_DIAS_DISPONIBILIDADE && slots.length < IA_SLOTS_POR_DIA_PROFISSIONAL * IA_DIAS_DISPONIBILIDADE; dia++) {
      const dataBase = new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000 + dia * 86400000);
      const dataISO = dataBase.toISOString().slice(0, 10);
      let encontradosNoDia = 0;
      for (let minutos = aberturaMinutos; minutos < fechamentoMinutos && encontradosNoDia < IA_SLOTS_POR_DIA_PROFISSIONAL; minutos += IA_DURACAO_PADRAO_MINUTOS) {
        const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
        const mm = String(minutos % 60).padStart(2, '0');
        const candidatoISO = `${dataISO}T${hh}:${mm}:00-03:00`;
        const candidatoMs = new Date(candidatoISO).getTime();
        if (candidatoMs <= Date.now()) continue;
        const { valido } = dentroDoHorarioFuncionamento(tenant, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
        if (!valido) continue;
        const ocupados = ocupadosPorProfissional.get(prof.id) || [];
        if (ocupados.some((ts) => Math.abs(ts - candidatoMs) < IA_DURACAO_PADRAO_MINUTOS * 60000)) continue;
        // eslint-disable-next-line no-await-in-loop
        const bloqueio = await buscarBloqueioConflitante(tenant.id, prof.id, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
        if (bloqueio) continue;
        slots.push({ profissionalId: prof.id, profissionalNome: prof.nome, dataHoraISO: candidatoISO });
        encontradosNoDia++;
        minutos += IA_INTERVALO_ENTRE_SUGESTOES_MINUTOS;
      }
    }
    if (slots.length) resultado.push({ profissional: prof.nome, slots });
  }
  return resultado;
}

// Conta o total de horários livres de um dia, somando todos os profissionais
// do tenant — usado pelo card "horários livres" do Início (dashboard). Mesmo
// raciocínio de slot do calcularDisponibilidadeIA (grade de
// IA_DURACAO_PADRAO_MINUTOS em minutos, checando expediente/almoço, conflito
// com agendamento confirmado e bloqueio manual), mas pra 1 dia só, sem o
// corte artificial de IA_SLOTS_POR_DIA_PROFISSIONAL (ali é só pra caber no
// prompt da IA; aqui o número precisa ser o total real).
async function contarHorariosLivresNoDia(tenant, dataISO) {
  const { rows: profissionais } = await pool.query(
    'SELECT id FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL AND ativo',
    [tenant.id]
  );
  if (!profissionais.length) return 0;

  const { rows: agendamentosDia } = await pool.query(
    `SELECT profissional_id, data_hora FROM agendamentos
     WHERE tenant_id = $1 AND status IN ('confirmado', 'a_confirmar')
       AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
    [tenant.id, dataISO]
  );
  const ocupadosPorProfissional = new Map();
  for (const ag of agendamentosDia) {
    const lista = ocupadosPorProfissional.get(ag.profissional_id) || [];
    lista.push(new Date(ag.data_hora).getTime());
    ocupadosPorProfissional.set(ag.profissional_id, lista);
  }

  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  let total = 0;
  for (const prof of profissionais) {
    for (let minutos = aberturaMinutos; minutos < fechamentoMinutos; minutos += IA_DURACAO_PADRAO_MINUTOS) {
      const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
      const mm = String(minutos % 60).padStart(2, '0');
      const candidatoISO = `${dataISO}T${hh}:${mm}:00-03:00`;
      const candidatoMs = new Date(candidatoISO).getTime();
      if (candidatoMs <= Date.now()) continue;
      const { valido } = dentroDoHorarioFuncionamento(tenant, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
      if (!valido) continue;
      const ocupados = ocupadosPorProfissional.get(prof.id) || [];
      if (ocupados.some((ts) => Math.abs(ts - candidatoMs) < IA_DURACAO_PADRAO_MINUTOS * 60000)) continue;
      // eslint-disable-next-line no-await-in-loop
      const bloqueio = await buscarBloqueioConflitante(tenant.id, prof.id, candidatoISO, IA_DURACAO_PADRAO_MINUTOS);
      if (bloqueio) continue;
      total++;
    }
  }
  return total;
}

// Horários livres por profissional, em "hora cheia" (janelas de 60min, não
// os 30min de IA_DURACAO_PADRAO_MINUTOS usados no resto deste arquivo) —
// usado pela Oportunidade "horários livres amanhã" do Início: pedido
// explícito de contar hora cheia (ex.: livre das 14h às 16h = 2 horários
// livres, não 4 blocos de 30min) e mostrar o total por profissional, não só
// um agregado. Mesma checagem de expediente/almoço/conflito/bloqueio de
// contarHorariosLivresNoDia, só que devolve o detalhe em vez de somar tudo
// num número só (quem quiser o total soma o array).
const DURACAO_HORA_CHEIA_MINUTOS = 60;
async function contarHorariosLivresPorProfissionalNoDia(tenant, dataISO) {
  const { rows: profissionais } = await pool.query(
    'SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL AND ativo ORDER BY nome',
    [tenant.id]
  );
  if (!profissionais.length) return [];

  const { rows: agendamentosDia } = await pool.query(
    `SELECT profissional_id, data_hora FROM agendamentos
     WHERE tenant_id = $1 AND status IN ('confirmado', 'a_confirmar')
       AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`,
    [tenant.id, dataISO]
  );
  const ocupadosPorProfissional = new Map();
  for (const ag of agendamentosDia) {
    const lista = ocupadosPorProfissional.get(ag.profissional_id) || [];
    lista.push(new Date(ag.data_hora).getTime());
    ocupadosPorProfissional.set(ag.profissional_id, lista);
  }

  const aberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
  const fechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
  const resultado = [];
  for (const prof of profissionais) {
    let livres = 0;
    for (let minutos = aberturaMinutos; minutos < fechamentoMinutos; minutos += DURACAO_HORA_CHEIA_MINUTOS) {
      const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
      const mm = String(minutos % 60).padStart(2, '0');
      const candidatoISO = `${dataISO}T${hh}:${mm}:00-03:00`;
      const candidatoMs = new Date(candidatoISO).getTime();
      if (candidatoMs <= Date.now()) continue;
      const { valido } = dentroDoHorarioFuncionamento(tenant, candidatoISO, DURACAO_HORA_CHEIA_MINUTOS);
      if (!valido) continue;
      const ocupados = ocupadosPorProfissional.get(prof.id) || [];
      if (ocupados.some((ts) => Math.abs(ts - candidatoMs) < DURACAO_HORA_CHEIA_MINUTOS * 60000)) continue;
      // eslint-disable-next-line no-await-in-loop
      const bloqueio = await buscarBloqueioConflitante(tenant.id, prof.id, candidatoISO, DURACAO_HORA_CHEIA_MINUTOS);
      if (bloqueio) continue;
      livres++;
    }
    resultado.push({ profissional_id: prof.id, profissional_nome: prof.nome, livres });
  }
  return resultado;
}

module.exports = {
  init,
  calcularDisponibilidadeIA,
  contarHorariosLivresNoDia,
  contarHorariosLivresPorProfissionalNoDia,
  IA_DIAS_DISPONIBILIDADE,
  IA_DURACAO_PADRAO_MINUTOS,
};
