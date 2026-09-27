const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TIPOS_NOTIFICACAO, listarNotificacoesPendentes } = require('../lib/notificacoes');

// fakePool devolve `rows` fixo pra qualquer query — suficiente aqui porque
// só existe 1 tipo de notificação hoje (cada `calcular` faz 1 query só).
function fakePool(rows = []) {
  return { query: async () => ({ rows }) };
}

describe('TIPOS_NOTIFICACAO', () => {
  test('whatsapp_aguardando_humano está registrado', () => {
    assert.ok(TIPOS_NOTIFICACAO.some((t) => t.chave === 'whatsapp_aguardando_humano'));
  });
});

describe('listarNotificacoesPendentes', () => {
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

  test('chave explicitamente false desliga o tipo, mesmo com itens pendentes', async () => {
    const pool = fakePool([{ id: 'c1', nome: 'Bruno', telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', { whatsapp_aguardando_humano: false });
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
