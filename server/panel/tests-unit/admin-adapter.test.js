const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { tokenConfere } = require('../routes/admin-adapter');

const ORIGINAL = process.env.ADMIN_ADAPTER_TOKEN;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_ADAPTER_TOKEN;
  else process.env.ADMIN_ADAPTER_TOKEN = ORIGINAL;
});

describe('tokenConfere', () => {
  test('sem ADMIN_ADAPTER_TOKEN no ambiente: nega tudo', () => {
    delete process.env.ADMIN_ADAPTER_TOKEN;
    assert.equal(tokenConfere('Bearer qualquer'), false);
  });

  test('token certo, com e sem prefixo Bearer', () => {
    process.env.ADMIN_ADAPTER_TOKEN = 's3gr3d0-l0ng0-o-suficiente';
    assert.equal(tokenConfere('Bearer s3gr3d0-l0ng0-o-suficiente'), true);
    assert.equal(tokenConfere('s3gr3d0-l0ng0-o-suficiente'), true);
  });

  test('token errado ou vazio: nega', () => {
    process.env.ADMIN_ADAPTER_TOKEN = 's3gr3d0-l0ng0-o-suficiente';
    assert.equal(tokenConfere('Bearer outro'), false);
    assert.equal(tokenConfere('Bearer '), false);
    assert.equal(tokenConfere(''), false);
    assert.equal(tokenConfere(undefined), false);
  });
});
