// Adapter admin — endpoint server-to-server consumido pelo Kyvvo Admin
// (kyvvo-platform) pra montar o painel "Produtos" da visão 360° de um tenant.
//
// NÃO usa o JWT de admin: é chamada de serviço pra serviço, na rede interna
// do compose (http://studio:3001), autenticada por um segredo compartilhado
// — ADMIN_ADAPTER_TOKEN, provisionado no SSM em /kyvvo/studio/ e
// /kyvvo/platform/ com o mesmo valor. Sem esse token no ambiente o endpoint
// responde 503 e o Admin degrada mostrando "painel do produto indisponível".
//
// Só leitura. Contrato (envelope comum a todos os produtos):
//   { produto, rotulo, metricas: [{ chave, rotulo, valor }], ultima_atividade }

const crypto = require('crypto');
const metaWhatsappService = require('../meta-whatsapp-service');

function tokenConfere(header) {
  const esperado = process.env.ADMIN_ADAPTER_TOKEN;
  if (!esperado) return false;
  const recebido = String(header || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Consumo de IA (US68) — só linhas role='assistant' têm tokens (as únicas
// que chamam a Anthropic). Custo estimado, cotação fixa aproximada.
const IA_USD_ENTRADA_MI = 1.0; // Claude Haiku 4.5
const IA_USD_SAIDA_MI = 5.0;
const IA_USD_BRL = 5.3;
function custoBRL(entrada, saida) {
  const usd = (entrada / 1e6) * IA_USD_ENTRADA_MI + (saida / 1e6) * IA_USD_SAIDA_MI;
  return Number((usd * IA_USD_BRL).toFixed(2));
}

function autorizado(request, reply) {
  if (!process.env.ADMIN_ADAPTER_TOKEN) {
    reply.code(503).send({ error: 'Adapter não configurado neste ambiente.' });
    return false;
  }
  if (!tokenConfere(request.headers.authorization)) {
    reply.code(401).send({ error: 'Não autorizado.' });
    return false;
  }
  return true;
}

function registerAdminAdapterRoutes(fastify, pool) {
  fastify.get('/admin-adapter/tenants/:id', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;

    const { id } = request.params;
    const { rows: existe } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [id]);
    if (!existe[0]) {
      return reply.code(404).send({ error: 'Tenant não encontrado neste produto.' });
    }

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM servicos       WHERE tenant_id = $1) AS servicos,
         (SELECT count(*)::int FROM profissionais  WHERE tenant_id = $1 AND excluido_em IS NULL) AS profissionais,
         (SELECT count(*)::int FROM clientes       WHERE tenant_id = $1 AND excluido_em IS NULL) AS clientes,
         (SELECT count(*)::int FROM agendamentos   WHERE tenant_id = $1) AS agendamentos_total,
         (SELECT count(*)::int FROM agendamentos   WHERE tenant_id = $1 AND data_hora >= now() - interval '30 days') AS agendamentos_30d,
         (SELECT max(data_hora) FROM agendamentos  WHERE tenant_id = $1) AS ultimo_agendamento`,
      [id],
    );
    const c = rows[0];

    return {
      produto: 'studio',
      rotulo: 'Kyvvo Studio',
      metricas: [
        { chave: 'profissionais', rotulo: 'Profissionais', valor: c.profissionais },
        { chave: 'servicos', rotulo: 'Serviços', valor: c.servicos },
        { chave: 'clientes', rotulo: 'Clientes', valor: c.clientes },
        { chave: 'agendamentos_total', rotulo: 'Agendamentos (total)', valor: c.agendamentos_total },
        { chave: 'agendamentos_30d', rotulo: 'Agendamentos (30 dias)', valor: c.agendamentos_30d },
      ],
      ultima_atividade: c.ultimo_agendamento,
    };
  });

  // Consumo de IA agregado (US68) — pro painel "IA" do Kyvvo Admin. Sem
  // tenant = visão da plataforma inteira + quebra por tenant.
  fastify.get('/admin-adapter/ia-uso', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;

    const dias = Math.min(Math.max(parseInt(request.query.dias, 10) || 30, 1), 90);

    const [{ rows: porDia }, { rows: porTenant }] = await Promise.all([
      pool.query(
        `SELECT (criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
                count(*) FILTER (WHERE role = 'assistant')::int AS mensagens,
                coalesce(sum(tokens_entrada), 0)::bigint AS tokens_entrada,
                coalesce(sum(tokens_saida), 0)::bigint AS tokens_saida
           FROM conversas_ia
          WHERE criado_em >= now() - ($1 || ' days')::interval
          GROUP BY 1 ORDER BY 1`,
        [dias],
      ),
      pool.query(
        `SELECT t.id AS tenant_id, t.nome AS tenant_nome,
                count(*) FILTER (WHERE c.role = 'assistant')::int AS mensagens,
                count(DISTINCT c.cliente_id)::int AS conversas,
                coalesce(sum(c.tokens_entrada), 0)::bigint AS tokens_entrada,
                coalesce(sum(c.tokens_saida), 0)::bigint AS tokens_saida
           FROM conversas_ia c JOIN tenants t ON t.id = c.tenant_id
          WHERE c.criado_em >= now() - ($1 || ' days')::interval
          GROUP BY t.id, t.nome ORDER BY mensagens DESC`,
        [dias],
      ),
    ]);

    const somaEntrada = porDia.reduce((s, r) => s + Number(r.tokens_entrada), 0);
    const somaSaida = porDia.reduce((s, r) => s + Number(r.tokens_saida), 0);
    const totalMensagens = porDia.reduce((s, r) => s + Number(r.mensagens), 0);

    return {
      periodo: { dias },
      resumo: {
        mensagens: totalMensagens,
        tenants_ativos: porTenant.length,
        tokens_entrada: somaEntrada,
        tokens_saida: somaSaida,
        custo_brl: custoBRL(somaEntrada, somaSaida),
      },
      por_dia: porDia.map((r) => ({
        dia: r.dia.toISOString().slice(0, 10),
        mensagens: Number(r.mensagens),
        custo_brl: custoBRL(Number(r.tokens_entrada), Number(r.tokens_saida)),
      })),
      por_tenant: porTenant.map((r) => ({
        tenant_id: r.tenant_id,
        tenant_nome: r.tenant_nome,
        mensagens: Number(r.mensagens),
        conversas: Number(r.conversas),
        custo_brl: custoBRL(Number(r.tokens_entrada), Number(r.tokens_saida)),
      })),
    };
  });

  // ── Números prontos (US39.2) ──────────────────────────────────────────────
  // Inventário de números Kyvvo pré-adquiridos, vincular a um salão e testar.
  // Tudo é do Studio (tabela numeros_prontos, Meta Cloud API) — o Kyvvo Admin
  // opera por este adapter. Auditoria fica do lado do platform.

  fastify.get('/admin-adapter/numeros-prontos', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;
    const { rows } = await pool.query(
      `SELECT n.*, t.nome AS tenant_nome
         FROM numeros_prontos n LEFT JOIN tenants t ON t.id = n.tenant_id
        ORDER BY n.criado_em DESC`,
    );
    return { numeros: rows };
  });

  fastify.post('/admin-adapter/numeros-prontos', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;
    const b = request.body || {};
    if (!b.telefone || !b.meta_phone_number_id || !b.meta_waba_id) {
      return reply.code(400).send({ error: 'Informe telefone, meta_phone_number_id e meta_waba_id.' });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO numeros_prontos (telefone, meta_phone_number_id, meta_waba_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [String(b.telefone).trim(), String(b.meta_phone_number_id).trim(), String(b.meta_waba_id).trim()],
      );
      reply.code(201);
      return rows[0];
    } catch (erro) {
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse Phone Number ID já está cadastrado.' });
      }
      throw erro;
    }
  });

  fastify.post('/admin-adapter/numeros-prontos/:id/vincular', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;
    const { id } = request.params;
    const tenantId = (request.body || {}).tenant_id;
    if (!tenantId) return reply.code(400).send({ error: 'Informe tenant_id.' });

    const { rows: numRows } = await pool.query('SELECT * FROM numeros_prontos WHERE id = $1', [id]);
    const numero = numRows[0];
    if (!numero) return reply.code(404).send({ error: 'Número não encontrado.' });
    if (numero.status !== 'disponivel') {
      return reply.code(409).send({ error: `Número não está disponível (status: ${numero.status}).` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: tRows } = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
      if (!tRows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Salão (tenant) não encontrado.' });
      }
      await client.query(
        `UPDATE numeros_prontos SET tenant_id = $2, status = 'em_configuracao', vinculado_em = now()
         WHERE id = $1`,
        [id, tenantId],
      );
      await client.query(
        'UPDATE tenants SET meta_waba_id = $2, meta_phone_number_id = $3 WHERE id = $1',
        [tenantId, numero.meta_waba_id, numero.meta_phone_number_id],
      );
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse número já está conectado a outro salão.' });
      }
      throw erro;
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT n.*, t.nome AS tenant_nome FROM numeros_prontos n LEFT JOIN tenants t ON t.id = n.tenant_id WHERE n.id = $1`,
      [id],
    );
    return rows[0];
  });

  fastify.post('/admin-adapter/numeros-prontos/:id/testar', async (request, reply) => {
    if (!autorizado(request, reply)) return reply;
    const { id } = request.params;
    const numeroDestino = (request.body || {}).numero_destino;
    if (!numeroDestino) return reply.code(400).send({ error: 'Informe numero_destino.' });

    const { rows: numRows } = await pool.query('SELECT * FROM numeros_prontos WHERE id = $1', [id]);
    const numero = numRows[0];
    if (!numero) return reply.code(404).send({ error: 'Número não encontrado.' });
    if (!numero.tenant_id) {
      return reply.code(409).send({ error: 'Vincule o número a um salão antes de testar.' });
    }

    let status;
    let resultado;
    try {
      await metaWhatsappService.enviarMensagemTeste(numero.meta_phone_number_id, numeroDestino);
      status = 'ativo';
      resultado = `Mensagem de teste enviada com sucesso para ${numeroDestino}.`;
    } catch (erro) {
      status = 'erro';
      resultado = erro.message;
    }
    const { rows } = await pool.query(
      `UPDATE numeros_prontos SET status = $2, testado_em = now(), teste_resultado = $3
       WHERE id = $1 RETURNING *`,
      [id, status, resultado],
    );
    if (status === 'erro') return reply.code(400).send({ error: resultado, numero: rows[0] });
    return rows[0];
  });
}

module.exports = { registerAdminAdapterRoutes, tokenConfere };
