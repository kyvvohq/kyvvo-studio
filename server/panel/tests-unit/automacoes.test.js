const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderizar, montarParametrosWhatsapp, telefoneParaE164, formatarDataHora,
  dadosDoAgendamento, detectarOptOut, SEEDS, registrarDisparo, limiteDoPlanoExcedido,
  renderizarCorpoTemplate, confirmarAgendamentoPorBotao,
} = require('../lib/automacoes');
const { dentroDoHorario } = require('../lib/horario-comercial');
const planosCatalogo = require('../lib/planos');

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

describe('renderizarCorpoTemplate (texto final pra tela de Disparos)', () => {
  test('nomeado: substitui {{nome_do_parametro}} pelo valor', () => {
    assert.equal(
      renderizarCorpoTemplate('Oi {{nome_cliente}}! Bem-vindo(a) à {{nome_salao}}.', [
        { nome: 'nome_cliente', valor: 'Ana', nomeado: true },
        { nome: 'nome_salao', valor: 'Salão X', nomeado: true },
      ]),
      'Oi Ana! Bem-vindo(a) à Salão X.'
    );
  });
  test('posicional: substitui {{1}}, {{2}}... na ordem do array', () => {
    assert.equal(
      renderizarCorpoTemplate('Oi {{1}}, seu horário é {{2}}.', [
        { valor: 'Bia', nomeado: false },
        { valor: '14h', nomeado: false },
      ]),
      'Oi Bia, seu horário é 14h.'
    );
  });
  test('sem parâmetros: devolve o corpo como veio', () => {
    assert.equal(renderizarCorpoTemplate('hello_world', []), 'hello_world');
  });
  test('corpo vazio/nulo: devolve string vazia', () => {
    assert.equal(renderizarCorpoTemplate(null, [{ nome: 'x', valor: '1', nomeado: true }]), '');
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

describe('registrarDisparo (histórico pro admin — US WhatsApp > Disparos)', () => {
  test('grava tenant/telefone/template/gatilho/status em whatsapp_disparos', async () => {
    const chamadas = [];
    const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
    await registrarDisparo(pool, { tenantId: 't1', telefoneE164: '+5534999998888', templateNome: 'lembrete_agendamento', gatilho: 'agendamento_criado', status: 'enviado' });
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0].sql, /insert into whatsapp_disparos/);
    const [, tenantId, telefone, template, gatilho, status] = chamadas[0].params;
    assert.equal(tenantId, 't1');
    assert.equal(telefone, '+5534999998888');
    assert.equal(template, 'lembrete_agendamento');
    assert.equal(gatilho, 'agendamento_criado');
    assert.equal(status, 'enviado');
  });

  test('template/gatilho ausentes viram null em vez de undefined (constraint do banco não aceita undefined)', async () => {
    const chamadas = [];
    const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
    await registrarDisparo(pool, { tenantId: 't1', telefoneE164: '+5534999998888', status: 'bloqueado_optout' });
    const [, , , template, gatilho] = chamadas[0].params;
    assert.equal(template, null);
    assert.equal(gatilho, null);
  });

  test('mensagemTexto é gravado; ausente vira null (não undefined)', async () => {
    const chamadas = [];
    const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
    await registrarDisparo(pool, { tenantId: 't1', telefoneE164: '+5534999998888', status: 'enviado', mensagemTexto: 'Oi Ana!' });
    await registrarDisparo(pool, { tenantId: 't1', telefoneE164: '+5534999998888', status: 'enviado' });
    assert.equal(chamadas[0].params[6], 'Oi Ana!');
    assert.equal(chamadas[1].params[6], null);
  });
});

describe('confirmarAgendamentoPorBotao (botão "Confirmar" — a_confirmar -> confirmado)', () => {
  function fakePool({ candidato = null } = {}) {
    const chamadas = [];
    return {
      chamadas,
      query: async (sql, params) => {
        chamadas.push({ sql, params });
        if (/SELECT a\.id, a\.data_hora, s\.nome AS servico/.test(sql)) return { rows: candidato ? [candidato] : [] };
        if (/UPDATE agendamentos SET status = 'confirmado'/.test(sql)) return { rows: [] };
        if (/INSERT INTO lancamentos_financeiros/.test(sql)) return { rows: [] };
        if (/SELECT notificacoes_ativas, whatsapp FROM tenants/.test(sql)) return { rows: [] }; // tenant "não encontrado" — dispararNotificacaoEvento só retorna cedo, best-effort
        throw new Error(`query inesperada no teste: ${sql}`);
      },
    };
  }

  const CANDIDATO = {
    id: 'ag1', data_hora: '2026-08-10T13:00:00.000Z', servico: 'Corte', servico_preco: '50.00',
    profissional: 'Bia', cliente: 'Ana Souza', cliente_telefone: '5534999990001',
  };

  test('sem nenhum atendimento a_confirmar pro telefone: devolve null, não faz UPDATE', async () => {
    const pool = fakePool({ candidato: null });
    const resultado = await confirmarAgendamentoPorBotao(pool, { tenantId: 't1', telefone: '5534999990001' });
    assert.equal(resultado, null);
    assert.equal(pool.chamadas.length, 1); // só o SELECT, nada mais
  });

  test('acha o atendimento a_confirmar mais próximo: atualiza status e devolve os dados dele', async () => {
    const pool = fakePool({ candidato: CANDIDATO });
    const resultado = await confirmarAgendamentoPorBotao(pool, { tenantId: 't1', telefone: '5534999990001' });
    assert.equal(resultado.id, 'ag1');
    assert.equal(resultado.servico, 'Corte');

    const update = pool.chamadas.find((c) => /UPDATE agendamentos/.test(c.sql));
    assert.ok(update, 'devia ter atualizado o agendamento');
    assert.deepEqual(update.params, ['ag1']);

    const insertFinanceiro = pool.chamadas.find((c) => /INSERT INTO lancamentos_financeiros/.test(c.sql));
    assert.ok(insertFinanceiro, 'devia ter sincronizado o lançamento financeiro (previsto continua previsto)');
  });

  test('SELECT filtra por status = a_confirmar, telefone e só atendimentos futuros', async () => {
    const pool = fakePool({ candidato: CANDIDATO });
    await confirmarAgendamentoPorBotao(pool, { tenantId: 't1', telefone: '5534999990001' });
    const select = pool.chamadas[0];
    assert.match(select.sql, /status = 'a_confirmar'/);
    assert.match(select.sql, /a\.data_hora > now\(\)/);
    assert.deepEqual(select.params, ['t1', '5534999990001']);
  });
});

describe('limiteDoPlanoExcedido (trava de limite do plano — US WhatsApp > Disparos)', () => {
  test('sem planoChave (trial/sem plano escolhido): nunca trava', async () => {
    const pool = { query: async () => { throw new Error('não deveria consultar o banco'); } };
    assert.equal(await limiteDoPlanoExcedido(pool, 't1', null), false);
  });

  test('plano sem limite_disparos definido (null): nunca trava', async () => {
    planosCatalogo.obterPlano = () => ({ chave: 'starter', limite_disparos: null });
    const pool = { query: async () => { throw new Error('não deveria consultar o banco'); } };
    assert.equal(await limiteDoPlanoExcedido(pool, 't1', 'starter'), false);
  });

  test('plano com limite: abaixo do limite não trava', async () => {
    planosCatalogo.obterPlano = () => ({ chave: 'starter', limite_disparos: 100 });
    const pool = { query: async () => ({ rows: [{ total: 99 }] }) };
    assert.equal(await limiteDoPlanoExcedido(pool, 't1', 'starter'), false);
  });

  test('plano com limite: no limite exato já trava (>=, não >)', async () => {
    planosCatalogo.obterPlano = () => ({ chave: 'starter', limite_disparos: 100 });
    const pool = { query: async () => ({ rows: [{ total: 100 }] }) };
    assert.equal(await limiteDoPlanoExcedido(pool, 't1', 'starter'), true);
  });

  test('só conta status=enviado do mês corrente — a query em si é responsável por isso, aqui só confirma que a contagem retornada decide o resultado', async () => {
    planosCatalogo.obterPlano = () => ({ chave: 'starter', limite_disparos: 10 });
    const pool = { query: async (sql) => { assert.match(sql, /status = 'enviado'/); assert.match(sql, /date_trunc\('month', now\(\)\)/); return { rows: [{ total: 11 }] }; } };
    assert.equal(await limiteDoPlanoExcedido(pool, 't1', 'starter'), true);
  });
});
