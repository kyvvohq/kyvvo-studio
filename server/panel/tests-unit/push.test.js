const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { enviarPush } = require('../lib/push');

// Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no ambiente (nem em dev/teste, nem
// no CI) enviarPush cai no modo log — mesmo espírito de lib/email.js e
// token-service.js sem as envs externas. O caminho real de envio (com
// webpush.sendNotification de verdade) só é exercitado em produção, com as
// chaves vindas do SSM (/kyvvo/studio/).
describe('enviarPush (sem VAPID configurado — modo dev/log)', () => {
  test('não consulta push_subscriptions nem lança', async () => {
    const chamadas = [];
    const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
    await assert.doesNotReject(enviarPush(pool, 't1', { titulo: 'Novo agendamento', corpo: 'Corte às 10h' }));
    assert.deepEqual(chamadas, []);
  });
});
