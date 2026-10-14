// Integração real (Postgres de verdade) do acesso de profissional — a
// única forma de verificar isto de ponta a ponta, já que a SQL nova
// (filtro por profissional_id, schema, sessão de 90 dias) é exatamente o
// que mais importa acertar aqui. index.js não exporta um build() testável
// (não existe precedente disso neste repo), então as rotas reais
// (routes/agenda.js, routes/portal-profissional.js, routes/equipe.js) são
// exercitadas aqui via um harness Fastify mínimo próprio, com
// `authenticate` substituído por um decorator de teste que só lê
// request.user de um header — isola "a SQL/lógica da rota está certa" de
// "o authenticate real decide direito quem pode logar", que são
// preocupações diferentes. O allowlist/403 de `fastify.authenticate`
// (index.js) fica fora deste arquivo (exigiria rodar o app real inteiro);
// conferido por leitura cuidadosa do diff, não por este teste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const Fastify = require('fastify');

const temBanco = !!process.env.DATABASE_URL;
const opts = temBanco ? {} : { skip: 'sem DATABASE_URL' };

const { registerAgendaRoutes } = require('../routes/agenda');
const { registerPortalProfissionalRoutes } = require('../routes/portal-profissional');
const { registerEquipeRoutes } = require('../routes/equipe');
const {
  criarSessaoProfissional,
  resolverSessaoProfissional,
  revogarSessoesProfissional,
  hashToken,
} = require('../lib/sessao-profissional');

let pool;
let tenantId;
let profA; // profissional A — dono dos agendamentos/usuário de teste
let profB; // profissional B — usado pra confirmar isolamento
let profC; // profissional C — exclusivo do teste de convite/aceite, nunca
           // reusado por outro teste, pra nunca colidir com
           // uq_usuarios_profissional mesmo se outro teste falhar no meio
let servicoId; // preço conhecido, usado pro cálculo de financeiro

// Harness mínimo: registra só o que cada grupo de teste precisa, com
// `authenticate` lendo request.user de um header JSON (nunca usado em
// produção — só neste arquivo) em vez de verificar token de verdade.
function criarAppTeste({ comoAdmin = false } = {}) {
  const fastify = Fastify();
  fastify.decorate('authenticate', async (request, reply) => {
    const bruto = request.headers['x-test-user'];
    if (!bruto) return reply.code(401).send({ error: 'sem x-test-user no teste' });
    request.user = JSON.parse(bruto);
  });
  fastify.decorate('requireAdmin', async (request, reply) => {
    if (request.user.role !== 'administrador') return reply.code(403).send({ error: 'restrito' });
  });
  fastify.decorate('requireProfissional', async (request, reply) => {
    if (request.user.role !== 'profissional' || !request.user.profissionalId) {
      return reply.code(403).send({ error: 'restrito' });
    }
  });
  if (comoAdmin) registerEquipeRoutes(fastify, pool);
  registerAgendaRoutes(fastify, pool);
  registerPortalProfissionalRoutes(fastify, pool);
  return fastify;
}

function headerUser(user) {
  return { 'x-test-user': JSON.stringify(user) };
}

before(async () => {
  if (!temBanco) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows: [t] } = await pool.query(
    "INSERT INTO tenants (nome, telefone) VALUES ('Tenant Teste Acesso Profissional', '34999999999') RETURNING id",
  );
  tenantId = t.id;
  const { rows: [sv] } = await pool.query(
    'INSERT INTO servicos (tenant_id, nome, duracao_minutos, preco) VALUES ($1, $2, 30, 150.00) RETURNING id',
    [tenantId, 'Corte de teste'],
  );
  servicoId = sv.id;
  const { rows: [pa] } = await pool.query('INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id', [tenantId, 'Profissional A']);
  profA = pa.id;
  const { rows: [pb] } = await pool.query('INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id', [tenantId, 'Profissional B']);
  profB = pb.id;
  const { rows: [pc] } = await pool.query('INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id', [tenantId, 'Profissional C']);
  profC = pc.id;
});

