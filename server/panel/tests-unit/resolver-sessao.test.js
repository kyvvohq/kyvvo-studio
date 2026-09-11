const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolverClaims } = require('../lib/resolver-sessao');

// Pós-corte P3: sessão de tenant é sempre RS256 do kyvvo-platform (sem
// fallback HS256 — removido em 2026-09 depois que os tokens de 7 dias
// emitidos antes do corte expiraram).

const CLAIMS_RS = { userId: 'u1', tenantId: 't1', email: 'a@b.c', tokenVersion: 5 };
const rs = { ok: async () => CLAIMS_RS, fail: async () => { throw new Error('kid desconhecido'); } };

describe('resolverClaims', () => {
  test('token RS256 válido: normaliza os claims', async () => {
    const c = await resolverClaims({ authorizationHeader: 'Bearer abc.def.ghi', verificarRs256: rs.ok });
    assert.equal(c.alg, 'RS256');
    assert.equal(c.userId, 'u1');
    assert.equal(c.tokenVersion, 5);
  });

  test('RS256 falha: null (→ 401 no chamador)', async () => {
    const c = await resolverClaims({ authorizationHeader: 'Bearer lixo', verificarRs256: rs.fail });
    assert.equal(c, null);
  });

  test('sem header: null, nem chama verificarRs256', async () => {
    let chamado = false;
    const c = await resolverClaims({
      authorizationHeader: undefined,
      verificarRs256: async () => { chamado = true; return CLAIMS_RS; },
    });
    assert.equal(chamado, false);
    assert.equal(c, null);
  });

  test('header sem "Bearer ": ainda tenta como token cru', async () => {
    const c = await resolverClaims({ authorizationHeader: 'abc.def.ghi', verificarRs256: rs.ok });
    assert.equal(c.alg, 'RS256');
  });

  test('normaliza só os 4 claims usados pelo painel + alg', async () => {
    const c = await resolverClaims({
      authorizationHeader: 'Bearer x',
      verificarRs256: async () => ({ ...CLAIMS_RS, iss: 'https://auth.kyvvo.com.br', exp: 123, extra: 'ignora' }),
    });
    assert.deepEqual(Object.keys(c).sort(), ['alg', 'email', 'tenantId', 'tokenVersion', 'userId']);
  });
});
