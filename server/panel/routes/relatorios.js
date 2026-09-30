// Relatórios — extraído de index.js (fase 5 da modularização):
// GET /api/relatorios/resumo (dashboard mensal de negócio, modulo_key=
// 'dashboards' — ver migration 057).
const { mesAtualBrasilia, horarioParaMinutos } = require('../lib/datetime');

// Mesmo valor de IA_DURACAO_PADRAO_MINUTOS (index.js, usado pelo IA Engine) —
// arquivo independente, sem lib compartilhada só por um inteiro, mesmo
// precedente já usado em SLOT_INTERVALO_MINUTOS (routes/agenda.js, fase 3).
const IA_DURACAO_PADRAO_MINUTOS = 30;

function registerRelatoriosRoutes(fastify, pool) {
  // Dashboard mensal de negócio: 5 KPIs com variação vs mês anterior,
  // faturamento diário, desempenho da agenda, quebra por serviço, seção de
  // clientes, resumo financeiro e insights determinísticos (nunca IA/LLM —
  // regra fixa em cima dos mesmos agregados já buscados aqui, sem custo/
  // latência extra e sem risco de alucinar número). Um endpoint só, mesmo
  // espírito de /api/inicio/resumo, já que a tela renderiza tudo de uma vez.
  function variacaoPct(atual, anterior) {
    if (atual == null || anterior == null || !(anterior > 0)) return null;
    return ((atual - anterior) / anterior) * 100;
  }

  fastify.get(
    '/api/relatorios/resumo',
    { preHandler: [fastify.authenticate, fastify.requireModulo('dashboards'), fastify.requireAdmin] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const mes = request.query.mes || mesAtualBrasilia();
      if (!/^\d{4}-\d{2}$/.test(mes)) {
        return reply.code(422).send({ error: 'mes deve estar no formato YYYY-MM' });
      }

      // Limites do mês em horário de Brasília, como timestamptz — necessário
      // pras queries sobre agendamentos.data_hora (timestamptz). Já
      // lancamentos_financeiros.data é `date` puro: comparado por
      // to_char(data,'YYYY-MM') = $mes, mesmo padrão já usado no Financeiro
      // (clausulaPeriodoFinanceiro) — não precisa desses limites.
      const [anoNum, mesNum] = mes.split('-').map(Number);
      const ultimoDiaDoMes = new Date(Date.UTC(anoNum, mesNum, 0)).getUTCDate();
      const mesInicio = `${mes}-01T00:00:00-03:00`;
      const mesFimData = new Date(Date.UTC(anoNum, mesNum, 1));
      const mesFim = `${mesFimData.toISOString().slice(0, 10)}T00:00:00-03:00`;
      const mesAnteriorData = new Date(Date.UTC(anoNum, mesNum - 2, 1));
      const mesAnteriorInicio = `${mesAnteriorData.toISOString().slice(0, 10)}T00:00:00-03:00`;
      const mesAnterior = `${mesAnteriorData.getUTCFullYear()}-${String(mesAnteriorData.getUTCMonth() + 1).padStart(2, '0')}`;

      const { rows: tenantRows } = await pool.query(
        `SELECT dias_funcionamento, horario_abertura, horario_fechamento,
                horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const tenant = tenantRows[0];

      const [
        { rows: kpiFinRows },
        { rows: agendaRows },
        { rows: clientesRows },
        { rows: diarioRows },
        { rows: servicosRows },
        { rows: servicosVariacaoRows },
        { rows: semRetornoRows },
        { rows: financeiroRows },
        { rows: profissionaisRows },
        { rows: bloqueiosRows },
        { rows: weekdayRows },
        { rows: perdidosRows },
      ] = await Promise.all([
        // Faturamento (previsto+realizado) e Recebido (só realizado), mês
        // atual e anterior — mesma definição de Prevista/Recebida do
        // Financeiro (app.js renderFinanceiro), só somadas/escopadas pro mês.
        pool.query(
          `SELECT
             COALESCE(SUM(valor) FILTER (WHERE status IN ('previsto','realizado') AND to_char(data,'YYYY-MM') = $2), 0) AS faturamento_atual,
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data,'YYYY-MM') = $2), 0) AS recebido_atual,
             COALESCE(SUM(valor) FILTER (WHERE status IN ('previsto','realizado') AND to_char(data,'YYYY-MM') = $3), 0) AS faturamento_anterior,
             COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data,'YYYY-MM') = $3), 0) AS recebido_anterior
           FROM lancamentos_financeiros WHERE tenant_id = $1 AND tipo = 'entrada'`,
          [tenantId, mes, mesAnterior]
        ),
        // Desempenho da agenda do mês (todos os status) + total do mês
        // anterior (pro KPI Atendimentos) + realizados do mês anterior (pro
        // Ticket médio) — tudo numa query só. Os 4 buckets (agendados/
        // realizados/cancelados/faltas) mapeiam 1:1 pros 4 valores de status
        // que importam ('reagendado' nunca é setado por nenhum código, ver
        // sincronizarLancamentoFinanceiro) — de propósito SEM filtrar
        // "agendados" por data_hora futura, senão um 'confirmado' com data
        // já passada (que o salão ainda não fechou como concluído/falta)
        // ficaria de fora dos 4 buckets e a soma não bateria com "total".
        pool.query(
          `SELECT
             count(*) FILTER (WHERE data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS total,
             count(*) FILTER (WHERE data_hora >= $4::timestamptz AND data_hora < $2::timestamptz)::int AS total_anterior,
             count(*) FILTER (WHERE status IN ('confirmado', 'a_confirmar') AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS agendados,
             count(*) FILTER (WHERE status = 'concluido' AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS realizados,
             count(*) FILTER (WHERE status = 'concluido' AND data_hora >= $4::timestamptz AND data_hora < $2::timestamptz)::int AS realizados_anterior,
             count(*) FILTER (WHERE status = 'cancelado' AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS cancelados,
             count(*) FILTER (WHERE status = 'falta' AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS faltas,
             count(*) FILTER (WHERE status IN ('confirmado','a_confirmar','concluido') AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz)::int AS ocupados
           FROM agendamentos WHERE tenant_id = $1`,
          [tenantId, mesInicio, mesFim, mesAnteriorInicio]
        ),
        // Clientes "atendidos" = concluído no mês (distinct); novos = desse
        // grupo, quem se cadastrou dentro do próprio mês; recorrentes =
        // atual - novos (calculado embaixo, em JS).
        pool.query(
          `SELECT
             count(DISTINCT a.cliente_id) FILTER (WHERE a.data_hora >= $2::timestamptz AND a.data_hora < $3::timestamptz)::int AS atual,
             count(DISTINCT a.cliente_id) FILTER (WHERE a.data_hora >= $4::timestamptz AND a.data_hora < $2::timestamptz)::int AS anterior,
             count(DISTINCT a.cliente_id) FILTER (WHERE a.data_hora >= $2::timestamptz AND a.data_hora < $3::timestamptz AND c.criado_em >= $2::timestamptz AND c.criado_em < $3::timestamptz)::int AS novos
           FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
           WHERE a.tenant_id = $1 AND a.status = 'concluido' AND c.excluido_em IS NULL`,
          [tenantId, mesInicio, mesFim, mesAnteriorInicio]
        ),
        // Faturamento por dia do mês (gráfico de tendência) — dias sem
        // lançamento são preenchidos com 0 em JS logo abaixo, o frontend
        // nunca precisa tratar buraco.
        pool.query(
          `SELECT extract(day from data)::int AS dia, SUM(valor) AS valor
           FROM lancamentos_financeiros
           WHERE tenant_id = $1 AND tipo = 'entrada' AND status IN ('previsto','realizado') AND to_char(data,'YYYY-MM') = $2
           GROUP BY 1 ORDER BY 1`,
          [tenantId, mes]
        ),
        // Atendimentos e faturamento por serviço — cancelado/falta de fora
        // (não representam atividade real do serviço no mês).
        pool.query(
          `SELECT s.nome,
                  count(*) FILTER (WHERE a.status = 'concluido')::int AS atendimentos,
                  COALESCE(SUM(l.valor) FILTER (WHERE l.status IN ('previsto','realizado')), 0) AS faturamento
           FROM agendamentos a
           JOIN servicos s ON s.id = a.servico_id AND s.excluido_em IS NULL
           LEFT JOIN lancamentos_financeiros l ON l.agendamento_id = a.id
           WHERE a.tenant_id = $1 AND a.data_hora >= $2::timestamptz AND a.data_hora < $3::timestamptz
             AND a.status NOT IN ('cancelado', 'falta')
           GROUP BY s.nome ORDER BY faturamento DESC`,
          [tenantId, mesInicio, mesFim]
        ),
        // Mesma quebra por serviço, mas só faturamento (mês atual x
        // anterior) — usada só pro insight de "serviço que mais contribuiu
        // pra variação", não pra Seção 4 (essa usa a query acima).
        pool.query(
          `SELECT s.nome,
                  COALESCE(SUM(l.valor) FILTER (WHERE l.status IN ('previsto','realizado') AND to_char(l.data,'YYYY-MM') = $2), 0) AS atual,
                  COALESCE(SUM(l.valor) FILTER (WHERE l.status IN ('previsto','realizado') AND to_char(l.data,'YYYY-MM') = $3), 0) AS anterior
           FROM lancamentos_financeiros l
           JOIN agendamentos a ON a.id = l.agendamento_id
           JOIN servicos s ON s.id = a.servico_id
           WHERE l.tenant_id = $1
           GROUP BY s.nome`,
          [tenantId, mes, mesAnterior]
        ),
        // Clientes sem retorno há 60+ dias — mesma query de
        // GET /api/inicio/resumo (limiar de 30 dias ali é outro contexto,
        // aqui o Bruno pediu 60 explicitamente neste relatório).
        pool.query(
          `SELECT count(*)::int AS total FROM clientes c
           WHERE c.tenant_id = $1 AND c.excluido_em IS NULL
             AND EXISTS (SELECT 1 FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado')
             AND (SELECT max(a.data_hora) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status != 'cancelado') < now() - interval '60 days'`,
          [tenantId]
        ),
        // Financeiro do mês — mesma fórmula já confirmada no Financeiro
        // (Resultado = Faturamento previsto+realizado − Despesas).
        pool.query(
          `SELECT
             COALESCE(SUM(valor) FILTER (WHERE tipo = 'entrada' AND status IN ('previsto','realizado')), 0) AS faturamento,
             COALESCE(SUM(valor) FILTER (WHERE tipo = 'saida' AND status != 'cancelado'), 0) AS despesas
           FROM lancamentos_financeiros WHERE tenant_id = $1 AND to_char(data,'YYYY-MM') = $2`,
          [tenantId, mes]
        ),
        pool.query('SELECT count(*)::int AS total FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL', [tenantId]),
        // Minutos bloqueados no mês (bloqueios_agenda), separando bloqueio
        // geral (profissional_id nulo, vale pra todos) de individual — pro
        // cálculo de capacidade da agenda logo abaixo.
        pool.query(
          `SELECT
             COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(fim, $3::timestamptz) - GREATEST(inicio, $2::timestamptz))) / 60) FILTER (WHERE profissional_id IS NULL), 0) AS minutos_geral,
             COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(fim, $3::timestamptz) - GREATEST(inicio, $2::timestamptz))) / 60) FILTER (WHERE profissional_id IS NOT NULL), 0) AS minutos_individual
           FROM bloqueios_agenda WHERE tenant_id = $1 AND ativo AND inicio < $3::timestamptz AND fim > $2::timestamptz`,
          [tenantId, mesInicio, mesFim]
        ),
        // Atendimentos confirmados/concluídos por dia da semana — pro
        // insight de "dia com menor/maior ocupação" (normalizado por quantas
        // vezes cada dia da semana caiu no mês, calculado em JS abaixo).
        pool.query(
          `SELECT extract(dow from data_hora)::int AS dow, count(*)::int AS total
           FROM agendamentos
           WHERE tenant_id = $1 AND data_hora >= $2::timestamptz AND data_hora < $3::timestamptz
             AND status IN ('confirmado', 'a_confirmar', 'concluido')
           GROUP BY 1`,
          [tenantId, mesInicio, mesFim]
        ),
        // Faturamento potencial perdido em cancelamentos/faltas — usa o
        // preço ATUAL do serviço (aproximação: se o preço mudou depois do
        // agendamento, o valor histórico real pode ter sido outro).
        pool.query(
          `SELECT COALESCE(SUM(s.preco), 0) AS total
           FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
           WHERE a.tenant_id = $1 AND a.data_hora >= $2::timestamptz AND a.data_hora < $3::timestamptz
             AND a.status IN ('cancelado', 'falta')`,
          [tenantId, mesInicio, mesFim]
        ),
      ]);

      const kf = kpiFinRows[0];
      const ag = agendaRows[0];
      const cl = clientesRows[0];

      const faturamentoAtual = Number(kf.faturamento_atual);
      const recebidoAtual = Number(kf.recebido_atual);
      const faturamentoAnterior = Number(kf.faturamento_anterior);
      const recebidoAnterior = Number(kf.recebido_anterior);

      const ticketMedioAtual = ag.realizados > 0 ? recebidoAtual / ag.realizados : null;
      const ticketMedioAnterior = ag.realizados_anterior > 0 ? recebidoAnterior / ag.realizados_anterior : null;

      const clientesRecorrentes = cl.atual - cl.novos;

      // Ocupação da agenda — ESTIMATIVA NOMINAL, não simulação slot-a-slot
      // (rodar contarHorariosLivresNoDia dia-a-dia pro mês inteiro seria
      // caro demais). Capacidade = dias abertos no mês × nº de profissionais
      // × slots de 30min no expediente (menos almoço), descontando minutos
      // bloqueados. Não usa a duração real de cada serviço nem o vínculo
      // profissional↔serviço — grade fixa de 30min pra todo mundo, mesma
      // simplificação já usada em contarHorariosLivresNoDia/calcularDisponibilidadeIA.
      const diasFuncionamento = (tenant.dias_funcionamento && tenant.dias_funcionamento.length)
        ? tenant.dias_funcionamento
        : [1, 2, 3, 4, 5, 6];
      let diasAbertosNoMes = 0;
      const ocorrenciasPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
      for (let dia = 1; dia <= ultimoDiaDoMes; dia++) {
        const dow = new Date(Date.UTC(anoNum, mesNum - 1, dia)).getUTCDay();
        ocorrenciasPorDiaSemana[dow]++;
        if (diasFuncionamento.includes(dow)) diasAbertosNoMes++;
      }
      const aberturaMin = horarioParaMinutos(tenant.horario_abertura);
      const fechamentoMin = horarioParaMinutos(tenant.horario_fechamento);
      let minutosExpediente = fechamentoMin - aberturaMin;
      if (tenant.horario_almoco_ativo) {
        minutosExpediente -= Math.max(0, horarioParaMinutos(tenant.horario_almoco_fim) - horarioParaMinutos(tenant.horario_almoco_inicio));
      }
      const slotsPorDia = Math.max(0, Math.floor(minutosExpediente / IA_DURACAO_PADRAO_MINUTOS));
      const profissionaisCount = profissionaisRows[0].total;
      const capacidadeNominal = diasAbertosNoMes * profissionaisCount * slotsPorDia;
      const bl = bloqueiosRows[0];
      const bloqueioSlots = (Number(bl.minutos_geral) * profissionaisCount + Number(bl.minutos_individual)) / IA_DURACAO_PADRAO_MINUTOS;
      const capacidade = Math.max(capacidadeNominal - bloqueioSlots, 0);
      const ocupacaoPct = capacidade > 0 ? Math.min(100, Math.max(0, (ag.ocupados / capacidade) * 100)) : null;
      const taxaComparecimentoPct = (ag.realizados + ag.faltas) > 0
        ? (ag.realizados / (ag.realizados + ag.faltas)) * 100
        : null;

      // Faturamento diário (Seção 2) — preenche os dias sem lançamento com 0.
      const faturamentoPorDia = new Map(diarioRows.map((r) => [r.dia, Number(r.valor)]));
      const faturamentoDiario = [];
      for (let dia = 1; dia <= ultimoDiaDoMes; dia++) {
        faturamentoDiario.push({ dia, valor: faturamentoPorDia.get(dia) || 0 });
      }

      const financeiroFaturamento = Number(financeiroRows[0].faturamento);
      const financeiroDespesas = Number(financeiroRows[0].despesas);
      const resultado = financeiroFaturamento - financeiroDespesas;

      // Insights determinísticos — cada um só entra se a condição fizer
      // sentido (sem enfeite/filler quando não há nada relevante a dizer).
      const insights = [];

      const variacaoFaturamento = variacaoPct(faturamentoAtual, faturamentoAnterior);
      if (variacaoFaturamento != null) {
        let servicoDestaque = null;
        let maiorDelta = 0;
        for (const r of servicosVariacaoRows) {
          const delta = Math.abs(Number(r.atual) - Number(r.anterior));
          if (delta > maiorDelta) {
            maiorDelta = delta;
            servicoDestaque = r.nome;
          }
        }
        const direcao = variacaoFaturamento >= 0 ? 'cresceu' : 'caiu';
        const complemento = servicoDestaque ? ` — o principal fator foi ${servicoDestaque}.` : '';
        insights.push({
          tipo: 'faturamento',
          texto: `Faturamento ${direcao} ${Math.abs(variacaoFaturamento).toFixed(1)}% em relação ao mês anterior.${complemento}`,
        });
      }

      const perdidos = ag.cancelados + ag.faltas;
      if (perdidos > 0) {
        insights.push({
          tipo: 'perdas',
          texto: `${ag.cancelados} cancelamento${ag.cancelados === 1 ? '' : 's'} e ${ag.faltas} falta${ag.faltas === 1 ? '' : 's'} este mês representam uma perda estimada de ${Number(perdidosRows[0].total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em faturamento (com base no preço atual dos serviços).`,
        });
      }

      const semRetorno60d = semRetornoRows[0].total;
      if (semRetorno60d > 0) {
        insights.push({
          tipo: 'clientes_inativos',
          texto: `${semRetorno60d} cliente${semRetorno60d === 1 ? '' : 's'} ${semRetorno60d === 1 ? 'está' : 'estão'} sem retorno há mais de 60 dias.`,
        });
      }

      // Dia da semana com menor/maior ocupação relativa (atendimentos ÷
      // quantas vezes aquele dia caiu no mês) — só entre dias que o salão
      // abre; só reporta se houver pelo menos 2 dias distintos pra comparar.
      const NOMES_DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
      const atendimentosPorDow = new Map(weekdayRows.map((r) => [r.dow, r.total]));
      const relativoPorDow = diasFuncionamento
        .filter((dow) => ocorrenciasPorDiaSemana[dow] > 0)
        .map((dow) => ({
          dow,
          relativo: ((atendimentosPorDow.get(dow) || 0) / ocorrenciasPorDiaSemana[dow] / Math.max(1, slotsPorDia * profissionaisCount)) * 100,
        }));
      if (relativoPorDow.length >= 2) {
        const menor = relativoPorDow.reduce((a, b) => (b.relativo < a.relativo ? b : a));
        const maior = relativoPorDow.reduce((a, b) => (b.relativo > a.relativo ? b : a));
        if (maior.relativo > 0 && menor.dow !== maior.dow) {
          const diffPct = ((maior.relativo - menor.relativo) / maior.relativo) * 100;
          if (diffPct >= 5) {
            insights.push({
              tipo: 'ocupacao_semanal',
              texto: `${NOMES_DIAS_SEMANA[menor.dow]} tem ${diffPct.toFixed(0)}% menos ocupação que ${NOMES_DIAS_SEMANA[maior.dow]}. Considere uma campanha pra preencher esses horários.`,
            });
          }
        }
      }

      return {
        mes,
        mes_anterior: mesAnterior,
        kpis: {
          // `anterior` (valor absoluto do mês anterior, não só o %) alimenta
          // a linha de comparação da Seção 2 ("Agosto: R$ X / Julho: R$ Y").
          faturamento: { valor: faturamentoAtual, anterior: faturamentoAnterior, variacao_pct: variacaoFaturamento },
          recebido: { valor: recebidoAtual, anterior: recebidoAnterior, variacao_pct: variacaoPct(recebidoAtual, recebidoAnterior) },
          atendimentos: { valor: ag.total, anterior: ag.total_anterior, variacao_pct: variacaoPct(ag.total, ag.total_anterior) },
          clientes: { valor: cl.atual, anterior: cl.anterior, variacao_pct: variacaoPct(cl.atual, cl.anterior) },
          ticket_medio: { valor: ticketMedioAtual, anterior: ticketMedioAnterior, variacao_pct: variacaoPct(ticketMedioAtual, ticketMedioAnterior) },
        },
        faturamento_diario: faturamentoDiario,
        agenda: {
          atendimentos_total: ag.total,
          agendados: ag.agendados,
          realizados: ag.realizados,
          cancelados: ag.cancelados,
          faltas: ag.faltas,
          ocupacao_pct: ocupacaoPct,
          taxa_comparecimento_pct: taxaComparecimentoPct,
        },
        servicos: servicosRows.map((r) => ({ nome: r.nome, atendimentos: r.atendimentos, faturamento: Number(r.faturamento) })),
        clientes: {
          total: cl.atual,
          novos: cl.novos,
          recorrentes: clientesRecorrentes,
          taxa_retorno_pct: cl.atual > 0 ? (clientesRecorrentes / cl.atual) * 100 : null,
          sem_retorno_60d: semRetorno60d,
        },
        financeiro: {
          faturamento: financeiroFaturamento,
          despesas: financeiroDespesas,
          resultado,
          margem_pct: financeiroFaturamento > 0 ? (resultado / financeiroFaturamento) * 100 : null,
        },
        insights,
      };
    }
  );
}

module.exports = { registerRelatoriosRoutes };