after(async () => {
  if (!temBanco) return;
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]); // cascade cuida do resto
  await pool.end();
});

// --- Schema (migration 094) ---

test('usuarios aceita role=profissional e senha_hash null', opts, async () => {
  const { rows: [u] } = await pool.query(
    `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, role, email_verified, profissional_id)
     VALUES ($1, $2, NULL, 'Fulano', 'profissional', true, $3) RETURNING id, senha_hash`,
    [tenantId, `fulano-${Date.now()}@teste.kyvvo`, profA],
  );
  assert.equal(u.senha_hash, null);
  await pool.query('DELETE FROM usuarios WHERE id = $1', [u.id]);
});

test('usuarios rejeita role fora de administrador/operador/profissional', opts, async () => {
  await assert.rejects(
    () => pool.query(
      `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, role, email_verified) VALUES ($1, $2, 'x', 'Y', 'inventado', true)`,
      [tenantId, `invalido-${Date.now()}@teste.kyvvo`],
    ),
    /violates check constraint/,
  );
});

test('uq_usuarios_profissional: só um login por profissional', opts, async () => {
  const email1 = `dup1-${Date.now()}@teste.kyvvo`;
  const email2 = `dup2-${Date.now()}@teste.kyvvo`;
  const { rows: [u1] } = await pool.query(
    `INSERT INTO usuarios (tenant_id, email, nome, role, email_verified, profissional_id)
     VALUES ($1, $2, 'U1', 'profissional', true, $3) RETURNING id`,
    [tenantId, email1, profA],
  );
  await assert.rejects(
    () => pool.query(
      `INSERT INTO usuarios (tenant_id, email, nome, role, email_verified, profissional_id)
       VALUES ($1, $2, 'U2', 'profissional', true, $3)`,
      [tenantId, email2, profA],
    ),
    /duplicate key value violates unique constraint "uq_usuarios_profissional"/,
  );
  await pool.query('DELETE FROM usuarios WHERE id = $1', [u1.id]);
});

// --- lib/sessao-profissional.js ---

test('criarSessaoProfissional + resolverSessaoProfissional: roundtrip', opts, async () => {
  const { rows: [u] } = await pool.query(
    `INSERT INTO usuarios (tenant_id, email, nome, role, email_verified, profissional_id)
     VALUES ($1, $2, 'Sessao Teste', 'profissional', true, $3) RETURNING id`,
    [tenantId, `sessao-${Date.now()}@teste.kyvvo`, profA],
  );
  try {
    const token = await criarSessaoProfissional(pool, { usuarioId: u.id, tenantId });
    const resolvido = await resolverSessaoProfissional(pool, token);
    assert.equal(resolvido.usuario_id, u.id);
    assert.equal(resolvido.tenant_id, tenantId);

    // O que fica no banco é o hash, nunca o token em texto puro.
    const { rows: [linha] } = await pool.query('SELECT token_hash FROM sessoes_profissional WHERE usuario_id = $1', [u.id]);
    assert.equal(linha.token_hash, hashToken(token));
    assert.notEqual(linha.token_hash, token);
  } finally {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [u.id]);
  }
});

test('resolverSessaoProfissional: token errado, expirado ou revogado nunca resolve', opts, async () => {
  const { rows: [u] } = await pool.query(
    `INSERT INTO usuarios (tenant_id, email, nome, role, email_verified, profissional_id)
     VALUES ($1, $2, 'Sessao Teste 2', 'profissional', true, $3) RETURNING id`,
    [tenantId, `sessao2-${Date.now()}@teste.kyvvo`, profA],
  );
  try {
    assert.equal(await resolverSessaoProfissional(pool, 'token-que-nunca-existiu'), null);
    assert.equal(await resolverSessaoProfissional(pool, null), null);

    // Expirada: insere direto com expira_em no passado (criarSessaoProfissional sempre cria 90 dias à frente).
    const tokenExpirado = 'a'.repeat(64);
    await pool.query(
      `INSERT INTO sessoes_profissional (usuario_id, tenant_id, token_hash, expira_em) VALUES ($1, $2, $3, now() - interval '1 day')`,
      [u.id, tenantId, hashToken(tokenExpirado)],
    );
    assert.equal(await resolverSessaoProfissional(pool, tokenExpirado), null);

    // Revogada.
    const tokenRevogado = await criarSessaoProfissional(pool, { usuarioId: u.id, tenantId });
    await revogarSessoesProfissional(pool, u.id);
    assert.equal(await resolverSessaoProfissional(pool, tokenRevogado), null);
  } finally {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [u.id]);
  }
});

