const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderizar, montarParametrosWhatsapp, telefoneParaE164, formatarDataHora,
  dadosDoAgendamento, detectarOptOut, SEEDS,
} = require('../lib/automacoes');
const { dentroDoHorario } = require('../lib/horario-comercial');

describe('renderizar', () => {
  test('substitui {{var}} pelos dados, vazio quando ausente', () => {
    assert.equal(
      renderizar('Oi {{cliente}}, {{servico}} às {{hora}}', { cliente: 'Ana', servico: 'Corte' }),
      'Oi Ana, Corte às '
    );
  });
  test('texto nulo passa direto', () => {
    assert.equal(renderizar(null, {}), null);
  });
});

describe('telefoneParaE164', () => {
  test('já com DDI 55 (13 díg) -> +55...', () => {
    assert.equal(telefoneParaE164('5511987654321'), '+5511987654321');
  });
  test('fixo com DDI (12 díg) -> +55...', () => {
    assert.equal(telefoneParaE164('551132654321'), '+551132654321');
  });
  test('sem DDI (11 díg) recebe o +55', () => {
    assert.equal(telefoneParaE164('11987654321'), '+5511987654321');
  });
  test('curto/longo demais -> null', () => {
    assert.equal(telefoneParaE164('987654321'), null);
    assert.equal(telefoneParaE164('55119876543219999'), null);
    assert.equal(telefoneParaE164(''), null);
    assert.equal(telefoneParaE164(null), null);
  });
});

describe('formatarDataHora', () => {
  test('formata pro fuso de Brasília (dd/mm/aaaa + HH:MM)', () => {
    // 2026-03-15T13:30:00Z = 10:30 em Brasília (UTC-3)
    const { data, hora } = formatarDataHora('2026-03-15T13:30:00Z');
    assert.equal(data, '15/03/2026');
    assert.equal(hora, '10:30');
  });
});

describe('dadosDoAgendamento', () => {
  test('monta as variáveis a partir da linha detalhada + nome do salão', () => {
    const d = dadosDoAgendamento(
      { cliente: 'Ana', servico: 'Corte', profissional: 'Bia', data_hora: '2026-03-15T13:30:00Z' },
      'Salão X'
    );
    assert.deepEqual(d, {
      cliente: 'Ana', servico: 'Corte', profissional: 'Bia',
      data: '15/03/2026', hora: '10:30', salao: 'Salão X',
    });
  });
});

describe('montarParametrosWhatsapp', () => {
  test('template com parâmetro nomeado usa os nomes que a Meta devolveu', () => {
    const dados = { cliente: 'Ana', servico: 'Corte', profissional: 'Bia', data: '15/03', hora: '10:30' };
    const info = { parametros_nomeados: true, parametros_corpo: ['cliente', 'servico', 'hora'] };
    const { parametrosCorpo, parametroBotao } = montarParametrosWhatsapp('agendamento_criado', dados, info);
    assert.deepEqual(parametrosCorpo, [
      { nome: 'cliente', nomeado: true, valor: 'Ana' },
      { nome: 'servico', nomeado: true, valor: 'Corte' },
      { nome: 'hora', nomeado: true, valor: '10:30' },
    ]);
    assert.equal(parametroBotao, null);
  });
  test('sem templateInfo cai no fallback posicional do gatilho', () => {
    const dados = { cliente: 'Ana', servico: 'Corte', profissional: 'Bia', data: '15/03', hora: '10:30' };
    const { parametrosCorpo } = montarParametrosWhatsapp('agendamento_criado', dados, undefined);
    assert.deepEqual(parametrosCorpo.map((p) => p.valor), ['Ana', 'Corte', 'Bia', '15/03', '10:30']);
    assert.equal(parametrosCorpo[0].nomeado, false);
  });
});

describe('detectarOptOut', () => {
  test('match exato (sem acento, minúscula) das palavras de opt-out', () => {
    for (const t of ['PARAR', ' Sair ', 'cancelar', 'STOP', 'Descadastrar']) {
      assert.equal(detectarOptOut(t), true, t);
    }
  });
  test('frase que só contém a palavra não conta', () => {
    assert.equal(detectarOptOut('vou parar de vir aqui'), false);
    assert.equal(detectarOptOut('quero cancelar meu horário de amanhã'), false);
    assert.equal(detectarOptOut(''), false);
    assert.equal(detectarOptOut(null), false);
  });
});

describe('SEEDS', () => {
  test('um seed por gatilho, cobre exatamente os 4 gatilhos', () => {
    const gatilhos = SEEDS.map((s) => s.gatilho);
    assert.equal(new Set(gatilhos).size, gatilhos.length);
    assert.deepEqual(
      [...gatilhos].sort(),
      ['agendamento_concluido', 'agendamento_criado', 'aniversario_cliente', 'cliente_inativo']
    );
  });
  test('só agendamento_criado nasce ativo', () => {
    for (const s of SEEDS) {
      assert.equal(s.ativo !== false, s.gatilho === 'agendamento_criado', s.gatilho);
    }
  });
});

describe('dentroDoHorario (copiado do People)', () => {
  const config = { inicio: '09:00', fim: '18:00', dias_uteis: [1, 2, 3, 4, 5] };
  test('quarta 10:30 Brasília -> dentro', () => {
    assert.equal(dentroDoHorario(new Date('2026-03-18T13:30:00Z'), config), true);
  });
  test('quarta 20:00 Brasília -> fora', () => {
    assert.equal(dentroDoHorario(new Date('2026-03-18T23:00:00Z'), config), false);
  });
  test('domingo -> fora (não é dia útil)', () => {
    assert.equal(dentroDoHorario(new Date('2026-03-15T13:30:00Z'), config), false);
  });
  test('sem config (admin nunca respondeu) -> sempre dentro', () => {
    assert.equal(dentroDoHorario(new Date('2026-03-15T23:00:00Z'), null), true);
  });
});
