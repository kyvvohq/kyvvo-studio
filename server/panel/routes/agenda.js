// Agenda — extraído de index.js (fase 3 da modularização):
// GET/PATCH /api/agendamentos[/:id], GET /api/agendamentos/disponibilidade,
// POST /api/agendamentos (âncora + recorrência opcional). A lógica de
// recorrência do POST não foi isolada numa função própria: compartilha
// `tenantRows`/`servicoInfo`/`profissionalId`/`clienteId`/`client` com o
// resto do handler — isolar viraria uma função com 8+ parâmetros sem
// nenhum ganho, já que esta extração é um "mover", não um "refatorar".
const { dataAtualBrasilia, mesAtualBrasilia, diaDaSemanaBrasilia, horarioParaMinutos, componentesBrasilia, dataDiaISO, isoDeComponentesBrasilia } = require('../lib/datetime');
const { ehFeriadoNacional } = require('../lib/feriados');
const { dentroDoHorarioFuncionamento, buscarBloqueioConflitante, empurrarProximoDiaAberto } = require('../lib/horario-funcionamento');
const { sincronizarLancamentoFinanceiro, FORMAS_PAGAMENTO_CHAVES } = require('../lib/financeiro');

// 'cartao'/'outro' são as opções legadas (antes de Preferências > Formas de
// pagamento existir, migration 082) — continuam válidas indefinidamente,
// tanto pra lançamentos antigos quanto pro tenant que ainda não configurou
// nada (a tela de "Confirmar pagamento" cai nas 4 opções antigas nesse caso).
const FORMA_PAGAMENTO_VALIDAS = [...FORMAS_PAGAMENTO_CHAVES, 'cartao', 'outro'];
const { garantirProfissionalPadrao } = require('../lib/profissionais');
const { dispararAutomacoes } = require('../lib/automacoes');
const { dispararNotificacaoEvento } = require('../lib/notificacoes');

// PATCH status -> gatilho de automação (só quando o status muda de fato).
// Só "concluido" (Feedback do serviço) dispara automação hoje.
const GATILHO_POR_STATUS = {
  concluido: 'agendamento_concluido',
};
const { normalizarTelefoneCliente } = require('../lib/clientes');

// Semanal/quinzenal são aditivos (7/14 dias vezes N a partir da âncora,
// Date.UTC normaliza dia > dias-no-mês automaticamente). Mensal recalcula o
// dia-do-mês a partir do valor ORIGINAL da âncora a cada mês (não cumulativo
// em cima da ocorrência anterior) — senão um clamp num mês curto (ex:
// 31/jan → 28/fev, decisão confirmada com o Bruno) "vazaria" o dia 28 pros
// meses seguintes em vez de voltar a tentar dia 31.
function proximaOcorrenciaRecorrencia(ancora, tipo, n) {
  if (tipo === 'mensal') {
    const indiceMes = ancora.mes + n;
    const ano = ancora.ano + Math.floor(indiceMes / 12);
    const mes = ((indiceMes % 12) + 12) % 12;
    const ultimoDiaDoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return { ...ancora, ano, mes, dia: Math.min(ancora.dia, ultimoDiaDoMes) };
  }
  const diasAAdicionar = (tipo === 'quinzenal' ? 14 : 7) * n;
  const normalizado = new Date(Date.UTC(ancora.ano, ancora.mes, ancora.dia + diasAAdicionar));
  return { ...ancora, ano: normalizado.getUTCFullYear(), mes: normalizado.getUTCMonth(), dia: normalizado.getUTCDate() };
}

const SLOT_INTERVALO_MINUTOS = 30;

