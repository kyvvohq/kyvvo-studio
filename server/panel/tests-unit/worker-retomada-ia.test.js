const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { processarRetomadasIA, buscarCandidatosRetomada } = require('../lib/worker-retomada-ia');

// Worker de retomada proativa da IA (pedido do Bruno 2026-10-21): quando o
// cliente para de responder depois de uma pergunta do bot, manda um nudge —
// até N tentativas, espaçadas de H horas, só dentro do horário de
// funcionamento, nunca além da janela de encerramento. A query
// (buscarCandidatosRetomada) já faz a maior parte do filtro no SQL — o que
// sobra pra testar em JS é só o gate de horário de funcionamento e o
// registro do envio/incremento.

// Tenant aberto todo dia, 08h-20h, sem almoço/feriado — mesmo tenant-fixture
// de tests-unit/ia-engine.test.js, só pra não travar no horário.
const TENANT_ABERTO = {
  dias_funcionamento: [0, 1, 2, 3, 4, 5, 6],
  horario_abertura: '08:00:00',
  horario_fechamento: '20:00:00',
  horario_almoco_ativo: false,
  feriados_bloqueados: false,
};
const TENANT_FECHADO = { ...TENANT_ABERTO, dias_funcionamento: [] };

function candidato(overrides = {}) {
  return {
    cliente_id: 'cliente-1', tenant_id: 'tenant-1', telefone: '+5534999998888', meta_phone_number_id: 'phone-1',
    ...TENANT_ABERTO,
    ...overrides,
  };
}

function fakePool(linhas = []) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (/^SELECT c\.id AS cliente_id/.test(sql)) return { rows: linhas };
      return { rows: [] };
    },
  };
}

describe('processarRetomadasIA', () => {
  test('manda o nudge, grava em conversas_ia e incrementa a tentativa quando tudo bate', async () => {
    const pool = fakePool([candidato()]);
    const enviados = [];
    const enviarTexto = async (phoneNumberId, telefone, texto) => { enviados.push({ phoneNumberId, telefone, texto }); };

    const { enviados: total } = await processarRetomadasIA(pool, { enviarTexto });

    assert.equal(total, 1);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].phoneNumberId, 'phone-1');
    assert.equal(enviados[0].telefone, '+5534999998888');

    const inserts = pool.chamadas.filter((c) => /INSERT INTO conversas_ia/.test(c.sql));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params.slice(0, 2), ['tenant-1', 'cliente-1']);

    const updates = pool.chamadas.filter((c) => /UPDATE clientes SET ia_retomada_tentativas = ia_retomada_tentativas \+ 1/.test(c.sql));
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].params, ['cliente-1']);
  });

  test('fora do horário de funcionamento do salão: não manda nada', async () => {
    const pool = fakePool([candidato(TENANT_FECHADO)]);
    const enviados = [];
    const { enviados: total } = await processarRetomadasIA(pool, { enviarTexto: async () => { enviados.push(1); } });
    assert.equal(total, 0);
    assert.equal(enviados.length, 0);
  });

  test('sem candidatos (query já filtra ativa/tentativas/janela/último turno/handoff): não manda nada', async () => {
    const pool = fakePool([]);
    const enviados = [];
    const { enviados: total } = await processarRetomadasIA(pool, { enviarTexto: async () => { enviados.push(1); } });
    assert.equal(total, 0);
    assert.equal(enviados.length, 0);
  });

  test('falha ao enviar pra um candidato não impede os demais', async () => {
    const pool = fakePool([candidato({ cliente_id: 'cliente-1' }), candidato({ cliente_id: 'cliente-2' })]);
    let chamada = 0;
    const enviarTexto = async () => {
      chamada += 1;
      if (chamada === 1) throw new Error('timeout da Meta');
    };
    const erros = [];
    const { enviados: total } = await processarRetomadasIA(pool, { enviarTexto, log: { error: (obj) => erros.push(obj) } });
    assert.equal(total, 1, 'o segundo candidato deveria ter sido enviado mesmo com o primeiro falhando');
    assert.equal(erros.length, 1);
  });
});

describe('buscarCandidatosRetomada (query)', () => {
  test('filtra por ia_retomada_ativa, tecnologia=ia, não-excluído, não-handoff e último turno do bot', async () => {
    let sqlCapturada = null;
    const pool = {
      query: async (sql) => {
        sqlCapturada = sql;
        return { rows: [] };
      },
    };
    await buscarCandidatosRetomada(pool);
    assert.match(sqlCapturada, /ia_retomada_ativa = true/);
    assert.match(sqlCapturada, /tecnologia = 'ia'/);
    assert.match(sqlCapturada, /excluido_em IS NULL/);
    assert.match(sqlCapturada, /status_conversa <> 'aguardando_humano'/);
    assert.match(sqlCapturada, /ultima\.role = 'assistant'/);
    assert.match(sqlCapturada, /ia_retomada_tentativas < t\.ia_retomada_tentativas/);
  });
});
