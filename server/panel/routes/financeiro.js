// Financeiro — extraído de index.js (fase 5 da modularização):
// GET /api/financeiro/resumo, GET /api/financeiro/resumo-dashboard,
// GET/POST/PATCH /api/financeiro/lancamentos[/:id]. Não inclui
// GET /api/inicio/resumo (cross-cutting, agrega Agenda+Financeiro+IA, fica
// em index.js) nem GET /api/relatorios/resumo (routes/relatorios.js).
const { mesAtualBrasilia, dataAtualBrasilia } = require('../lib/datetime');

function registerFinanceiroRoutes(fastify, pool) {
  const FINANCEIRO_PERIODOS_VALIDOS = ['mes', 'semana', 'dia'];

  // US71 — cláusula de intervalo compartilhada entre o resumo por período
  // (CA01) e o detalhamento de lançamentos (US71.2). 'semana' usa
  // date_trunc('week', ...), que no Postgres começa na segunda-feira — mesmo
  // critério do inicioDaSemana() do frontend (app.js), pra não haver
  // divergência entre o que a semana mostra no resumo e no detalhamento.
  function clausulaPeriodoFinanceiro(periodo) {
    if (periodo === 'semana') {
      return `l.data >= date_trunc('week', $2::date) AND l.data < date_trunc('week', $2::date) + interval '7 days'`;
    }
    if (periodo === 'dia') return `l.data = $2::date`;
    return `to_char(l.data, 'YYYY-MM') = $2`;
  }

  function referenciaPadraoFinanceiro(periodo) {
    return periodo === 'mes' ? mesAtualBrasilia() : dataAtualBrasilia();
  }

  // US71/CA01 — resumo (realizado/previsto/total) unificado por período,
  // alimenta os cards das 3 abas da página /financeiro. Sempre só receita
  // (tipo='entrada') — mesmo recorte do resumo-dashboard (US70). Cancelado
  // nunca conta (não aparece em nenhum FILTER abaixo).
  fastify.get(
    '/api/financeiro/resumo',
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro'), fastify.requireAdmin] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { periodo } = request.query;
      if (!FINANCEIRO_PERIODOS_VALIDOS.includes(periodo)) {
        return reply.code(422).send({ error: `periodo deve ser um de: ${FINANCEIRO_PERIODOS_VALIDOS.join(', ')}` });
      }
      const referencia = request.query.referencia || referenciaPadraoFinanceiro(periodo);

      const { rows } = await pool.query(
        `SELECT
           COALESCE(SUM(l.valor) FILTER (WHERE l.status = 'realizado'), 0) AS realizado,
           COALESCE(SUM(l.valor) FILTER (WHERE l.status = 'previsto'), 0) AS previsto
         FROM lancamentos_financeiros l
         WHERE l.tenant_id = $1 AND l.tipo = 'entrada' AND ${clausulaPeriodoFinanceiro(periodo)}`,
        [tenantId, referencia]
      );
      const realizado = Number(rows[0].realizado);
      const previsto = Number(rows[0].previsto);
      return { periodo, referencia, realizado, previsto, total: realizado + previsto };
    }
  );

  // US70/CA01 — resumo financeiro pra tela inicial (4 cards): só receita
  // (tipo='entrada', mesmo recorte de `previsto`/`realizado` já usado no
  // resumo mensal do financeiro em si) hoje e no mês corrente, em horário de
  // Brasília. `cancelado` nunca entra (não está em nenhum FILTER abaixo).
  fastify.get(
    '/api/financeiro/resumo-dashboard',
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro'), fastify.requireAdmin] },
    async (request) => {
      const { tenantId } = request.user;
      const hoje = dataAtualBrasilia();
      const mesRef = mesAtualBrasilia();

      const { rows } = await pool.query(
        `SELECT
           COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND data = $2), 0) AS realizado_hoje,
           COALESCE(SUM(valor) FILTER (WHERE status = 'previsto'  AND data = $2), 0) AS previsto_hoje,
           COALESCE(SUM(valor) FILTER (WHERE status = 'realizado' AND to_char(data, 'YYYY-MM') = $3), 0) AS realizado_mes,
           COALESCE(SUM(valor) FILTER (WHERE status = 'previsto'  AND to_char(data, 'YYYY-MM') = $3), 0) AS previsto_mes
         FROM lancamentos_financeiros
         WHERE tenant_id = $1 AND tipo = 'entrada'`,
        [tenantId, hoje, mesRef]
      );
      const r = rows[0];
      return {
        realizado_hoje: Number(r.realizado_hoje),
        previsto_hoje: Number(r.previsto_hoje),
        realizado_mes: Number(r.realizado_mes),
        previsto_mes: Number(r.previsto_mes),
      };
    }
  );

  fastify.get(
    '/api/financeiro/lancamentos',
    // US62 — dinheiro é visão de administrador; operador não acessa.
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro'), fastify.requireAdmin] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const periodoQuery = request.query.periodo;

      // US71.2 — ?periodo=semana|dia&referencia=... é o modo novo (detalhamento
      // das abas Semana/Dia); sem `periodo`, mantém o comportamento legado
      // (?mes=..., US18/US64) intacto, inclusive o default pro mês corrente.
      if (periodoQuery && !FINANCEIRO_PERIODOS_VALIDOS.includes(periodoQuery)) {
        return reply.code(422).send({ error: `periodo deve ser um de: ${FINANCEIRO_PERIODOS_VALIDOS.join(', ')}` });
      }
      const periodo = periodoQuery || 'mes';
      const referencia = periodo === 'mes'
        ? (request.query.mes || request.query.referencia || mesAtualBrasilia())
        : (request.query.referencia || referenciaPadraoFinanceiro(periodo));

      // LEFT JOIN com agendamentos/clientes/servicos só resolve campos pra
      // exibição (CA "Cenário 8" — identificar cliente/serviço/data do
      // atendimento a partir do financeiro); lançamentos manuais (US18) têm
      // agendamento_id nulo e os três campos vêm null.
      // profissional_id/servico_id (além do agendamento_id que já vinha) são
      // pro menu de ações da linha (PR4) reaproveitar abrirModalReagendar(ag),
      // que precisa desses dois campos pra consultar disponibilidade — sem
      // eles só dava pra reagendar recarregando o agendamento por outra rota.
      // a.data_hora dá a hora real do atendimento (tela mostra "14:00" em vez
      // da data na aba Dia, onde o dia já está óbvio pelo nav do período) —
      // só existe pra lançamento de agendamento; manual (l.data é só data,
      // sem hora) continua mostrando a data.
      const { rows } = await pool.query(
        `SELECT l.id, l.tipo, l.valor, l.valor_liquido, l.forma_pagamento, l.descricao, l.data, l.status, l.agendamento_id,
                c.nome AS cliente, s.nome AS servico, a.data_hora,
                a.profissional_id, a.servico_id
         FROM lancamentos_financeiros l
         LEFT JOIN agendamentos a ON a.id = l.agendamento_id
         LEFT JOIN clientes c ON c.id = a.cliente_id
         LEFT JOIN servicos s ON s.id = a.servico_id
         WHERE l.tenant_id = $1 AND ${clausulaPeriodoFinanceiro(periodo)}
         ORDER BY l.data DESC, l.criado_em DESC`,
        [tenantId, referencia]
      );
      const lancamentos = rows.map((r) => ({ ...r, origem: r.agendamento_id ? 'agendamento' : 'manual' }));

      // Cancelado (CA "Cenário 6") não conta em nenhum resumo — não é receita
      // prevista nem realizada ativa, só fica visível na listagem pra
      // conferência. previsto/realizado (US64) diferenciam a receita de
      // agendamento; entradas/saidas/saldo (US18) continuam a soma total do
      // que está ativo, pra não quebrar os cards que já existiam.
      const ativos = lancamentos.filter((r) => r.status !== 'cancelado');
      const entradas = ativos.filter((r) => r.tipo === 'entrada').reduce((soma, r) => soma + Number(r.valor), 0);
      const saidas = ativos.filter((r) => r.tipo === 'saida').reduce((soma, r) => soma + Number(r.valor), 0);
      const previsto = ativos.filter((r) => r.tipo === 'entrada' && r.status === 'previsto').reduce((soma, r) => soma + Number(r.valor), 0);
      const realizado = ativos.filter((r) => r.tipo === 'entrada' && r.status === 'realizado').reduce((soma, r) => soma + Number(r.valor), 0);

      return {
        mes: periodo === 'mes' ? referencia : undefined,
        periodo,
        referencia,
        lancamentos,
        resumo: { entradas, saidas, saldo: entradas - saidas, previsto, realizado },
      };
    }
  );

  fastify.post(
    '/api/financeiro/lancamentos',
    // US62 — dinheiro é visão de administrador; operador não acessa.
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro'), fastify.requireAdmin] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { tipo, valor, descricao, data } = request.body || {};

      if (!['entrada', 'saida'].includes(tipo)) {
        return reply.code(400).send({ error: 'Campo "tipo" deve ser "entrada" ou "saida"' });
      }
      if (!Number.isFinite(valor) || valor <= 0) {
        return reply.code(400).send({ error: 'Campo "valor" deve ser um número maior que zero' });
      }

      // Lançamento manual: sem agendamento_id, status nasce 'realizado' (é o
      // default da coluna) — já representa um valor que efetivamente
      // entrou/saiu, diferente da receita prevista de um agendamento.
      const { rows } = await pool.query(
        `INSERT INTO lancamentos_financeiros (tenant_id, tipo, valor, descricao, data)
         VALUES ($1, $2, $3, $4, COALESCE($5, current_date))
         RETURNING id, tipo, valor, descricao, data, status, agendamento_id`,
        [tenantId, tipo, valor, descricao || null, data || null]
      );
      reply.code(201);
      return { ...rows[0], origem: 'manual' };
    }
  );

  // Editar valor/descrição de um lançamento (menu de 3 pontos, "Editar") e
  // cancelar uma despesa manual ("Cancelar despesa") — mesma rota, dois usos.
  // status só pode virar 'cancelado' e só em lançamento manual
  // (agendamento_id nulo): cancelar um lançamento de agendamento tem que
  // passar pelo PATCH /api/agendamentos/:id (abrirModalCancelarPagamentoLancamento),
  // senão o status do agendamento e o do lançamento dessincronizam — a
  // sincronização é sempre agendamento → lançamento (sincronizarLancamentoFinanceiro),
  // nunca o contrário.
  fastify.patch(
    '/api/financeiro/lancamentos/:id',
    { preHandler: [fastify.authenticate, fastify.requireModulo('financeiro'), fastify.requireAdmin] },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { valor, descricao, status } = request.body || {};

      if (valor !== undefined && (!Number.isFinite(valor) || valor <= 0)) {
        return reply.code(400).send({ error: 'Campo "valor" deve ser um número maior que zero' });
      }
      if (status !== undefined && status !== 'cancelado') {
        return reply.code(400).send({ error: 'Por aqui, status só pode virar "cancelado" (cancelar uma despesa manual).' });
      }

      const { rows } = await pool.query(
        `UPDATE lancamentos_financeiros SET
           valor = COALESCE($3, valor),
           descricao = CASE WHEN $4::boolean THEN $5 ELSE descricao END,
           status = COALESCE($6, status)
         WHERE id = $1 AND tenant_id = $2
           AND ($6::text IS NULL OR agendamento_id IS NULL)
         RETURNING id, tipo, valor, descricao, data, status, agendamento_id`,
        [id, tenantId, valor ?? null, descricao !== undefined, descricao ?? null, status ?? null]
      );
      if (!rows[0]) {
        return reply.code(404).send({ error: 'Lançamento não encontrado' });
      }
      return { ...rows[0], origem: rows[0].agendamento_id ? 'agendamento' : 'manual' };
    }
  );
}

module.exports = { registerFinanceiroRoutes };
