const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TIPOS_NOTIFICACAO, listarNotificacoesPendentes } = require('../lib/notificacoes');
const planosCatalogo = require('../lib/planos');

// fakePool devolve `rows` fixo pra qualquer query — suficiente pro tipo
// whatsapp_aguardando_humano (1 query só).
function fakePool(rows = []) {
  return { query: async () => ({ rows }) };
}

// disparos_acabando precisa de 2 respostas diferentes (plano do tenant +
// contagem de disparos do mês) — casa pelo texto do SQL, mesmo padrão usado
// em outros testes-unit deste repo (ex.: agenda-recorrencia.test.js).
// `listarNotificacoesPendentes` roda TODOS os tipos registrados, então
// mesmo testando só disparos_acabando essa fake pool também precisa
// responder a query do whatsapp_aguardando_humano (vazia = sem interferir).
function fakePoolDisparos({ plano, usados }) {
  return {
    query: async (sql) => {
      if (/FROM tenants/.test(sql)) return { rows: [{ plano }] };
      if (/FROM whatsapp_disparos/.test(sql)) return { rows: [{ total: usados }] };
      if (/FROM clientes/.test(sql)) return { rows: [] };
      throw new Error(`query inesperada no teste: ${sql}`);
    },
  };
}

describe('TIPOS_NOTIFICACAO', () => {
  test('whatsapp_aguardando_humano está registrado', () => {
    assert.ok(TIPOS_NOTIFICACAO.some((t) => t.chave === 'whatsapp_aguardando_humano'));
  });
  test('disparos_acabando está registrado com campoNumerico', () => {
    const tipo = TIPOS_NOTIFICACAO.find((t) => t.chave === 'disparos_acabando');
    assert.ok(tipo);
    assert.equal(tipo.campoNumerico.chave, 'limiar');
    assert.equal(tipo.campoNumerico.padrao, 10);
  });
});

describe('listarNotificacoesPendentes — whatsapp_aguardando_humano', () => {
  test('tipo com itens pendentes aparece no resultado', async () => {
    const pool = fakePool([{ id: 'c1', nome: 'Bruno', telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, 'whatsapp_aguardando_humano');
    assert.equal(r[0].itens.length, 1);
    assert.equal(r[0].itens[0].titulo, 'Bruno');
  });

  test('tipo sem nenhum item pendente não aparece no resultado', async () => {
    const pool = fakePool([]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(r, []);
  });

  test('chave ausente em notificacoesAtivas conta como ativa (default seguro)', async () => {
    const pool = fakePool([{ id: 'c1', nome: null, telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', {}); // objeto vazio, sem a chave
    assert.equal(r.length, 1);
  });

  test('{ativo:false} desliga o tipo, mesmo com itens pendentes', async () => {
    const pool = fakePool([{ id: 'c1', nome: 'Bruno', telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', { whatsapp_aguardando_humano: { ativo: false } });
    assert.deepEqual(r, []);
  });

  test('notificacoesAtivas nulo/undefined não quebra (trata como {})', async () => {
    const pool = fakePool([{ id: 'c1', nome: 'Bruno', telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', null);
    assert.equal(r.length, 1);
  });

  test('sem telefone/nome (fallback pro telefone como título)', async () => {
    const pool = fakePool([{ id: 'c1', nome: null, telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.equal(r[0].itens[0].titulo, '5534999999999');
  });
});

describe('listarNotificacoesPendentes — disparos_acabando', () => {
  test('plano sem limite (limite_disparos null) nunca notifica', async () => {
    const pool = fakePoolDisparos({ plano: null, usados: 999 });
    // sem plano/limite: obterPlano('sem-plano-nenhum') → undefined, cobre o
    // mesmo caminho de "plano null/desconhecido" do código de produção
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(r, []);
  });

  test('restante acima do limiar padrão (10): não notifica', async () => {
    // monta o catálogo com um plano de limite 100, 50 usados -> restam 50
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 50 });
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(r, []);
  });

  test('restante <= limiar padrão (10): notifica com a contagem certa', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 93 }); // restam 7
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, 'disparos_acabando');
    assert.match(r[0].itens[0].titulo, /Restam 7 disparo/);
  });

  test('limiar customizado (config.limiar) é respeitado', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 70 }); // restam 30
    const semNotificar = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(semNotificar, []); // 30 > 10 (padrão)

    const comLimiarAlto = await listarNotificacoesPendentes(pool, 't1', { disparos_acabando: { ativo: true, limiar: 40 } });
    assert.equal(comLimiarAlto.length, 1); // 30 <= 40
  });

  test('{ativo:false} desliga mesmo com pouco restante', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 99 });
    const r = await listarNotificacoesPendentes(pool, 't1', { disparos_acabando: { ativo: false } });
    assert.deepEqual(r, []);
  });
});
