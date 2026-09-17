// CRUD de Profissionais (US17/ST17.2) — extraído de index.js (fase 2 da
// modularização).
const { garantirProfissionalPadrao } = require('../lib/profissionais');
const planos = require('../lib/planos');

async function definirServicosDoProfissional(client, tenantId, profissionalId, servicoIds) {
  if (!Array.isArray(servicoIds)) return;
  // Só vincula serviços que realmente pertencem a este tenant — evita que
  // um id de outro tenant seja injetado no vínculo.
  await client.query('DELETE FROM profissionais_servicos WHERE profissional_id = $1', [profissionalId]);
  if (servicoIds.length === 0) return;
  await client.query(
    `INSERT INTO profissionais_servicos (profissional_id, servico_id)
     SELECT $1, s.id FROM servicos s WHERE s.tenant_id = $2 AND s.id = ANY($3::uuid[])`,
    [profissionalId, tenantId, servicoIds]
  );
}

function registerProfissionaisRoutes(fastify, pool) {
  // Lista de profissionais do tenant, usada para popular o dropdown do
  // formulário de novo agendamento (ST09.2 / US09). Inclui os ids dos
  // serviços que cada um atende, usado na tela de gestão (US17/ST17.4).
  fastify.get('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    await garantirProfissionalPadrao(tenantId);
    const { rows } = await pool.query(
      `SELECT p.id, p.nome, p.email, p.telefone, p.pix,
              COALESCE(array_agg(ps.servico_id) FILTER (WHERE ps.servico_id IS NOT NULL), '{}') AS servicos
       FROM profissionais p
       LEFT JOIN profissionais_servicos ps ON ps.profissional_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id, p.nome, p.email, p.telefone, p.pix
       ORDER BY p.nome`,
      [tenantId]
    );
    return { profissionais: rows };
  });

  fastify.post('/api/profissionais', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { nome, servicos, email, telefone, pix } = request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }
    // Mesmo limite da coluna (076_profissionais_contato_pix.sql) — validado
    // aqui também pra devolver erro claro em vez de estourar exceção de SQL.
    if (pix && pix.length > 77) {
      return reply.code(400).send({ error: 'Campo "pix" deve ter no máximo 77 caracteres' });
    }

    // Trava de limite do plano — conta quantos profissionais o tenant já tem
    // contra plano_limites.profissionais do plano efetivo (mesmo critério de
    // "plano efetivo" já usado em POST /api/pagamentos/cadastrar: sem plano
    // escolhido ainda, o valor de referência é o plano padrão). `valor` nulo
    // (ou sem linha em plano_limites pro plano) significa ilimitado.
    const { rows: tenantRows } = await pool.query('SELECT plano FROM tenants WHERE id = $1', [tenantId]);
    const planoEfetivo = tenantRows[0] && tenantRows[0].plano && tenantRows[0].plano !== 'trial'
      ? tenantRows[0].plano
      : planos.PLANO_PADRAO_CHAVE;
    const { rows: limiteRows } = await pool.query(
      `SELECT valor FROM plano_limites WHERE plano_chave = $1 AND chave = 'profissionais'`,
      [planoEfetivo]
    );
    const limite = limiteRows[0] ? limiteRows[0].valor : null;
    if (limite != null) {
      const { rows: contagemRows } = await pool.query(
        'SELECT COUNT(*)::int AS total FROM profissionais WHERE tenant_id = $1',
        [tenantId]
      );
      if (contagemRows[0].total >= limite) {
        return reply.code(409).send({
          error: `Seu plano permite até ${limite} ${limite === 1 ? 'profissional' : 'profissionais'}. Fale com o suporte para aumentar o limite.`,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO profissionais (tenant_id, nome, email, telefone, pix)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, telefone, pix`,
        [tenantId, nome.trim(), email ? email.trim() : null, telefone ? telefone.trim() : null, pix ? pix.trim() : null]
      );
      await definirServicosDoProfissional(client, tenantId, rows[0].id, servicos);
      await client.query('COMMIT');
      reply.code(201);
      return { ...rows[0], servicos: servicos || [] };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;
    const { nome, servicos, email, telefone, pix } = request.body || {};

    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" não pode ficar vazio' });
    }
    if (pix && pix.length > 77) {
      return reply.code(400).send({ error: 'Campo "pix" deve ter no máximo 77 caracteres' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE profissionais SET
           nome = COALESCE($3, nome),
           email = CASE WHEN $4 THEN $5 ELSE email END,
           telefone = CASE WHEN $6 THEN $7 ELSE telefone END,
           pix = CASE WHEN $8 THEN $9 ELSE pix END
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, nome, email, telefone, pix`,
        [
          id, tenantId, nome ? nome.trim() : null,
          email !== undefined, email ? email.trim() : null,
          telefone !== undefined, telefone ? telefone.trim() : null,
          pix !== undefined, pix ? pix.trim() : null,
        ]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Profissional não encontrado' });
      }
      await definirServicosDoProfissional(client, tenantId, id, servicos);
      await client.query('COMMIT');
      return { ...rows[0], servicos: servicos !== undefined ? servicos : undefined };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.delete('/api/profissionais/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params;

    // ST17.5 — mesma proteção do DELETE de serviço.
    const { rows: futuros } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM agendamentos
       WHERE tenant_id = $1 AND profissional_id = $2 AND status = 'confirmado' AND data_hora > now()`,
      [tenantId, id]
    );
    if (futuros[0].total > 0) {
      return reply.code(409).send({
        error: `Não é possível excluir: há ${futuros[0].total} agendamento(s) futuro(s) com este profissional.`,
      });
    }

    const { rowCount } = await pool.query('DELETE FROM profissionais WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!rowCount) {
      return reply.code(404).send({ error: 'Profissional não encontrado' });
    }
    return { ok: true };
  });
}

module.exports = { registerProfissionaisRoutes };
