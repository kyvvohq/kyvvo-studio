const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// `proximaOcorrenciaRecorrencia` (routes/agenda.js) é a função pura que
// calcula a data de cada ocorrência seguinte de um agendamento recorrente
// (semanal/quinzenal/mensal) a partir da âncora — a única lógica de
// recorrência do repo (não existe cálculo de ciclo/recorrência de assinatura
// fora do pacote @kyvvohq/asaas). Ela não é exportada por routes/agenda.js —
// de propósito, o resto do bloco de recorrência do POST compartilha estado
// com o handler (ver comentário no topo do arquivo) e não vale a pena
// exportar só essa função pro handler ganhar uma dependência circular de
// teste. Em vez de alterar código de produção só para testar, carregamos o
// arquivo real (mesmo conteúdo do disco) num Module isolado e reexportamos a
// função depois do `module.exports` original, sem tocar routes/agenda.js.
function carregarFuncaoPrivada(caminhoRelativo, nomeFuncao) {
  const caminhoAbsoluto = path.join(__dirname, caminhoRelativo);
  const codigoOriginal = fs.readFileSync(caminhoAbsoluto, 'utf8');
  const codigoInstrumentado = `${codigoOriginal}\nmodule.exports.${nomeFuncao} = ${nomeFuncao};\n`;
  const mod = new Module(caminhoAbsoluto, module);
  mod.filename = caminhoAbsoluto;
  mod.paths = Module._nodeModulePaths(path.dirname(caminhoAbsoluto));
  mod._compile(codigoInstrumentado, caminhoAbsoluto);
  return mod.exports[nomeFuncao];
}

const proximaOcorrenciaRecorrencia = carregarFuncaoPrivada('../routes/agenda.js', 'proximaOcorrenciaRecorrencia');

const ancora = (ano, mes, dia) => ({ ano, mes, dia, hora: 12, minuto: 0, segundo: 0 });

describe('proximaOcorrenciaRecorrencia — semanal', () => {
  test('n=1 soma 7 dias corridos', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 5), 'semanal', 1); // 2026-01-05
    assert.deepEqual(r, { ano: 2026, mes: 0, dia: 12, hora: 12, minuto: 0, segundo: 0 });
  });

  test('n=4 soma 28 dias e cruza o mês', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 5), 'semanal', 4); // 2026-01-05 + 28d = 2026-02-02
    assert.equal(r.mes, 1);
    assert.equal(r.dia, 2);
    assert.equal(r.ano, 2026);
  });

  test('cruza o ano (dez -> jan)', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 11, 28), 'semanal', 1); // 2026-12-28 + 7d = 2027-01-04
    assert.deepEqual(r, { ano: 2027, mes: 0, dia: 4, hora: 12, minuto: 0, segundo: 0 });
  });

  test('n=0 é a própria âncora (identidade)', () => {
    const base = ancora(2026, 0, 5);
    assert.deepEqual(proximaOcorrenciaRecorrencia(base, 'semanal', 0), base);
  });
});

describe('proximaOcorrenciaRecorrencia — quinzenal', () => {
  test('n=1 soma 14 dias corridos', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 5), 'quinzenal', 1);
    assert.deepEqual(r, { ano: 2026, mes: 0, dia: 19, hora: 12, minuto: 0, segundo: 0 });
  });

  test('n=2 soma 28 dias (não é "duas semanas de calendário", é 14*n dias corridos)', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 5), 'quinzenal', 2);
    assert.equal(r.mes, 1);
    assert.equal(r.dia, 2);
  });
});

describe('proximaOcorrenciaRecorrencia — mensal', () => {
  test('caso simples: mesmo dia do mês seguinte', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 15), 'mensal', 1);
    assert.deepEqual(r, { ano: 2026, mes: 1, dia: 15, hora: 12, minuto: 0, segundo: 0 });
  });

  test('ano vira ao passar de dezembro', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 11, 10), 'mensal', 1);
    assert.deepEqual(r, { ano: 2027, mes: 0, dia: 10, hora: 12, minuto: 0, segundo: 0 });
  });

  test('âncora dia 31 num mês de 28 dias (2026, não bissexto): clampa pro dia 28', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 31), 'mensal', 1); // jan -> fev
    assert.equal(r.mes, 1);
    assert.equal(r.dia, 28);
  });

  test('âncora dia 31 num mês de 29 dias (2028, bissexto): clampa pro dia 29', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2028, 0, 31), 'mensal', 1); // jan -> fev bissexto
    assert.equal(r.mes, 1);
    assert.equal(r.dia, 29);
  });

  test('não é cumulativo: dia 31 volta a valer no mês seguinte ao clamp (não vaza o 28 pra frente)', () => {
    // Decisão documentada no código: 31/jan -> 28/fev -> volta a tentar 31 em
    // março, em vez de "vazar" o 28 pros meses seguintes.
    const fevereiro = proximaOcorrenciaRecorrencia(ancora(2026, 0, 31), 'mensal', 1);
    const marco = proximaOcorrenciaRecorrencia(ancora(2026, 0, 31), 'mensal', 2);
    assert.equal(fevereiro.dia, 28);
    assert.equal(marco.dia, 31);
  });

  test('âncora dia 31 num mês de 30 dias (abril): clampa pro dia 30', () => {
    const r = proximaOcorrenciaRecorrencia(ancora(2026, 0, 31), 'mensal', 3); // jan -> abr
    assert.equal(r.mes, 3);
    assert.equal(r.dia, 30);
  });

  test('n=0 é a própria âncora (identidade)', () => {
    const base = ancora(2026, 0, 31);
    assert.deepEqual(proximaOcorrenciaRecorrencia(base, 'mensal', 0), base);
  });
});

describe('proximaOcorrenciaRecorrencia — preserva componentes de hora', () => {
  test('hora/minuto/segundo da âncora não mudam em nenhum tipo', () => {
    const base = { ano: 2026, mes: 2, dia: 10, hora: 9, minuto: 30, segundo: 15 };
    assert.equal(proximaOcorrenciaRecorrencia(base, 'semanal', 1).hora, 9);
    assert.equal(proximaOcorrenciaRecorrencia(base, 'quinzenal', 1).minuto, 30);
    assert.equal(proximaOcorrenciaRecorrencia(base, 'mensal', 1).segundo, 15);
  });
});
