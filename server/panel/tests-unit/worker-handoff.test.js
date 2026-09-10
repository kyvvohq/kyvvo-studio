const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { devolverHandoffsExpirados } = require('../lib/worker-handoff');

// Worker de retorno automático de handoff (US: conversa em 'aguardando_humano'
// que o salão não retoma volta pro bot depois de N horas). A função é a única
// parte testável sem Postgres — recebe o pool e o limite em horas, faz um
// único UPDATE ... RETURNING e devolve as linhas afetadas. O que importa
// cobrir: nunca rodar com limite quebrado (0/NaN devolveria conversa recém
// assumida) e sempre passar o limite como parâmetro, nunca interpolado.

function fakePool(rows = []) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      return { rows };
    },
  };
}

describe('devolverHandoffsExpirados', () => {
  test('limite inválido (0, negativo, NaN, não-número) não toca o banco', async () => {
    for (const invalido of [0, -1, -0.5, NaN, Infinity, null, undefined, 'abc', '']) {
      const pool = fakePool();
      const r = await devolverHandoffsExpirados(pool, invalido);
      assert.deepEqual(r, [], `deveria devolver [] pra limite=${JSON.stringify(invalido)}`);
      assert.equal(pool.chamadas.length, 0, `não deveria consultar o banco pra limite=${JSON.stringify(invalido)}`);
    }
  });

  test('limite válido: um único UPDATE com o limite como parâmetro ($1), não interpolado', async () => {
    const pool = fakePool([]);
    await devolverHandoffsExpirados(pool, 2);
    assert.equal(pool.chamadas.length, 1);
    assert.deepEqual(pool.chamadas[0].params, [2]);
    const sql = pool.chamadas[0].sql;
    assert.match(sql, /UPDATE clientes/i);
    assert.match(sql, /status_conversa = 'aguardando_humano'/);
    assert.match(sql, /aguardando_humano_desde IS NOT NULL/);
    assert.match(sql, /\$1 \* interval '1 hour'/);
    assert.match(sql, /RETURNING id, tenant_id/);
    // não pode ter o número do limite grudado no SQL
    assert.doesNotMatch(sql, /interval '2 hour'/);
  });

  test('devolve exatamente as linhas do UPDATE ... RETURNING', async () => {
    const afetadas = [{ id: 'c1', tenant_id: 't1' }, { id: 'c2', tenant_id: 't2' }];
    const r = await devolverHandoffsExpirados(fakePool(afetadas), 4);
    assert.deepEqual(r, afetadas);
  });

  test('aceita o limite como string numérica (vem de parseInt/config do admin)', async () => {
    const pool = fakePool([]);
    await devolverHandoffsExpirados(pool, '3');
    assert.deepEqual(pool.chamadas[0].params, [3]);
  });

  test('nenhuma conversa expirada: devolve [] sem erro', async () => {
    const r = await devolverHandoffsExpirados(fakePool([]), 2);
    assert.deepEqual(r, []);
  });
});
