const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  TIPOS_NOTIFICACAO, canaisAtivos, listarNotificacoesPendentes, dispararNotificacaoEvento,
  marcarNotificacaoLida, marcarTodasNotificacoesLidas, listarHistoricoNotificacoes,
} = require('../lib/notificacoes');
const planosCatalogo = require('../lib/planos');

// fakePool devolve `rows` fixo pra query de clientes (whatsapp_aguardando_
// humano) — os 3 tipos eventoUnico novos (agenda_criada/confirmada/
// remarcada) sempre consultam notificacoes_eventos também, então essa fake
// pool precisa responder [] pra essa tabela, senão os `rows` de clientes
// vazariam pros itens desses outros tipos (SQL-aware de propósito).
function fakePool(clientesRows = []) {
  return {
    query: async (sql) => {
      if (/FROM notificacoes_eventos/.test(sql)) return { rows: [] };
      return { rows: clientesRows };
    },
  };
}

// disparos_acabando precisa de 2 respostas diferentes (plano do tenant +
// contagem de disparos do mês) — casa pelo texto do SQL, mesmo padrão usado
// em outros testes-unit deste repo (ex.: agenda-recorrencia.test.js).
// `listarNotificacoesPendentes` roda TODOS os tipos registrados, então
// mesmo testando só disparos_acabando essa fake pool também precisa
// responder à query do whatsapp_aguardando_humano e à de notificacoes_eventos
// (vazias = sem interferir).
function fakePoolDisparos({ plano, usados }) {
  return {
    query: async (sql) => {
      if (/FROM tenants/.test(sql)) return { rows: [{ plano }] };
      if (/FROM whatsapp_disparos/.test(sql)) return { rows: [{ total: usados }] };
      if (/FROM clientes/.test(sql)) return { rows: [] };
      if (/FROM notificacoes_eventos/.test(sql)) return { rows: [] };
      throw new Error(`query inesperada no teste: ${sql}`);
    },
  };
}

describe('TIPOS_NOTIFICACAO', () => {
  test('whatsapp_aguardando_humano está registrado', () => {
    assert.ok(TIPOS_NOTIFICACAO.some((t) => t.chave === 'whatsapp_aguardando_humano'));
  });
  test('disparos_acabando está registrado com campoNumerico', () => {
    const tipo = TIPOS_NOTIFICACAO.find((t) => t.chave === 'disparos_acabando');
    assert.ok(tipo);
    assert.equal(tipo.campoNumerico.chave, 'limiar');
    assert.equal(tipo.campoNumerico.padrao, 10);
  });
});

describe('listarNotificacoesPendentes — whatsapp_aguardando_humano', () => {
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

  test('{ativo:false} desliga o tipo, mesmo com itens pendentes', async () => {
    const pool = fakePool([{ id: 'c1', nome: 'Bruno', telefone: '5534999999999', aguardando_humano_desde: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', { whatsapp_aguardando_humano: { ativo: false } });
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

describe('listarNotificacoesPendentes — disparos_acabando', () => {
  test('plano sem limite (limite_disparos null) nunca notifica', async () => {
    const pool = fakePoolDisparos({ plano: null, usados: 999 });
    // sem plano/limite: obterPlano('sem-plano-nenhum') → undefined, cobre o
    // mesmo caminho de "plano null/desconhecido" do código de produção
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(r, []);
  });

  test('restante acima do limiar padrão (10): não notifica', async () => {
    // monta o catálogo com um plano de limite 100, 50 usados -> restam 50
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 50 });
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(r, []);
  });

  test('restante <= limiar padrão (10): notifica com a contagem certa', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 93 }); // restam 7
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, 'disparos_acabando');
    assert.match(r[0].itens[0].titulo, /Restam 7 disparo/);
  });

  test('limiar customizado (config.limiar) é respeitado', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 70 }); // restam 30
    const semNotificar = await listarNotificacoesPendentes(pool, 't1', {});
    assert.deepEqual(semNotificar, []); // 30 > 10 (padrão)

    const comLimiarAlto = await listarNotificacoesPendentes(pool, 't1', { disparos_acabando: { ativo: true, limiar: 40 } });
    assert.equal(comLimiarAlto.length, 1); // 30 <= 40
  });

  test('{ativo:false} desliga mesmo com pouco restante', async () => {
    planosCatalogo.init({ query: async () => ({ rows: [{ chave: 'pro', limite_disparos: 100 }] }) });
    await planosCatalogo.carregar();
    const pool = fakePoolDisparos({ plano: 'pro', usados: 99 });
    const r = await listarNotificacoesPendentes(pool, 't1', { disparos_acabando: { ativo: false } });
    assert.deepEqual(r, []);
  });
});

