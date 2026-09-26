const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const horarioFuncionamento = require('../lib/horario-funcionamento');

// `executarAcaoIA` (lib/ia-engine.js) não é exportada — de propósito, é
// chamada só por processarMensagemIA dentro do próprio motor. Mesma técnica
// de agenda-recorrencia.test.js: recompila o arquivo real num Module isolado
// e reexporta a função depois do module.exports original, sem tocar
// ia-engine.js só para viabilizar o teste.
function carregarFuncaoPrivada(caminhoRelativo, nomeFuncao) {
  const caminhoAbsoluto = path.join(__dirname, caminhoRelativo);
  const codigoOriginal = fs.readFileSync(caminhoAbsoluto, 'utf8');
  const codigoInstrumentado = `${codigoOriginal}\nmodule.exports.${nomeFuncao} = ${nomeFuncao};\n`;
  const mod = new Module(caminhoAbsoluto, module);
  mod.filename = caminhoAbsoluto;
  mod.paths = Module._nodeModulePaths(path.dirname(caminhoAbsoluto));
  mod._compile(codigoInstrumentado, caminhoAbsoluto);
  return mod;
}

const iaEngineMod = carregarFuncaoPrivada('../lib/ia-engine.js', 'executarAcaoIA');
const executarAcaoIA = iaEngineMod.exports.executarAcaoIA;

// Fake pool único, compartilhado entre ia-engine e horario-funcionamento
// (mesmo padrão `init(pool)` dos dois módulos) — casa cada query pelo texto
// SQL, devolve [] pra tudo que não precisa de dado real (bloqueios, conflito
// de agenda) e uma linha canônica pro que o fluxo de agendar precisa ler de
// volta (serviço, profissional, id do agendamento criado).
function fakePool() {
  const chamadas = [];
  const handler = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (/FROM servicos WHERE/.test(sql)) {
        return { rows: [{ id: 'servico-1', nome: 'Micro Pigmentação', preco: 2700, duracao_minutos: 240 }] };
      }
      if (/FROM profissionais WHERE tenant_id = \$1 AND nome ILIKE/.test(sql)) {
        return { rows: [{ id: 'prof-1', nome: 'Fred' }] };
      }
      if (/FROM profissionais WHERE tenant_id = \$1 ORDER BY nome/.test(sql)) {
        return { rows: [{ id: 'prof-1', nome: 'Fred' }] };
      }
      if (/FROM bloqueios_agenda/.test(sql)) {
        return { rows: [] };
      }
      if (/SELECT a\.id\s+FROM agendamentos/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO agendamentos/.test(sql)) {
        return { rows: [{ id: 'agendamento-novo' }] };
      }
      if (/UPDATE clientes SET data_nascimento/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return {
    chamadas,
    query: handler.query,
    connect: async () => ({
      query: handler.query,
      release: () => {},
    }),
  };
}

const fastifyFake = { log: { warn: () => {}, error: () => {} } };

// Tenant aberto todo dia, 08h-20h, sem almoço/feriado — só pra não travar em
// dentroDoHorarioFuncionamento (não é o que este teste quer cobrir).
const tenant = {
  id: 'tenant-1',
  dias_funcionamento: [0, 1, 2, 3, 4, 5, 6],
  horario_abertura: '08:00:00',
  horario_fechamento: '20:00:00',
  horario_almoco_ativo: false,
  feriados_bloqueados: false,
};

describe('executarAcaoIA — informar_nascimento com agendamento pendente (bug real, 2026-09-26)', () => {
  test('cliente informa nascimento E já tinha confirmado o agendamento na mesma mensagem: cria o agendamento', async () => {
    const pool = fakePool();
    horarioFuncionamento.init(pool);
    iaEngineMod.exports.init(pool, fastifyFake);

    const params = {
      servicoNome: 'Micro Pigmentação',
      profissionalNome: 'Fred',
      dataHoraISO: '2026-09-29T10:00:00-03:00',
      dataHoraAlvoISO: null,
      dataNascimento: '1989-07-19',
    };
    const resultado = await executarAcaoIA({ intent: 'informar_nascimento', params, tenant, clienteId: 'cliente-1' });

    assert.equal(resultado.ok, true);
    assert.ok(resultado.agendamentoId, 'deveria devolver o id do agendamento criado');
    const insertsAgendamento = pool.chamadas.filter((c) => /INSERT INTO agendamentos/.test(c.sql));
    assert.equal(insertsAgendamento.length, 1, 'deveria ter inserido exatamente 1 agendamento');
    const updatesNascimento = pool.chamadas.filter((c) => /UPDATE clientes SET data_nascimento/.test(c.sql));
    assert.equal(updatesNascimento.length, 1, 'deveria continuar salvando a data de nascimento também');
  });

  test('cliente só informa nascimento, sem agendamento pendente (dataHoraISO ausente): não cria agendamento', async () => {
    const pool = fakePool();
    horarioFuncionamento.init(pool);
    iaEngineMod.exports.init(pool, fastifyFake);

    const params = {
      servicoNome: null,
      profissionalNome: null,
      dataHoraISO: null,
      dataHoraAlvoISO: null,
      dataNascimento: '1989-07-19',
    };
    const resultado = await executarAcaoIA({ intent: 'informar_nascimento', params, tenant, clienteId: 'cliente-1' });

    assert.deepEqual(resultado, { ok: true });
    const insertsAgendamento = pool.chamadas.filter((c) => /INSERT INTO agendamentos/.test(c.sql));
    assert.equal(insertsAgendamento.length, 0, 'sem agendamento pendente não deveria inserir nada em agendamentos');
    const updatesNascimento = pool.chamadas.filter((c) => /UPDATE clientes SET data_nascimento/.test(c.sql));
    assert.equal(updatesNascimento.length, 1);
  });
});
