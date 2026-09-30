// CRUD de Serviços (US17/ST17.1) — extraído de index.js (fase 2 da
// modularização).
const { garantirProfissionalPadrao } = require('../lib/profissionais');
const { sincronizarLancamentoFinanceiro } = require('../lib/financeiro');

// Descrição curta do serviço (US60/CA02) — limite pra não virar um texto
// longo dentro do card da listagem.
const DESCRICAO_SERVICO_MAX = 280;

// "Profissional exclusivo" (substituiu profissional_preferencial_id, que só
// pré-selecionava um default sem restringir nada) — mesma tabela de vínculo
// já usada pelo lado Profissionais (definirServicosDoProfissional em
// routes/profissionais.js), agora também editável pelo lado Serviço. Espelha
// exatamente aquele helper, só invertendo qual ponta é fixa.
async function definirProfissionaisDoServico(client, tenantId, servicoId, profissionalIds) {
  if (!Array.isArray(profissionalIds)) return;
  await client.query('DELETE FROM profissionais_servicos WHERE servico_id = $1', [servicoId]);
  if (profissionalIds.length === 0) return;
  await client.query(
    `INSERT INTO profissionais_servicos (profissional_id, servico_id)
     SELECT p.id, $1 FROM profissionais p WHERE p.tenant_id = $2 AND p.excluido_em IS NULL AND p.id = ANY($3::uuid[])`,
    [servicoId, tenantId, profissionalIds]
  );
}