describe('canaisAtivos', () => {
  test('formato novo ({canais}) respeita cada canal individualmente', () => {
    assert.deepEqual(canaisAtivos({ canais: { studio: true, email: true, whatsapp: false } }), { studio: true, email: true, whatsapp: false });
  });
  test('formato antigo ({ativo}) vira só Studio (nunca e-mail/WhatsApp)', () => {
    assert.deepEqual(canaisAtivos({ ativo: true }), { studio: true, email: false, whatsapp: false });
    assert.deepEqual(canaisAtivos({ ativo: false }), { studio: false, email: false, whatsapp: false });
  });
  test('config ausente/vazia conta como Studio ativo por padrão', () => {
    assert.deepEqual(canaisAtivos(undefined), { studio: true, email: false, whatsapp: false });
    assert.deepEqual(canaisAtivos({}), { studio: true, email: false, whatsapp: false });
  });
});

describe('TIPOS_NOTIFICACAO — tipos orientados a evento', () => {
  test('agenda_criada/agenda_confirmada/agenda_remarcada estão registrados como eventoUnico', () => {
    for (const chave of ['agenda_criada', 'agenda_confirmada', 'agenda_remarcada']) {
      const tipo = TIPOS_NOTIFICACAO.find((t) => t.chave === chave);
      assert.ok(tipo, `${chave} não registrado`);
      assert.equal(tipo.eventoUnico, true);
    }
  });
});

