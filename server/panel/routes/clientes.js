// Clientes — extraído de index.js (fase 4 da modularização):
// GET/POST/DELETE /api/clientes[/:id], GET /api/clientes/buscar-por-telefone,
// GET/PATCH /api/clientes/:id.
const { normalizarTelefoneCliente } = require('../lib/clientes');

// Listagem de clientes (menu Clientes): nome, telefone, último atendimento
// (serviço + data) e o total geral de resultados (pra montar a paginação
// no frontend). Filtro por nome/telefone (ILIKE, substring), ordenação por
// nome ou telefone (ASC/DESC) e paginação (10/50/100 por página) — tudo
// resolvido aqui, não no frontend, pra não precisar carregar a base de
// clientes inteira a cada acesso.
const CLIENTES_TAMANHOS_VALIDOS = new Set([10, 50, 100]);
const CLIENTES_STATUS_VALIDOS = new Set(['todos', 'ativo', 'novo', 'inativo']);
// Status derivado (não é uma coluna) — novo = cadastrado nos últimos 30 dias
// (limiar fixo, não é o mesmo conceito do "inativo" abaixo); inativo = mais
// antigo que isso E sem nenhum atendimento confirmado/concluído nos últimos
// N dias, onde N é o `cliente_inativo_dias` configurável do tenant
// (Preferências, default 30 — ver 065_tenants_cliente_inativo_dias.sql e
// GET/PATCH /api/configuracao). Mesmo N usado pra "clientes sem retorno" no
// dashboard Início (GET /api/inicio/resumo), reaproveitado aqui em vez de
// inventar outra fonte pro mesmo número. Subquery correlacionada (em vez de
// JOIN) porque essa string é injetada tanto no SELECT quanto no WHERE de
// queries diferentes — um JOIN teria que ser repetido em cada uma.
const CLIENTE_STATUS_SQL = `CASE
  WHEN c.criado_em >= now() - interval '30 days' THEN 'novo'
  WHEN NOT EXISTS (
    SELECT 1 FROM agendamentos a2
    WHERE a2.cliente_id = c.id AND a2.status IN ('confirmado', 'concluido')
      AND a2.data_hora >= now() - make_interval(days => (
        SELECT t.cliente_inativo_dias FROM tenants t WHERE t.id = c.tenant_id
      ))
  ) THEN 'inativo'
  ELSE 'ativo'
END`;