function registerAgendaRoutes(fastify, pool) {
  fastify.get('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, profissionalId } = request.user;
    const { view, data } = request.query;
    // Presente só quando o bearer é uma sessão de profissional (acesso
    // restrito à própria agenda) — ausente pra admin/operador, logo a
    // cláusula vira string vazia e o comportamento de hoje continua idêntico
    // pra esses dois papéis.
    const filtroProfissional = profissionalId ? ' AND a.profissional_id = $3' : '';
    const paramsProfissional = profissionalId ? [profissionalId] : [];

    if (view === 'dia') {
      const dataRef = data || dataAtualBrasilia();
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, a.cliente_id, c.nome AS cliente, c.telefone AS cliente_telefone,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos, s.preco
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1 AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date${filtroProfissional}
         ORDER BY a.data_hora`,
        [tenantId, dataRef, ...paramsProfissional]
      );
      return { view: 'dia', data: dataRef, agendamentos: rows };
    }

    if (view === 'semana') {
      const dataRef = data || dataAtualBrasilia();
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos, s.preco
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date >= date_trunc('week', $2::date)
           AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date < date_trunc('week', $2::date) + interval '7 days'${filtroProfissional}
         ORDER BY a.data_hora`,
        [tenantId, dataRef, ...paramsProfissional]
      );
      return { view: 'semana', data: dataRef, agendamentos: rows };
    }

    if (view === 'mes') {
      const mesRef = data || mesAtualBrasilia();
      // Mesmas colunas da view Semana (id/cliente/profissional/serviço) —
      // antes a Mês só trazia data_hora/status/duração (US02.6, quando a
      // célula só listava "HH:MM-XXmin"); agora os cards compactos do
      // componente .agenda-mes do DS (renderAgendaCardCompacto) precisam do
      // resto pra mostrar avatar/cliente/serviço e ligar o menu .ds-acoes.
      const { rows } = await pool.query(
        `SELECT a.id, a.data_hora, a.status, a.encaixe, c.nome AS cliente, c.telefone AS cliente_telefone,
                a.profissional_id, p.nome AS profissional, a.servico_id, s.nome AS servico, s.duracao_minutos, s.preco
         FROM agendamentos a
         JOIN clientes c ON c.id = a.cliente_id
         JOIN profissionais p ON p.id = a.profissional_id
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND to_char(a.data_hora AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $2${filtroProfissional}
         ORDER BY a.data_hora`,
        [tenantId, mesRef, ...paramsProfissional]
      );
      return { view: 'mes', mes: mesRef, agendamentos: rows };
    }

    return reply.code(400).send({ error: 'Parâmetro "view" deve ser dia, semana ou mes' });
  });

  fastify.patch('/api/agendamentos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { status, data_hora: dataHora, forma_pagamento: formaPagamento } = request.body || {};

    if (status === undefined && dataHora === undefined) {
      return reply.code(400).send({ error: 'Informe "status" e/ou "data_hora" para atualizar' });
    }
    // 'concluido' (US64) — converte a receita prevista do agendamento em
    // realizada (CA "Cenário 5"). 'falta' (no-show, migration 060) — cliente
    // não compareceu; sincronizarLancamentoFinanceiro trata igual 'cancelado'
    // pro financeiro, mas o status do agendamento fica distinto pro relatório.
    if (status !== undefined && !['a_confirmar', 'confirmado', 'cancelado', 'reagendado', 'concluido', 'falta'].includes(status)) {
      return reply.code(400).send({ error: 'status inválido' });
    }
    if (formaPagamento !== undefined && !FORMA_PAGAMENTO_VALIDAS.includes(formaPagamento)) {
      return reply.code(400).send({ error: 'forma_pagamento inválida' });
    }

    const { rows: atuais } = await pool.query(
      `SELECT a.id, a.profissional_id, a.status, a.data_hora, s.duracao_minutos, s.nome AS servico_nome, s.preco AS servico_preco,
              p.nome AS profissional
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId]
    );
    const atual = atuais[0];
    if (!atual) {
      return reply.code(404).send({ error: 'Agendamento não encontrado' });
    }

    if (dataHora !== undefined) {
      // Reagendar também precisa respeitar o horário de funcionamento do
      // salão (dias/abertura/fechamento/almoço), igual ao POST /agendamentos.
      const { rows: tenantRows } = await pool.query(
        `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
                horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, feriados_bloqueados
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const validacao = dentroDoHorarioFuncionamento(tenantRows[0], dataHora, atual.duracao_minutos);
      if (!validacao.valido) {
        return reply.code(400).send({ error: validacao.motivo });
      }

      // Bloqueio manual (US61) — mesma checagem do POST /agendamentos.
      const bloqueioConflitante = await buscarBloqueioConflitante(tenantId, atual.profissional_id, dataHora, atual.duracao_minutos);
      if (bloqueioConflitante) {
        return reply.code(409).send({
          error: `Agenda bloqueada nesse período${bloqueioConflitante.motivo ? `: ${bloqueioConflitante.motivo}` : '.'}`,
        });
      }

      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status IN ('confirmado', 'a_confirmar', 'concluido')
           AND a.id <> $3
           AND a.data_hora < $4::timestamptz + ($5 * interval '1 minute')
           AND $4::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, atual.profissional_id, id, dataHora, atual.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${atual.profissional} já tem agendamento neste período.`,
        });
      }
    }

    // US64 — a mudança no agendamento e a sincronização do lançamento
    // financeiro (CA "Cenário 3/4/5/6") precisam acontecer atomicamente,
    // mesma razão do POST /agendamentos.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE agendamentos SET
           status = COALESCE($2, status),
           data_hora = COALESCE($3, data_hora),
           updated_at = now()
         WHERE id = $1`,
        [id, status ?? null, dataHora ?? null]
      );

      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId: id,
        servicoNome: atual.servico_nome,
        servicoPreco: atual.servico_preco,
        dataHora: dataHora ?? atual.data_hora,
        statusAgendamento: status ?? atual.status,
        formaPagamento,
      });

      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.updated_at,
              c.nome AS cliente, c.telefone AS cliente_telefone,
              p.nome AS profissional, s.nome AS servico, s.duracao_minutos
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [id]
    );

    // Automação por mudança de status (hoje só "concluido" -> Feedback do
    // serviço) — só quando o status muda de verdade. Best-effort.
    const gatilho = status !== undefined && status !== atual.status ? GATILHO_POR_STATUS[status] : null;
    if (gatilho) {
      dispararAutomacoes(pool, { tenantId, gatilho, agendamento: detalhado[0] })
        .catch((err) => request.log.error({ err }, `automacao ${gatilho}`));
    }

    // Configurações > Notificações — "Agendamento remarcado" (mudou
    // data_hora) e "Agendamento confirmado" (status virou 'confirmado' de
    // verdade, não o valor que já nasce assim na criação). Best-effort.
    const dataFormatada = new Date(detalhado[0].data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
    const quemEQuando = `${detalhado[0].servico} com ${detalhado[0].cliente || detalhado[0].cliente_telefone} — ${detalhado[0].profissional}, ${dataFormatada}`;
    if (dataHora !== undefined) {
      dispararNotificacaoEvento(pool, tenantId, 'agenda_remarcada', { titulo: 'Agendamento remarcado', detalhe: quemEQuando, referenciaDataHora: detalhado[0].data_hora })
        .catch((err) => request.log.error({ err }, 'notificacao agenda_remarcada'));
    }
    if (status === 'confirmado' && status !== atual.status) {
      dispararNotificacaoEvento(pool, tenantId, 'agenda_confirmada', { titulo: 'Agendamento confirmado', detalhe: quemEQuando, referenciaDataHora: detalhado[0].data_hora })
        .catch((err) => request.log.error({ err }, 'notificacao agenda_confirmada'));
    }

    return detalhado[0];
  });

  fastify.get('/api/agendamentos/disponibilidade', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { data, profissional, servico } = request.query;

    if (!data || !profissional || !servico) {
      return reply.code(400).send({ error: 'Parâmetros "data", "profissional" e "servico" são obrigatórios' });
    }

    const { rows: servicoRows } = await pool.query(
      'SELECT duracao_minutos FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servico, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: tenantRows } = await pool.query(
      `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, feriados_bloqueados
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantRows[0];
    const diasFuncionamento = tenant.dias_funcionamento || [1, 2, 3, 4, 5, 6];
    // Dia fechado: nenhum slot possível, sem precisar gerar/filtrar nada — o
    // dia da semana é lido a partir do meio-dia local (evita qualquer
    // ambiguidade de fuso na virada do dia que afetaria só a hora, não a
    // data em si, já que `data` já vem como "YYYY-MM-DD").
    if (!diasFuncionamento.includes(diaDaSemanaBrasilia(`${data}T12:00:00-03:00`))) {
      return { data, profissional, servico, duracaoMinutos: servicoInfo.duracao_minutos, slots: [] };
    }
    if (tenant.feriados_bloqueados) {
      const [anoData, mesData, diaData] = data.split('-').map(Number);
      if (ehFeriadoNacional(anoData, mesData, diaData)) {
        return { data, profissional, servico, duracaoMinutos: servicoInfo.duracao_minutos, slots: [] };
      }
    }

    const horarioAberturaMinutos = horarioParaMinutos(tenant.horario_abertura);
    const horarioFechamentoMinutos = horarioParaMinutos(tenant.horario_fechamento);
    const almocoAtivo = tenant.horario_almoco_ativo;
    const almocoInicioMinutos = almocoAtivo ? horarioParaMinutos(tenant.horario_almoco_inicio) : null;
    const almocoFimMinutos = almocoAtivo ? horarioParaMinutos(tenant.horario_almoco_fim) : null;

    const { rows: ocupados } = await pool.query(
      `SELECT a.data_hora, s.duracao_minutos
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.tenant_id = $1 AND a.profissional_id = $2
         AND a.status IN ('confirmado', 'a_confirmar', 'concluido')
         AND (a.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $3::date`,
      [tenantId, profissional, data]
    );

    // US61 — bloqueios manuais que tocam esse dia (profissional_id nulo =
    // agenda inteira). Limites do dia ancorados em Brasília explicitamente
    // (mesmo padrão do "T00:00:00-03:00" usado no loop de slots abaixo) —
    // nunca deixar o Postgres inferir o fuso de um cast implícito de data.
    const inicioDiaISO = `${data}T00:00:00-03:00`;
    const fimDiaISO = new Date(new Date(inicioDiaISO).getTime() + 24 * 60 * 60000).toISOString();
    const { rows: bloqueios } = await pool.query(
      `SELECT inicio, fim, motivo FROM bloqueios_agenda
       WHERE tenant_id = $1 AND ativo AND (profissional_id IS NULL OR profissional_id = $2)
         AND inicio < $4::timestamptz
         AND $3::timestamptz < fim`,
      [tenantId, profissional, inicioDiaISO, fimDiaISO]
    );

    const duracaoMinutos = servicoInfo.duracao_minutos;
    const slots = [];
    for (
      let minutos = horarioAberturaMinutos;
      minutos + duracaoMinutos <= horarioFechamentoMinutos;
      minutos += SLOT_INTERVALO_MINUTOS
    ) {
      // Slot (do início ao fim do serviço) cai total ou parcialmente dentro
      // do intervalo de almoço — nem oferece como opção (diferente de
      // "ocupado": almoço não é um horário reservável de jeito nenhum).
      const fimSlotMinutos = minutos + duracaoMinutos;
      if (almocoAtivo && minutos < almocoFimMinutos && almocoInicioMinutos < fimSlotMinutos) {
        continue;
      }

      // "T00:00:00-03:00" ancora explicitamente em meia-noite de Brasília,
      // independente do fuso do processo Node (que roda em UTC no container).
      // setUTCMinutes (não setMinutes) evita reintroduzir a mesma confusão de
      // fuso ao somar os minutos do slot.
      const inicioSlot = new Date(`${data}T00:00:00-03:00`);
      inicioSlot.setUTCMinutes(inicioSlot.getUTCMinutes() + minutos);
      const fimSlot = new Date(inicioSlot.getTime() + duracaoMinutos * 60000);

      const conflita = ocupados.some((o) => {
        const inicioOcupado = new Date(o.data_hora);
        const fimOcupado = new Date(inicioOcupado.getTime() + o.duracao_minutos * 60000);
        return inicioSlot < fimOcupado && inicioOcupado < fimSlot;
      });

      const bloqueado = bloqueios.some((b) => {
        const inicioBloqueio = new Date(b.inicio);
        const fimBloqueio = new Date(b.fim);
        return inicioSlot < fimBloqueio && inicioBloqueio < fimSlot;
      });

      slots.push({ hora: inicioSlot.toISOString(), disponivel: !conflita && !bloqueado });
    }

    return { data, profissional, servico, duracaoMinutos, slots };
  });

  fastify.post('/api/agendamentos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      cliente_nome: clienteNome,
      cliente_telefone: clienteTelefoneBruto,
      servico_id: servicoId,
      data_hora: dataHora,
      encaixe,
      origem,
      observacoes,
      recorrencia,
    } = request.body || {};
    let { profissional_id: profissionalId } = request.body || {};

    // Recorrência (Novo agendamento > Recorrência) — validado cedo, antes de
    // qualquer consulta, mesmo padrão dos outros campos obrigatórios acima.
    const RECORRENCIA_TIPOS = ['semanal', 'quinzenal', 'mensal'];
    if (recorrencia !== undefined) {
      if (!recorrencia || !RECORRENCIA_TIPOS.includes(recorrencia.tipo)) {
        return reply.code(400).send({ error: 'recorrencia.tipo deve ser "semanal", "quinzenal" ou "mensal"' });
      }
      if (!recorrencia.ate || !/^\d{4}-\d{2}-\d{2}$/.test(recorrencia.ate)) {
        return reply.code(400).send({ error: 'recorrencia.ate é obrigatório (formato YYYY-MM-DD)' });
      }
    }

    // Telefone é obrigatório: é o canal de comunicação com a cliente
    // (decisão de 2026-07-08, revertendo a US09/CA02 original). Normalizado
    // com DDI (ver normalizarTelefoneCliente) pra bater com o formato que o
    // bot/IA já usam — senão o mesmo cliente vira registro duplicado.
    const clienteTelefone = normalizarTelefoneCliente(clienteTelefoneBruto);

    if (!clienteTelefone || !servicoId || !dataHora) {
      return reply.code(400).send({
        error: 'Campos "cliente_telefone", "servico_id" e "data_hora" são obrigatórios',
      });
    }

    // Tenant com um único profissional não expõe o campo "Profissional" no
    // formulário (portal esconde quando há só 1 opção) — resolve sozinho pro
    // profissional padrão nesse caso.
    if (!profissionalId) {
      profissionalId = (await garantirProfissionalPadrao(tenantId)).id;
    }

    // Canal de origem (CA09). Como este endpoint é o do portal (autenticado), o
    // padrão é 'portal'; 'whatsapp' fica aceito para consistência caso o bot
    // passe a usar a mesma rota no futuro.
    if (origem !== undefined && !['portal', 'whatsapp'].includes(origem)) {
      return reply.code(400).send({ error: 'origem deve ser "portal" ou "whatsapp"' });
    }
    const origemFinal = origem || 'portal';

    const { rows: servicoRows } = await pool.query(
      'SELECT nome, duracao_minutos, preco FROM servicos WHERE id = $1 AND tenant_id = $2',
      [servicoId, tenantId]
    );
    const servicoInfo = servicoRows[0];
    if (!servicoInfo) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }

    const { rows: profissionalRows } = await pool.query(
      'SELECT nome FROM profissionais WHERE id = $1 AND tenant_id = $2',
      [profissionalId, tenantId]
    );
    const profissionalInfo = profissionalRows[0];
    if (!profissionalInfo) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }

    // Horário de funcionamento do salão (dias/abertura/fechamento/almoço) —
    // vale pra qualquer agendamento, inclusive encaixe: a exceção do encaixe é
    // sobrepor um horário já ocupado, não funcionar fora do expediente.
    const { rows: tenantRows } = await pool.query(
      `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, feriados_bloqueados
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const validacaoHorario = dentroDoHorarioFuncionamento(tenantRows[0], dataHora, servicoInfo.duracao_minutos);
    if (!validacaoHorario.valido) {
      return reply.code(400).send({ error: validacaoHorario.motivo });
    }

    // Bloqueio manual (US61) vale mesmo pra encaixe: diferente de "já tem
    // algo marcado" (o que encaixe explicitamente ignora), um bloqueio
    // significa que a agenda não está disponível nesse período.
    const bloqueioConflitante = await buscarBloqueioConflitante(tenantId, profissionalId, dataHora, servicoInfo.duracao_minutos);
    if (bloqueioConflitante) {
      return reply.code(409).send({
        error: `Agenda bloqueada nesse período${bloqueioConflitante.motivo ? `: ${bloqueioConflitante.motivo}` : '.'}`,
      });
    }

    // Encaixe é uma exceção manual feita pela dona do salão: sobrepor um
    // horário já ocupado é o próprio propósito da funcionalidade (procedimentos
    // simples/rápidos encaixados ao lado de um atendimento já agendado), então
    // a validação de conflito só se aplica a agendamentos normais.
    if (!encaixe) {
      const { rows: conflitos } = await pool.query(
        `SELECT a.id
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.profissional_id = $2
           AND a.status IN ('confirmado', 'a_confirmar', 'concluido')
           AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
           AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, profissionalId, dataHora, servicoInfo.duracao_minutos]
      );
      if (conflitos.length > 0) {
        return reply.code(409).send({
          error: `Conflito de horário: ${profissionalInfo.nome} já tem agendamento neste período.`,
        });
      }
    }

    // Gera as datas das ocorrências seguintes da recorrência (a primeira
    // ocorrência é o próprio agendamento âncora validado acima). Decisões
    // confirmadas com o Bruno: quinzenal = a cada 14 dias corridos (não datas
    // fixas do calendário); mensal num mês sem o dia da âncora (ex: 31 em
    // fevereiro) usa o último dia do mês; ocorrência que cair num dia fechado
    // (dias_funcionamento) é empurrada pro primeiro dia aberto seguinte,
    // mantendo o horário; ocorrência que colidir com outro agendamento ou
    // bloqueio manual é pulada (não tenta outro dia) e reportada na resposta
    // pro frontend avisar a dona do salão.
    const LIMITE_OCORRENCIAS_RECORRENCIA = 200; // guarda de segurança — bem acima de qualquer uso real (semanal por 1 ano = 52, mensal por 16 anos = 200)
    const ocorrenciasParaCriar = [];
    const ocorrenciasPuladas = [];
    let limiteRecorrenciaAtingido = false;

    if (recorrencia) {
      const ancoraComponentes = componentesBrasilia(dataHora);
      if (recorrencia.ate <= dataDiaISO(ancoraComponentes)) {
        return reply.code(400).send({ error: 'recorrencia.ate deve ser depois da data do agendamento' });
      }

      const diasFuncionamento = tenantRows[0].dias_funcionamento || [1, 2, 3, 4, 5, 6];
      let n = 1;
      while (true) {
        if (n > LIMITE_OCORRENCIAS_RECORRENCIA) {
          limiteRecorrenciaAtingido = true;
          break;
        }
        const bruto = proximaOcorrenciaRecorrencia(ancoraComponentes, recorrencia.tipo, n);
        if (dataDiaISO(bruto) > recorrencia.ate) break;

        const resolvido = empurrarProximoDiaAberto(bruto, diasFuncionamento, tenantRows[0].feriados_bloqueados);
        if (!resolvido) {
          ocorrenciasPuladas.push({ data: dataDiaISO(bruto), motivo: 'Nenhum dia de funcionamento disponível próximo a essa data.' });
          n += 1;
          continue;
        }
        const dataHoraOcorrencia = isoDeComponentesBrasilia(resolvido);

        // Mesma checagem de bloqueio/conflito feita acima pro agendamento
        // âncora — recorrência nunca vira encaixe automático (só o campo
        // "Encaixe" explícito, marcado manualmente, ignora conflito).
        const bloqueioOcorrencia = await buscarBloqueioConflitante(tenantId, profissionalId, dataHoraOcorrencia, servicoInfo.duracao_minutos);
        if (bloqueioOcorrencia) {
          ocorrenciasPuladas.push({
            data: dataDiaISO(resolvido),
            motivo: `Agenda bloqueada${bloqueioOcorrencia.motivo ? `: ${bloqueioOcorrencia.motivo}` : '.'}`,
          });
          n += 1;
          continue;
        }
        const { rows: conflitosOcorrencia } = await pool.query(
          `SELECT a.id
           FROM agendamentos a
           JOIN servicos s ON s.id = a.servico_id
           WHERE a.tenant_id = $1
             AND a.profissional_id = $2
             AND a.status IN ('confirmado', 'a_confirmar', 'concluido')
             AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
             AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
          [tenantId, profissionalId, dataHoraOcorrencia, servicoInfo.duracao_minutos]
        );
        if (conflitosOcorrencia.length > 0) {
          ocorrenciasPuladas.push({ data: dataDiaISO(resolvido), motivo: 'Já existe um agendamento nesse horário.' });
          n += 1;
          continue;
        }

        ocorrenciasParaCriar.push(dataHoraOcorrencia);
        n += 1;
      }
    }

    // US64 — cliente, agendamento e o lançamento financeiro automático
    // (CA "Cenário 1") precisam nascer juntos: um crash entre o INSERT do
    // agendamento e o do financeiro não pode deixar receita prevista órfã
    // nem um agendamento sem o lançamento correspondente.
    const client = await pool.connect();
    let agendamentoId;
    try {
      await client.query('BEGIN');

      // excluido_em = null no conflito: cliente que tinha sido excluído
      // (soft delete, menu Clientes) e volta a agendar reaparece na
      // listagem de novo — "excluir" nunca deveria ser um banimento
      // permanente, só limpeza de tela.
      const { rows: clienteRows } = await client.query(
        `INSERT INTO clientes (tenant_id, nome, telefone)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, telefone) DO UPDATE SET nome = COALESCE(EXCLUDED.nome, clientes.nome), excluido_em = NULL
         RETURNING id`,
        [tenantId, clienteNome || null, clienteTelefone]
      );
      const clienteId = clienteRows[0].id;

      const { rows: criado } = await client.query(
        `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, encaixe, origem, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [tenantId, clienteId, profissionalId, servicoId, dataHora, !!encaixe, origemFinal, observacoes || null]
      );
      agendamentoId = criado[0].id;

      // Agendamento nasce sempre 'a_confirmar' (migration 086, default da
      // coluna) — receita prevista, nunca realizada, na criação; vira
      // 'previsto' no financeiro igual 'confirmado' (financeiro.js só trata
      // 'concluido'/'cancelado'/'falta' como exceção).
      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId,
        servicoNome: servicoInfo.nome,
        servicoPreco: servicoInfo.preco,
        dataHora,
        statusAgendamento: 'a_confirmar',
      });

      // Ocorrências seguintes da recorrência (já validadas/resolvidas acima) —
      // mesmo cliente/profissional/serviço/observações do agendamento âncora,
      // cada uma com seu próprio lançamento financeiro (nunca "encaixe": ver
      // comentário na geração das datas).
      for (const dataHoraOcorrencia of ocorrenciasParaCriar) {
        const { rows: criadoOcorrencia } = await client.query(
          `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, encaixe, origem, observacoes)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7)
           RETURNING id`,
          [tenantId, clienteId, profissionalId, servicoId, dataHoraOcorrencia, origemFinal, observacoes || null]
        );
        await sincronizarLancamentoFinanceiro(client, {
          tenantId,
          agendamentoId: criadoOcorrencia[0].id,
          servicoNome: servicoInfo.nome,
          servicoPreco: servicoInfo.preco,
          dataHora: dataHoraOcorrencia,
          statusAgendamento: 'a_confirmar',
        });
      }

      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    const { rows: detalhado } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, a.encaixe, a.origem, a.observacoes, a.updated_at,
              a.profissional_id, p.nome AS profissional,
              a.servico_id, s.nome AS servico, s.duracao_minutos,
              c.nome AS cliente, c.telefone AS cliente_telefone
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN profissionais p ON p.id = a.profissional_id
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.id = $1`,
      [agendamentoId]
    );

    reply.code(201);
    const resposta = detalhado[0];
    if (recorrencia) {
      resposta.recorrencia = {
        criados: ocorrenciasParaCriar.length,
        pulados: ocorrenciasPuladas,
        limite_atingido: limiteRecorrenciaAtingido,
      };
    }

    // Automação "agendamento_criado" — só pro agendamento âncora (não uma
    // por ocorrência da recorrência, viraria spam; a trava de 24h ampara o
    // resto). Best-effort, não bloqueia a resposta.
    dispararAutomacoes(pool, { tenantId, gatilho: 'agendamento_criado', agendamento: resposta })
      .catch((err) => request.log.error({ err }, 'automacao agendamento_criado'));

    // Configurações > Notificações ("Novo agendamento criado") — mesmo
    // raciocínio: só o âncora, best-effort, não bloqueia a resposta.
    dispararNotificacaoEvento(pool, tenantId, 'agenda_criada', {
      titulo: `Novo agendamento: ${resposta.servico} com ${resposta.cliente || resposta.cliente_telefone}`,
      detalhe: `${resposta.profissional} — ${new Date(resposta.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
      referenciaDataHora: resposta.data_hora,
    }).catch((err) => request.log.error({ err }, 'notificacao agenda_criada'));

    return resposta;
  });
}

module.exports = { registerAgendaRoutes };