// --- routes/agenda.js — escopo por profissional ---

test('GET /api/agendamentos: profissional só vê os próprios atendimentos; admin vê todos', opts, async () => {
  const { rows: [cliente] } = await pool.query(
    'INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, 'Cliente Teste', `3499${Date.now()}`.slice(0, 11)],
  );
  const dataRef = '2026-06-15';
  const { rows: [agA] } = await pool.query(
    `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, $4, $5::date + time '10:00', 'confirmado') RETURNING id`,
    [tenantId, cliente.id, profA, servicoId, dataRef],
  );
  const { rows: [agB] } = await pool.query(
    `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, $4, $5::date + time '11:00', 'confirmado') RETURNING id`,
    [tenantId, cliente.id, profB, servicoId, dataRef],
  );

  const app = criarAppTeste();
  try {
    const comoProfissionalA = await app.inject({
      method: 'GET', url: `/api/agendamentos?view=dia&data=${dataRef}`,
      headers: headerUser({ tenantId, profissionalId: profA }),
    });
    const corpoA = comoProfissionalA.json();
    assert.deepEqual(corpoA.agendamentos.map((a) => a.id).sort(), [agA.id]);

    const comoAdmin = await app.inject({
      method: 'GET', url: `/api/agendamentos?view=dia&data=${dataRef}`,
      headers: headerUser({ tenantId }), // sem profissionalId — mesmo shape de admin/operador hoje
    });
    const corpoAdmin = comoAdmin.json();
    assert.deepEqual(corpoAdmin.agendamentos.map((a) => a.id).sort(), [agA.id, agB.id].sort());
  } finally {
    await app.close();
    await pool.query('DELETE FROM agendamentos WHERE id = ANY($1)', [[agA.id, agB.id]]);
    await pool.query('DELETE FROM clientes WHERE id = $1', [cliente.id]);
  }
});

// --- routes/portal-profissional.js — financeiro calculado ---