function registerClientesRoutes(fastify, pool) {
  fastify.get('/api/clientes', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const busca = (request.query.busca || '').trim();
    const status = CLIENTES_STATUS_VALIDOS.has(request.query.status) ? request.query.status : 'todos';
    const ordem = request.query.ordem === 'desc' ? 'desc' : 'asc';
    const tamanho = CLIENTES_TAMANHOS_VALIDOS.has(Number(request.query.tamanho)) ? Number(request.query.tamanho) : 10;
    const pagina = Math.max(1, parseInt(request.query.pagina, 10) || 1);
    const offset = (pagina - 1) * tamanho;
    const ordenacaoSQL = ordem === 'desc' ? 'c.nome DESC NULLS LAST, c.telefone ASC' : 'c.nome ASC NULLS LAST, c.telefone ASC';

    const { rows } = await pool.query(
      `SELECT c.id, c.nome, c.telefone,
              ultimo.servico_nome AS ultimo_atendimento, ultimo.data_hora AS ultimo_atendimento_data,
              proximo.servico_nome AS proximo_atendimento, proximo.data_hora AS proximo_atendimento_data,
              COALESCE(gasto.total, 0) AS total_gasto,
              ${CLIENTE_STATUS_SQL} AS status,
              count(*) OVER()::int AS total_geral
       FROM clientes c
       LEFT JOIN LATERAL (
         -- mesmo fix de GET /api/clientes/:id: sem "< now()" um agendamento
         -- futuro confirmado virava "Último atendimento" na listagem.
         SELECT s.nome AS servico_nome, a.data_hora
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.cliente_id = c.id AND a.status IN ('confirmado', 'concluido') AND a.data_hora < now()
         ORDER BY a.data_hora DESC
         LIMIT 1
       ) ultimo ON true
       LEFT JOIN LATERAL (
         SELECT s.nome AS servico_nome, a.data_hora
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.cliente_id = c.id AND a.status = 'confirmado' AND a.data_hora >= now()
         ORDER BY a.data_hora ASC
         LIMIT 1
       ) proximo ON true
       LEFT JOIN LATERAL (
         SELECT sum(l.valor) AS total
         FROM lancamentos_financeiros l
         JOIN agendamentos a ON a.id = l.agendamento_id
         WHERE a.cliente_id = c.id AND l.status = 'realizado'
       ) gasto ON true
       WHERE c.tenant_id = $1 AND c.excluido_em IS NULL
         AND ($2 = '' OR c.nome ILIKE '%' || $2 || '%' OR c.telefone ILIKE '%' || $2 || '%' OR c.email ILIKE '%' || $2 || '%')
         AND ($3 = 'todos' OR ${CLIENTE_STATUS_SQL} = $3)
       ORDER BY ${ordenacaoSQL}
       LIMIT $4 OFFSET $5`,
      [tenantId, busca, status, tamanho, offset]
    );

    const { rows: kpiRows } = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE criado_em >= date_trunc('month', now()))::int AS novos_mes,
         count(*) FILTER (WHERE ${CLIENTE_STATUS_SQL} = 'inativo')::int AS para_retornar
       FROM clientes c
       WHERE c.tenant_id = $1 AND c.excluido_em IS NULL`,
      [tenantId]
    );

    const total = rows[0] ? rows[0].total_geral : 0;
    return {
      clientes: rows.map(({ total_geral, ...c }) => c),
      total,
      pagina,
      tamanho,
      kpis: kpiRows[0],
    };
  });

  // Cadastro manual de cliente (menu Clientes, botão "+ Novo cliente") — até
  // aqui um registro em `clientes` só nascia via upsert por telefone (bot/IA
  // ou POST /api/agendamentos). Upsert por telefone aqui também: reengajar um
  // telefone já cadastrado (inclusive um soft-deletado, ver excluido_em)
  // atualiza os dados em vez de colidir com a unique key (tenant_id, telefone).
  fastify.post('/api/clientes', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, telefone: telefoneBruto, email } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Nome não pode ficar em branco.' });
    }
    const telefone = normalizarTelefoneCliente(telefoneBruto);
    if (!telefone) {
      return reply.code(400).send({ error: 'Telefone inválido.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO clientes (tenant_id, nome, telefone, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, telefone) DO UPDATE SET
         nome = EXCLUDED.nome,
         email = COALESCE(EXCLUDED.email, clientes.email),
         excluido_em = NULL
       RETURNING id, nome, telefone, email`,
      [tenantId, nome.trim(), telefone, (email || '').trim() || null]
    );
    return { cliente: rows[0] };
  });

  // Exclusão de cliente (soft delete, ver 058_clientes_exclusao.sql) — hard
  // delete cascatearia pra agendamentos/lancamentos_financeiros (perda real
  // de histórico), então só marca excluido_em e some da listagem. Se o
  // cliente voltar a interagir (nova mensagem/agendamento), o upsert por
  // telefone (POST /api/agendamentos, processarMensagemIA) já limpa
  // excluido_em de novo — ver comentário nesses pontos.
  fastify.delete('/api/clientes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { rowCount } = await pool.query(
      'UPDATE clientes SET excluido_em = now() WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL',
      [id, tenantId]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: 'Cliente não encontrado' });
    }
    return { ok: true };
  });

  // Busca cliente existente pelo telefone (chave única tenant_id+telefone,
  // garantida no banco desde 001_init.sql) — usada pelo modal "Novo
  // agendamento" pra carregar o nome automaticamente ao digitar um telefone
  // já cadastrado, em vez de depender do ON CONFLICT DO UPDATE de POST
  // /api/agendamentos pra reconciliar um nome digitado errado por engano.
  fastify.get('/api/clientes/buscar-por-telefone', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    // Normalizado com DDI (mesmo formato canônico de clientes.telefone, ver
    // normalizarTelefoneCliente) — o frontend manda só os dígitos digitados
    // (sem 55), sem isso a busca nunca batia com um cliente que já tinha
    // mandado mensagem pelo WhatsApp.
    const telefone = normalizarTelefoneCliente(request.query.telefone);
    if (!telefone) return { cliente: null };
    const { rows } = await pool.query(
      'SELECT id, nome, telefone FROM clientes WHERE tenant_id = $1 AND telefone = $2 LIMIT 1',
      [tenantId, telefone]
    );
    return { cliente: rows[0] || null };
  });

  // Detalhe do cliente (menu Clientes): dados básicos + próximo agendamento
  // confirmado + histórico de atendimentos (data, serviço, valor, forma de
  // pagamento). Só agendamentos 'confirmado'/'concluido' contam como
  // atendimento — mesmo critério já usado em GET /api/clientes, cancelado
  // não é histórico de atendimento de verdade.
  fastify.get('/api/clientes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    const { rows: clienteRows } = await pool.query(
      'SELECT id, nome, telefone, data_nascimento, email, observacoes FROM clientes WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const cliente = clienteRows[0];
    if (!cliente) {
      return reply.code(404).send({ error: 'Cliente não encontrado' });
    }

    const { rows: proximoRows } = await pool.query(
      `SELECT a.data_hora, s.nome AS servico_nome, p.nome AS profissional_nome
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN profissionais p ON p.id = a.profissional_id
       WHERE a.cliente_id = $1 AND a.tenant_id = $2 AND a.status = 'confirmado' AND a.data_hora >= now()
       ORDER BY a.data_hora ASC
       LIMIT 1`,
      [id, tenantId]
    );

    // status IN ('confirmado','concluido') sem filtro de data trazia
    // agendamentos FUTUROS confirmados pra dentro do histórico — como o
    // ORDER BY é DESC, um agendamento futuro tem a maior data e virava
    // historico[0] ("Último atendimento" no front), duplicando o que a query
    // de proximoRows acima já mostra como "Próximo agendamento". `< now()`
    // garante que só entra aqui o que já aconteceu de fato.
    const { rows: historico } = await pool.query(
      `SELECT a.id, a.data_hora, a.status, s.nome AS servico_nome,
              l.valor, l.forma_pagamento
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN lancamentos_financeiros l ON l.agendamento_id = a.id
       WHERE a.cliente_id = $1 AND a.tenant_id = $2 AND a.status IN ('confirmado', 'concluido')
         AND a.data_hora < now()
       ORDER BY a.data_hora DESC`,
      [id, tenantId]
    );

    return { cliente, proximo_atendimento: proximoRows[0] || null, historico };
  });

  // Edita nome/data de nascimento/email/observações do cliente (menu
  // Clientes, tela de perfil) — telefone não é editável aqui: é a chave que
  // liga o cliente às mensagens recebidas no WhatsApp (unique
  // tenant_id+telefone), mudar por engano quebraria esse vínculo
  // silenciosamente.
  fastify.patch('/api/clientes/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, data_nascimento: dataNascimento, email, observacoes } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Nome não pode ficar em branco.' });
    }
    if (dataNascimento !== undefined && dataNascimento !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return reply.code(400).send({ error: 'Data de nascimento inválida.' });
    }

    const { rows } = await pool.query(
      `UPDATE clientes SET
         nome = COALESCE($3, nome),
         data_nascimento = CASE WHEN $4::boolean THEN $5::date ELSE data_nascimento END,
         email = CASE WHEN $6::boolean THEN $7 ELSE email END,
         observacoes = CASE WHEN $8::boolean THEN $9 ELSE observacoes END
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, nome, telefone, data_nascimento, email, observacoes`,
      [
        id, tenantId, nome ?? null,
        dataNascimento !== undefined, dataNascimento ?? null,
        email !== undefined, (email || '').trim() || null,
        observacoes !== undefined, observacoes ?? null,
      ]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Cliente não encontrado' });
    }
    return { cliente: rows[0] };
  });
}

module.exports = { registerClientesRoutes };