describe('listarNotificacoesPendentes — tipos orientados a evento', () => {
  function fakePoolEventos(eventosRows) {
    return {
      query: async (sql) => {
        if (/FROM notificacoes_eventos/.test(sql)) return { rows: eventosRows };
        return { rows: [] };
      },
    };
  }

  test('evento recente aparece no resultado', async () => {
    const pool = fakePoolEventos([{ id: 'e1', titulo: 'Corte às 10h', detalhe: 'Bruna', criado_em: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    const item = r.find((x) => x.tipo === 'agenda_criada');
    assert.ok(item);
    assert.equal(item.itens[0].titulo, 'Corte às 10h');
    assert.equal(item.eventoUnico, true);
  });

  test('sem eventos recentes, o tipo não aparece', async () => {
    const pool = fakePoolEventos([]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    assert.ok(!r.some((x) => x.tipo === 'agenda_criada'));
  });

  test('canal Studio desligado some mesmo com eventos recentes', async () => {
    const pool = fakePoolEventos([{ id: 'e1', titulo: 'Corte às 10h', detalhe: null, criado_em: new Date() }]);
    const r = await listarNotificacoesPendentes(pool, 't1', { agenda_criada: { canais: { studio: false } } });
    assert.ok(!r.some((x) => x.tipo === 'agenda_criada'));
  });

  test('só busca eventos NÃO lidos (lida = false na query)', async () => {
    let sqlCapturado = null;
    const pool = {
      query: async (sql) => {
        if (/FROM notificacoes_eventos/.test(sql)) { sqlCapturado = sql; return { rows: [] }; }
        return { rows: [] };
      },
    };
    await listarNotificacoesPendentes(pool, 't1', {});
    assert.match(sqlCapturado, /lida = false/);
  });

  test('referencia_data_hora vem no item como dataAgendamento', async () => {
    const dataHora = new Date('2026-08-10T13:00:00.000Z');
    const pool = fakePoolEventos([{ id: 'e1', titulo: 'Corte às 10h', detalhe: 'Bruna', criado_em: new Date(), referencia_data_hora: dataHora }]);
    const r = await listarNotificacoesPendentes(pool, 't1', {});
    const item = r.find((x) => x.tipo === 'agenda_criada');
    assert.equal(item.itens[0].dataAgendamento, dataHora);
  });
});

describe('marcarNotificacaoLida', () => {
  test('UPDATE escopado por tenant_id e lida=false, devolve true quando acha a linha', async () => {
    const chamadas = [];
    const pool = {
      query: async (sql, params) => {
        chamadas.push({ sql, params });
        return { rows: [{ id: 'e1' }] };
      },
    };
    const ok = await marcarNotificacaoLida(pool, 't1', 'e1');
    assert.equal(ok, true);
    assert.match(chamadas[0].sql, /UPDATE notificacoes_eventos SET lida = true/);
    assert.match(chamadas[0].sql, /tenant_id = \$2/);
    assert.deepEqual(chamadas[0].params, ['e1', 't1']);
  });

  test('id inexistente/de outro tenant/já lida: devolve false', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    const ok = await marcarNotificacaoLida(pool, 't1', 'e-que-nao-existe');
    assert.equal(ok, false);
  });
});

describe('marcarTodasNotificacoesLidas', () => {
  test('devolve o número de linhas afetadas', async () => {
    const pool = { query: async () => ({ rowCount: 3 }) };
    const marcadas = await marcarTodasNotificacoesLidas(pool, 't1');
    assert.equal(marcadas, 3);
  });
});

describe('listarHistoricoNotificacoes', () => {
  test('mapeia as colunas do banco pro formato da API, com o título do tipo resolvido', async () => {
    const pool = {
      query: async () => ({
        rows: [{
          id: 'e1', chave: 'agenda_criada', titulo: 'Novo agendamento: Corte', detalhe: 'Bruna — 10/08 10:00',
          criado_em: new Date('2026-08-10T10:00:00Z'), lida: true, lida_em: new Date('2026-08-10T11:00:00Z'),
          referencia_data_hora: new Date('2026-08-10T13:00:00Z'),
        }],
      }),
    };
    const [item] = await listarHistoricoNotificacoes(pool, 't1');
    assert.equal(item.tipo, 'agenda_criada');
    assert.equal(item.tipoTitulo, 'Novo agendamento criado');
    assert.equal(item.lida, true);
    assert.ok(item.dataAgendamento);
  });

  test('chave sem tipo correspondente (nunca deveria acontecer) usa a própria chave como título', async () => {
    const pool = { query: async () => ({ rows: [{ id: 'e1', chave: 'tipo_removido', titulo: 't', detalhe: null, criado_em: new Date(), lida: false, lida_em: null, referencia_data_hora: null }] }) };
    const [item] = await listarHistoricoNotificacoes(pool, 't1');
    assert.equal(item.tipoTitulo, 'tipo_removido');
  });
});

describe('dispararNotificacaoEvento', () => {
  function fakePoolTenant({ notificacoesAtivas, whatsapp = null }) {
    const chamadas = [];
    return {
      chamadas,
      query: async (sql, params) => {
        chamadas.push({ sql, params });
        if (/SELECT notificacoes_ativas, whatsapp FROM tenants/.test(sql)) {
          return { rows: [{ notificacoes_ativas: notificacoesAtivas, whatsapp }] };
        }
        if (/INSERT INTO notificacoes_eventos/.test(sql)) return { rows: [] };
        if (/FROM usuarios WHERE tenant_id/.test(sql)) return { rows: [{ email: 'dono@salao.com' }] };
        return { rows: [] };
      },
    };
  }

  test('canal Studio ativo grava em notificacoes_eventos', async () => {
    const pool = fakePoolTenant({ notificacoesAtivas: { agenda_criada: { canais: { studio: true } } } });
    await dispararNotificacaoEvento(pool, 't1', 'agenda_criada', { titulo: 'Novo agendamento', detalhe: 'Corte às 10h' });
    assert.ok(pool.chamadas.some((c) => /INSERT INTO notificacoes_eventos/.test(c.sql)));
  });

  test('canal Studio desligado não grava nada', async () => {
    const pool = fakePoolTenant({ notificacoesAtivas: { agenda_criada: { canais: { studio: false } } } });
    await dispararNotificacaoEvento(pool, 't1', 'agenda_criada', { titulo: 'Novo agendamento' });
    assert.ok(!pool.chamadas.some((c) => /INSERT INTO notificacoes_eventos/.test(c.sql)));
  });

  test('tenant inexistente não lança erro (best-effort)', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    await assert.doesNotReject(dispararNotificacaoEvento(pool, 'tenant-fantasma', 'agenda_criada', { titulo: 'x' }));
  });

  test('config ausente pro tipo usa o default (Studio ativo)', async () => {
    const pool = fakePoolTenant({ notificacoesAtivas: {} });
    await dispararNotificacaoEvento(pool, 't1', 'agenda_criada', { titulo: 'Novo agendamento' });
    assert.ok(pool.chamadas.some((c) => /INSERT INTO notificacoes_eventos/.test(c.sql)));
  });

  test('referenciaDataHora vai pro INSERT; ausente vira null (não undefined)', async () => {
    const poolCom = fakePoolTenant({ notificacoesAtivas: { agenda_criada: { canais: { studio: true } } } });
    const dataHora = '2026-08-10T13:00:00.000Z';
    await dispararNotificacaoEvento(poolCom, 't1', 'agenda_criada', { titulo: 'x', referenciaDataHora: dataHora });
    const insertCom = poolCom.chamadas.find((c) => /INSERT INTO notificacoes_eventos/.test(c.sql));
    assert.equal(insertCom.params[4], dataHora);

    const poolSem = fakePoolTenant({ notificacoesAtivas: { agenda_criada: { canais: { studio: true } } } });
    await dispararNotificacaoEvento(poolSem, 't1', 'agenda_criada', { titulo: 'x' });
    const insertSem = poolSem.chamadas.find((c) => /INSERT INTO notificacoes_eventos/.test(c.sql));
    assert.equal(insertSem.params[4], null);
  });
});