test('GET /api/portal-profissional/resumo: soma só concluídos do mês, do profissional certo', opts, async () => {
  const { rows: [cliente] } = await pool.query(
    'INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, 'Cliente Financeiro', `3498${Date.now()}`.slice(0, 11)],
  );
  const inserir = (profissionalId, dataHora, status) => pool.query(
    `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, cliente.id, profissionalId, servicoId, dataHora, status],
  );
  const { rows: [concluidoA] } = await inserir(profA, '2026-07-10T10:00:00Z', 'concluido');
  const { rows: [canceladoA] } = await inserir(profA, '2026-07-11T10:00:00Z', 'cancelado'); // não deve contar
  const { rows: [concluidoB] } = await inserir(profB, '2026-07-12T10:00:00Z', 'concluido'); // outro profissional, não deve contar
  const { rows: [foraDoMesA] } = await inserir(profA, '2026-08-01T10:00:00Z', 'concluido'); // outro mês, não deve contar

  const app = criarAppTeste();
  try {
    const res = await app.inject({
      method: 'GET', url: '/api/portal-profissional/resumo?mes=2026-07',
      headers: headerUser({ tenantId, profissionalId: profA, role: 'profissional' }),
    });
    const corpo = res.json();
    assert.equal(corpo.atendimentos, 1);
    assert.equal(corpo.receita, 150);

    // Sem profissionalId/role certo -> requireProfissional barra.
    const semProfissional = await app.inject({
      method: 'GET', url: '/api/portal-profissional/resumo?mes=2026-07',
      headers: headerUser({ tenantId, role: 'administrador' }),
    });
    assert.equal(semProfissional.statusCode, 403);
  } finally {
    await app.close();
    await pool.query('DELETE FROM agendamentos WHERE id = ANY($1)', [[concluidoA.id, canceladoA.id, concluidoB.id, foraDoMesA.id]]);
    await pool.query('DELETE FROM clientes WHERE id = $1', [cliente.id]);
  }
});

// --- routes/equipe.js — convite/aceite sem senha ---

test('convite de profissional: exige profissional_id, aceite não pede senha, gera sessão válida', opts, async () => {
  const app = criarAppTeste({ comoAdmin: true });
  const { rows: [adminUser] } = await pool.query(
    `INSERT INTO usuarios (tenant_id, email, nome, role, email_verified) VALUES ($1, $2, 'Admin Teste', 'administrador', true) RETURNING id`,
    [tenantId, `admin-${Date.now()}@teste.kyvvo`],
  );
  const emailConvidado = `convidado-${Date.now()}@teste.kyvvo`;

  try {
    // Sem profissional_id -> 400
    const semProf = await app.inject({
      method: 'POST', url: '/api/equipe/convites',
      headers: headerUser({ tenantId, userId: adminUser.id, role: 'administrador' }),
      payload: { email: emailConvidado, role: 'profissional' },
    });
    assert.equal(semProf.statusCode, 400);

    // Criação válida
    const criar = await app.inject({
      method: 'POST', url: '/api/equipe/convites',
      headers: headerUser({ tenantId, userId: adminUser.id, role: 'administrador' }),
      payload: { email: emailConvidado, role: 'profissional', profissional_id: profC },
    });
    assert.equal(criar.statusCode, 201);

    const { rows: [convite] } = await pool.query(
      'SELECT token FROM convites_equipe WHERE tenant_id = $1 AND email = $2', [tenantId, emailConvidado],
    );

    // Segundo convite pro mesmo profissional -> 409 (já tem convite pendente)
    const dup = await app.inject({
      method: 'POST', url: '/api/equipe/convites',
      headers: headerUser({ tenantId, userId: adminUser.id, role: 'administrador' }),
      payload: { email: `outro-${Date.now()}@teste.kyvvo`, role: 'profissional', profissional_id: profC },
    });
    assert.equal(dup.statusCode, 409);

    // Aceite SEM senha
    const aceitar = await app.inject({
      method: 'POST', url: `/api/equipe/convites/${convite.token}/aceitar`,
      payload: { nome: 'Fulano Profissional' },
    });
    assert.equal(aceitar.statusCode, 200);
    const corpoAceite = aceitar.json();
    assert.ok(corpoAceite.token);
    assert.equal(corpoAceite.role, 'profissional');

    // O token devolvido é uma sessão de profissional de verdade.
    const resolvido = await resolverSessaoProfissional(pool, corpoAceite.token);
    assert.ok(resolvido);

    // Revogar via PATCH /membros mata a sessão.
    const { rows: [usuarioNovo] } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [emailConvidado]);
    const patch = await app.inject({
      method: 'PATCH', url: `/api/equipe/membros/${usuarioNovo.id}`,
      headers: headerUser({ tenantId, userId: adminUser.id, role: 'administrador' }),
      payload: { ativo: false },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(await resolverSessaoProfissional(pool, corpoAceite.token), null);

    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioNovo.id]);
  } finally {
    await app.close();
    await pool.query("DELETE FROM convites_equipe WHERE tenant_id = $1 AND email LIKE 'convidado-%' OR email LIKE 'outro-%'", [tenantId]);
    await pool.query('DELETE FROM usuarios WHERE id = $1', [adminUser.id]);
  }
});
