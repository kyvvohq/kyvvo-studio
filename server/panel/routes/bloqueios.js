// Bloqueios manuais de agenda (US61) + Feriados nacionais (Configurações >
// Bloqueio de agenda) — extraído de index.js (fase 1 da modularização,
// primeiro grupo de rotas movido pra provar o padrão). `POST
// /api/agendamentos` continua em index.js — é Agenda, não Bloqueios, mesmo
// vivendo perto dessas rotas no arquivo original.
const { componentesBrasilia, isoDeComponentesBrasilia } = require('../lib/datetime');
const { listarFeriadosNacionais, ehFeriadoNacional } = require('../lib/feriados');
const { empurrarProximoDiaAberto } = require('../lib/horario-funcionamento');

function registerBloqueiosRoutes(fastify, pool) {
  fastify.get('/api/bloqueios', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT b.id, b.profissional_id, p.nome AS profissional, b.inicio, b.fim, b.motivo, b.ativo
       FROM bloqueios_agenda b
       LEFT JOIN profissionais p ON p.id = b.profissional_id
       WHERE b.tenant_id = $1
       ORDER BY b.inicio`,
      [tenantId]
    );
    return { bloqueios: rows };
  });

  fastify.post('/api/bloqueios', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { inicio, fim, motivo, profissional_id: profissionalId } = request.body || {};

    if (!inicio || !fim) {
      return reply.code(400).send({ error: 'Campos "inicio" e "fim" são obrigatórios' });
    }
    const inicioData = new Date(inicio);
    const fimData = new Date(fim);
    if (Number.isNaN(inicioData.getTime()) || Number.isNaN(fimData.getTime())) {
      return reply.code(400).send({ error: 'Datas inválidas' });
    }
    if (fimData <= inicioData) {
      return reply.code(400).send({ error: 'O fim do bloqueio deve ser depois do início' });
    }

    if (profissionalId) {
      const { rows: profissionalRows } = await pool.query(
        'SELECT id FROM profissionais WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL',
        [profissionalId, tenantId]
      );
      if (!profissionalRows[0]) {
        return reply.code(404).send({ error: 'Profissional não encontrado' });
      }
    }

    // Sobreposição inválida (CA04): não deixa bloquear um período que já tem
    // agendamento confirmado — o dono precisa cancelar/reagendar esses
    // atendimentos antes de bloquear o horário, em vez do bloqueio silenciar
    // um conflito que já existe.
    const { rows: conflitos } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM agendamentos a
       JOIN servicos s ON s.id = a.servico_id
       WHERE a.tenant_id = $1
         AND a.status = 'confirmado'
         AND ($2::uuid IS NULL OR a.profissional_id = $2)
         AND a.data_hora < $4::timestamptz
         AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
      [tenantId, profissionalId || null, inicio, fim]
    );
    if (conflitos[0].total > 0) {
      return reply.code(409).send({
        error: `Não é possível bloquear: há ${conflitos[0].total} agendamento(s) confirmado(s) nesse período.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO bloqueios_agenda (tenant_id, profissional_id, inicio, fim, motivo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, profissional_id, inicio, fim, motivo, ativo`,
      [tenantId, profissionalId || null, inicio, fim, motivo ? motivo.trim() : null]
    );
    reply.code(201);
    return rows[0];
  });

  // CRUD padrão (Editar/Desativar/Excluir, mesmo de Serviços) — edita
  // inicio/fim/motivo/profissional/ativo. Reaplica as mesmas validações do
  // POST quando o período ou o profissional mudam (mesclando com os valores
  // atuais via COALESCE antes de checar), pra não deixar salvar uma edição
  // que colidiria com um agendamento confirmado.
  fastify.patch('/api/bloqueios/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { inicio, fim, motivo, profissional_id: profissionalId, ativo } = request.body || {};

    const { rows: atuais } = await pool.query(
      'SELECT id, profissional_id, inicio, fim, motivo FROM bloqueios_agenda WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (!atuais[0]) {
      return reply.code(404).send({ error: 'Bloqueio não encontrado' });
    }
    const atual = atuais[0];
    const novoInicio = inicio !== undefined ? inicio : atual.inicio;
    const novoFim = fim !== undefined ? fim : atual.fim;
    const novoProfissionalId = profissionalId !== undefined ? profissionalId : atual.profissional_id;

    if (inicio !== undefined || fim !== undefined) {
      const inicioData = new Date(novoInicio);
      const fimData = new Date(novoFim);
      if (Number.isNaN(inicioData.getTime()) || Number.isNaN(fimData.getTime())) {
        return reply.code(400).send({ error: 'Datas inválidas' });
      }
      if (fimData <= inicioData) {
        return reply.code(400).send({ error: 'O fim do bloqueio deve ser depois do início' });
      }
    }

    if (novoProfissionalId) {
      const { rows: profissionalRows } = await pool.query(
        'SELECT id FROM profissionais WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL',
        [novoProfissionalId, tenantId]
      );
      if (!profissionalRows[0]) {
        return reply.code(404).send({ error: 'Profissional não encontrado' });
      }
    }

    if (inicio !== undefined || fim !== undefined || profissionalId !== undefined) {
      const { rows: conflitos } = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
         WHERE a.tenant_id = $1
           AND a.status = 'confirmado'
           AND ($2::uuid IS NULL OR a.profissional_id = $2)
           AND a.data_hora < $4::timestamptz
           AND $3::timestamptz < a.data_hora + (s.duracao_minutos * interval '1 minute')`,
        [tenantId, novoProfissionalId || null, novoInicio, novoFim]
      );
      if (conflitos[0].total > 0) {
        return reply.code(409).send({
          error: `Não é possível bloquear: há ${conflitos[0].total} agendamento(s) confirmado(s) nesse período.`,
        });
      }
    }

    const { rows } = await pool.query(
      `UPDATE bloqueios_agenda SET
         profissional_id = CASE WHEN $3 THEN $4 ELSE profissional_id END,
         inicio = COALESCE($5, inicio),
         fim = COALESCE($6, fim),
         motivo = CASE WHEN $7 THEN $8 ELSE motivo END,
         ativo = COALESCE($9, ativo)
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, profissional_id, inicio, fim, motivo, ativo`,
      [
        id, tenantId,
        profissionalId !== undefined, profissionalId || null,
        inicio || null, fim || null,
        motivo !== undefined, motivo ? motivo.trim() : null,
        ativo ?? null,
      ]
    );
    return rows[0];
  });

  fastify.delete('/api/bloqueios/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    const { rowCount } = await pool.query('DELETE FROM bloqueios_agenda WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!rowCount) {
      return reply.code(404).send({ error: 'Bloqueio não encontrado' });
    }
    return { ok: true };
  });

  // Um switch só (não um bloqueio por feriado): a lista em si não é editável
  // (calculada, não persistida — ver listarFeriadosNacionais), só o
  // habilitado/desabilitado por tenant.
  fastify.get('/api/feriados', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query('SELECT feriados_bloqueados FROM tenants WHERE id = $1', [tenantId]);
    const anoAtual = componentesBrasilia(new Date().toISOString()).ano;
    return {
      habilitado: rows[0] ? rows[0].feriados_bloqueados : false,
      feriados: listarFeriadosNacionais(anoAtual),
    };
  });

  fastify.patch('/api/feriados', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { habilitado } = request.body || {};
    if (typeof habilitado !== 'boolean') {
      return reply.code(400).send({ error: 'Campo "habilitado" é obrigatório (true/false).' });
    }

    let agendamentosMovidos = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (habilitado) {
        const { rows: tenantRows } = await client.query(
          'SELECT dias_funcionamento FROM tenants WHERE id = $1 FOR UPDATE',
          [tenantId]
        );
        const diasFuncionamento = tenantRows[0].dias_funcionamento || [1, 2, 3, 4, 5, 6];

        // Mesmo raciocínio do reagendamento em cascata de PATCH
        // /api/configuracao (dias_funcionamento mudando): só agendamentos
        // futuros e confirmados que caem num feriado são movidos, pro mesmo
        // horário no primeiro dia útil seguinte, sem checar colisão com
        // outro agendamento já existente nesse dia — comportamento simples,
        // equivalente a um reagendamento manual apressado (mesma decisão já
        // tomada pro caso de dias_funcionamento). O frontend já confirmou
        // essa consequência num popup antes de chamar este PATCH.
        const { rows: futuros } = await client.query(
          `SELECT id, data_hora FROM agendamentos WHERE tenant_id = $1 AND status = 'confirmado' AND data_hora > now()`,
          [tenantId]
        );
        for (const ag of futuros) {
          const comp = componentesBrasilia(ag.data_hora);
          if (!ehFeriadoNacional(comp.ano, comp.mes + 1, comp.dia)) continue;
          const resolvido = empurrarProximoDiaAberto(comp, diasFuncionamento, true);
          if (!resolvido) continue; // trava de segurança (dias_funcionamento vazio) — não deveria acontecer na prática
          await client.query('UPDATE agendamentos SET data_hora = $1 WHERE id = $2', [isoDeComponentesBrasilia(resolvido), ag.id]);
          agendamentosMovidos++;
        }
      }

      await client.query('UPDATE tenants SET feriados_bloqueados = $2 WHERE id = $1', [tenantId, habilitado]);
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    return { habilitado, agendamentos_movidos: agendamentosMovidos };
  });
}

module.exports = { registerBloqueiosRoutes };