function registerServicosRoutes(fastify, pool) {
  fastify.get('/api/servicos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT s.id, s.nome, s.duracao_minutos, s.preco, s.descricao, s.ativo,
              COALESCE(array_agg(ps.profissional_id) FILTER (WHERE ps.profissional_id IS NOT NULL), '{}') AS profissionais_exclusivos
       FROM servicos s
       LEFT JOIN profissionais_servicos ps ON ps.servico_id = s.id
       WHERE s.tenant_id = $1 AND s.excluido_em IS NULL
       GROUP BY s.id
       ORDER BY s.nome`,
      [tenantId]
    );
    return { servicos: rows };
  });

  fastify.post('/api/servicos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, duracao_minutos: duracaoMinutos, preco, descricao, profissionais_exclusivos: profissionaisExclusivos } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0) {
      return reply.code(400).send({ error: 'Campo "duracao_minutos" deve ser um número maior que zero' });
    }
    // Preço passou a ser obrigatório na criação (pedido explícito
    // 2026-09-17) — antes era opcional e um serviço sem preço nunca gerava
    // lançamento financeiro automático (ver sincronizarLancamentoFinanceiro),
    // o que tornava "previsto"/faturamento silenciosamente incompletos.
    if (preco === undefined || preco === null) {
      return reply.code(400).send({ error: 'Campo "preco" é obrigatório' });
    }
    if (!Number.isFinite(preco) || preco < 0) {
      return reply.code(400).send({ error: 'Campo "preco" deve ser um número maior ou igual a zero' });
    }
    if (descricao && descricao.length > DESCRICAO_SERVICO_MAX) {
      return reply.code(400).send({ error: `Campo "descricao" deve ter no máximo ${DESCRICAO_SERVICO_MAX} caracteres` });
    }

    const client = await pool.connect();
    let servico;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO servicos (tenant_id, nome, duracao_minutos, preco, descricao)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, duracao_minutos, preco, descricao, ativo`,
        [tenantId, nome.trim(), duracaoMinutos, preco ?? null, descricao ? descricao.trim() : null]
      );
      servico = rows[0];

      // Tenant com um único profissional (fora do plano Custom) não tem como
      // vincular manualmente pela tela Profissionais (menu oculto) — sem isso
      // o serviço recém-criado ficaria inagendável pelo bot/IA.
      const profissionalPadrao = await garantirProfissionalPadrao(tenantId);
      if (profissionalPadrao.unico) {
        await client.query(
          'INSERT INTO profissionais_servicos (profissional_id, servico_id) VALUES ($1, $2)',
          [profissionalPadrao.id, servico.id]
        );
        servico.profissionais_exclusivos = [profissionalPadrao.id];
      } else {
        await definirProfissionaisDoServico(client, tenantId, servico.id, profissionaisExclusivos || []);
        servico.profissionais_exclusivos = profissionaisExclusivos || [];
      }
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    reply.code(201);
    return servico;
  });

  fastify.patch('/api/servicos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, duracao_minutos: duracaoMinutos, preco, descricao, ativo, profissionais_exclusivos: profissionaisExclusivos } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" não pode ficar vazio' });
    }
    if (duracaoMinutos !== undefined && (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0)) {
      return reply.code(400).send({ error: 'Campo "duracao_minutos" deve ser um número maior que zero' });
    }
    if (preco !== undefined && preco !== null && (!Number.isFinite(preco) || preco < 0)) {
      return reply.code(400).send({ error: 'Campo "preco" deve ser um número maior ou igual a zero' });
    }
    if (descricao && descricao.length > DESCRICAO_SERVICO_MAX) {
      return reply.code(400).send({ error: `Campo "descricao" deve ter no máximo ${DESCRICAO_SERVICO_MAX} caracteres` });
    }

    const client = await pool.connect();
    let servico;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE servicos SET
           nome = COALESCE($3, nome),
           duracao_minutos = COALESCE($4, duracao_minutos),
           preco = CASE WHEN $5 THEN $6 ELSE preco END,
           descricao = CASE WHEN $7 THEN $8 ELSE descricao END,
           ativo = COALESCE($9, ativo)
         WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL
         RETURNING id, nome, duracao_minutos, preco, descricao, ativo`,
        [
          id, tenantId, nome ? nome.trim() : null, duracaoMinutos ?? null, preco !== undefined, preco ?? null,
          descricao !== undefined, descricao ? descricao.trim() : null, ativo ?? null,
        ]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Serviço não encontrado' });
      }
      servico = rows[0];
      if (profissionaisExclusivos !== undefined) {
        await definirProfissionaisDoServico(client, tenantId, id, profissionaisExclusivos);
      }
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    // "Previsto" do dashboard Início (GET /api/inicio/resumo) soma
    // lancamentos_financeiros.valor — sem isso, mudar nome/preço aqui nunca
    // alcançava agendamentos futuros já criados: o lançamento ficava travado
    // no preço da hora da criação pra sempre (achado 2026-09-17). Só
    // agendamentos ainda não concluídos/cancelados ('confirmado'/'a_confirmar'
    // == lancamento 'previsto') — os já concluídos são histórico, não mexe.
    if (nome !== undefined || preco !== undefined) {
      const { rows: agsAfetados } = await pool.query(
        `SELECT id, data_hora, status FROM agendamentos WHERE tenant_id = $1 AND servico_id = $2 AND status IN ('confirmado', 'a_confirmar')`,
        [tenantId, id]
      );
      for (const ag of agsAfetados) {
        // eslint-disable-next-line no-await-in-loop
        await sincronizarLancamentoFinanceiro(pool, {
          tenantId, agendamentoId: ag.id, servicoNome: servico.nome, servicoPreco: servico.preco,
          dataHora: ag.data_hora, statusAgendamento: ag.status, formaPagamento: null,
        });
      }
    }

    const { rows: exclusivos } = await pool.query(
      'SELECT profissional_id FROM profissionais_servicos WHERE servico_id = $1', [id]
    );
    servico.profissionais_exclusivos = exclusivos.map((r) => r.profissional_id);
    return servico;
  });

  // CA da exclusão (redesenho do menu Serviços): soft delete, não mais um
  // DELETE de verdade — servico_id tem ON DELETE CASCADE em agendamentos, e
  // um hard delete apagaria o histórico de agendamentos antigos que usam
  // esse serviço. "Excluir" só marca excluido_em (some da listagem e de
  // novos agendamentos); os agendamentos já feitos continuam intactos.
  fastify.delete('/api/servicos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    const { rowCount } = await pool.query(
      'UPDATE servicos SET excluido_em = now() WHERE id = $1 AND tenant_id = $2 AND excluido_em IS NULL',
      [id, tenantId]
    );
    if (!rowCount) {
      return reply.code(404).send({ error: 'Serviço não encontrado' });
    }
    return { ok: true };
  });
}

module.exports = { registerServicosRoutes };
