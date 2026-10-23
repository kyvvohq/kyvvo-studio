const { test, expect } = require('@playwright/test');

// Cobre o redesenho de Configurações > Notificações: matriz de canais
// (Descrição/E-mail/WhatsApp/Studio/Push), incluindo os 3 tipos novos
// orientados a evento (agenda criada/confirmada/remarcada) e o campo
// numérico de disparos_acabando. As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

async function entrarNaTelaNotificacoes(page, notificacoesAtivas = {}, historico = []) {
  await page.route('**/api/configuracao', (route) => {
    if (route.request().method() === 'PATCH') return route.fallback();
    return route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', notificacoes_ativas: notificacoesAtivas } });
  });
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/notificacoes/historico', (route) => route.fulfill({ json: { historico } }));
  await page.route('**/api/notificacoes/*/lida', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/notificacoes', (route) => route.fulfill({ json: { notificacoes: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#menu-config-toggle');
  await page.click('.menu-item[data-menu="notificacoes"]');
}

test.describe('Configurações > Notificações — matriz de canais', () => {
  test('lista os 5 tipos com as colunas Descrição/E-mail/WhatsApp/Studio/Push', async ({ page }) => {
    await entrarNaTelaNotificacoes(page);
    await expect(page.locator('#painel-notificacoes-regras th')).toHaveText(['Descrição', 'E-mail', 'WhatsApp', 'Studio', 'Push']);
    const linhas = page.locator('tbody tr');
    await expect(linhas).toHaveCount(5);
    await expect(page.locator('tr[data-chave="whatsapp_aguardando_humano"]')).toBeVisible();
    await expect(page.locator('tr[data-chave="disparos_acabando"]')).toBeVisible();
    await expect(page.locator('tr[data-chave="agenda_criada"]')).toContainText('Novo agendamento criado');
    await expect(page.locator('tr[data-chave="agenda_confirmada"]')).toContainText('Agendamento confirmado');
    await expect(page.locator('tr[data-chave="agenda_remarcada"]')).toContainText('Agendamento remarcado');
  });

  test('formato antigo ({ativo: bool}, sem canal) aparece só com Studio ligado', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, { whatsapp_aguardando_humano: { ativo: true } });
    const linha = page.locator('tr[data-chave="whatsapp_aguardando_humano"]');
    await expect(linha.locator('[data-canal="studio"]')).toBeChecked();
    await expect(linha.locator('[data-canal="email"]')).not.toBeChecked();
    await expect(linha.locator('[data-canal="whatsapp"]')).not.toBeChecked();
  });

  test('sem configuração nenhuma, Studio vem ativo por padrão (default seguro)', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {});
    const linha = page.locator('tr[data-chave="agenda_criada"]');
    await expect(linha.locator('[data-canal="studio"]')).toBeChecked();
    await expect(linha.locator('[data-canal="email"]')).not.toBeChecked();
  });

  test('ligar o canal E-mail salva canais completos (studio permanece true)', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {});
    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { notificacoes_ativas: { agenda_criada: { canais: { studio: true, email: true, whatsapp: false } } } } });
    });

    await page.locator('tr[data-chave="agenda_criada"] [data-canal="email"]').check();

    await expect(page.locator('.toast-sucesso')).toHaveText('Salvo com sucesso!');
    expect(corpoEnviado.notificacoesAtivas.agenda_criada.canais).toEqual({ studio: true, email: true, whatsapp: false, push: false });
  });

  test('desligar o canal Studio (única ativação antiga) some com o "ativo" do formato velho', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, { disparos_acabando: { ativo: true, limiar: 10 } });
    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { notificacoes_ativas: {} } });
    });

    await page.locator('tr[data-chave="disparos_acabando"] [data-canal="studio"]').uncheck();

    const cfgEnviado = corpoEnviado.notificacoesAtivas.disparos_acabando;
    expect(cfgEnviado.canais).toEqual({ studio: false, email: false, whatsapp: false, push: false });
    expect(cfgEnviado).not.toHaveProperty('ativo');
    expect(cfgEnviado.limiar).toBe(10); // outros parâmetros (limiar) são preservados
  });

  test('erro ao salvar desfaz o toggle visualmente', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {});
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'Erro ao salvar.' } });
    });

    const chk = page.locator('tr[data-chave="agenda_confirmada"] [data-canal="whatsapp"]');
    await chk.check();

    await expect(page.locator('.toast-erro')).toBeVisible();
    await expect(chk).not.toBeChecked();
  });

  test('campo numérico de disparos_acabando aparece com o rótulo e valor certos', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, { disparos_acabando: { canais: { studio: true }, limiar: 25 } });
    const campo = page.locator('tr[data-chave="disparos_acabando"] .notificacao-numerico');
    await expect(campo).toHaveValue('25');
    await expect(page.locator('tr[data-chave="disparos_acabando"] .notificacao-campo-numerico')).toContainText('Avisar quando restarem apenas');
    await expect(page.locator('tr[data-chave="disparos_acabando"] .notificacao-campo-numerico')).toContainText('disparos WhatsApp');
  });

  test('número inválido (0 ou vazio) mostra erro e não chama a API', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {});
    let chamouPatch = false;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      chamouPatch = true;
      return route.fulfill({ json: {} });
    });

    await page.fill('tr[data-chave="disparos_acabando"] .notificacao-numerico', '0');
    await page.locator('tr[data-chave="disparos_acabando"] .notificacao-numerico').blur();

    await expect(page.locator('.toast-erro')).toHaveText(/número inteiro maior que zero/);
    expect(chamouPatch).toBe(false);
  });

  test('salvar um número novo preserva os canais já configurados', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, { disparos_acabando: { canais: { studio: true, whatsapp: true }, limiar: 10 } });
    let corpoEnviado = null;
    await page.route('**/api/configuracao', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: {} });
    });

    await page.fill('tr[data-chave="disparos_acabando"] .notificacao-numerico', '5');
    await page.locator('tr[data-chave="disparos_acabando"] .notificacao-numerico').blur();

    expect(corpoEnviado.notificacoesAtivas.disparos_acabando).toMatchObject({
      canais: { studio: true, whatsapp: true },
      limiar: 5,
    });
  });
});

test.describe('Configurações > Notificações — abas Regras/Histórico', () => {
  test('abre na aba Regras por padrão, com a tabela de canais visível', async ({ page }) => {
    await entrarNaTelaNotificacoes(page);
    await expect(page.locator('#aba-notificacoes-regras')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#painel-notificacoes-regras')).toBeVisible();
    await expect(page.locator('#painel-notificacoes-historico')).toBeHidden();
  });

  test('aba Histórico lista os eventos já disparados, lidos e não lidos', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {}, [
      { id: 'e1', tipo: 'agenda_criada', tipoTitulo: 'Novo agendamento criado', titulo: 'Novo agendamento: Corte', detalhe: 'Bruna — 10/08 10:00', criadoEm: '2026-08-10T10:00:00Z', lida: false },
      { id: 'e2', tipo: 'agenda_confirmada', tipoTitulo: 'Agendamento confirmado', titulo: 'Agendamento confirmado', detalhe: 'Corte com Bruna', criadoEm: '2026-08-09T09:00:00Z', lida: true },
    ]);
    await page.click('#aba-notificacoes-historico');

    await expect(page.locator('#painel-notificacoes-historico')).toBeVisible();
    const linhas = page.locator('#painel-notificacoes-historico tbody tr');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toContainText('Novo agendamento: Corte');
    await expect(linhas.nth(0).locator('.notificacao-historico-marcar-lida')).toBeVisible();
    await expect(linhas.nth(1)).toContainText('Lida');
  });

  test('sem nenhum evento no histórico, mostra mensagem vazia', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {}, []);
    await page.click('#aba-notificacoes-historico');
    await expect(page.locator('#painel-notificacoes-historico')).toContainText('Nenhuma notificação registrada ainda');
  });

  test('marcar como lida no Histórico some com o botão e vira badge "Lida"', async ({ page }) => {
    await entrarNaTelaNotificacoes(page, {}, [
      { id: 'e1', tipo: 'agenda_criada', tipoTitulo: 'Novo agendamento criado', titulo: 'Novo agendamento: Corte', detalhe: null, criadoEm: '2026-08-10T10:00:00Z', lida: false },
    ]);
    await page.route('**/api/notificacoes/historico', (route) =>
      route.fulfill({ json: { historico: [{ id: 'e1', tipo: 'agenda_criada', tipoTitulo: 'Novo agendamento criado', titulo: 'Novo agendamento: Corte', detalhe: null, criadoEm: '2026-08-10T10:00:00Z', lida: true }] } })
    );
    await page.click('#aba-notificacoes-historico');

    await page.click('.notificacao-historico-marcar-lida');

    await expect(page.locator('#painel-notificacoes-historico')).toContainText('Lida');
    await expect(page.locator('.notificacao-historico-marcar-lida')).toHaveCount(0);
  });
});

test.describe('Balão de notificações — marcar como lida e abrir na data do atendimento', () => {
  async function entrarComNotificacaoDeAgenda(page, item) {
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) =>
      route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
    );
    await page.route('**/api/notificacoes/*/lida', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/notificacoes', (route) =>
      route.fulfill({ json: { notificacoes: [{ tipo: 'agenda_criada', titulo: 'Novo agendamento criado', eventoUnico: true, itens: [item] }] } })
    );
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await page.click('#notificacoes-btn');
  }

  test('clicar no item abre a Agenda (visão Dia) na data do atendimento, não em hoje', async ({ page }) => {
    await entrarComNotificacaoDeAgenda(page, {
      id: 'e1', titulo: 'Novo agendamento: Corte', detalhe: 'Bruna', dataAgendamento: '2026-08-10T13:00:00.000Z',
    });

    await page.click('.ds-notificacoes-item');

    await expect(page.locator('.agenda-visao[data-tab="dia"]')).toHaveClass(/agenda-visao-ativa/);
    // 13:00 UTC = 10:00 em Brasília, 10/08/2026.
    await expect(page.locator('.nav-periodo-data strong')).toContainText('10 de agosto de 2026');
  });

  test('botão "marcar como lida" no balão não navega, e some da lista depois', async ({ page }) => {
    await entrarComNotificacaoDeAgenda(page, {
      id: 'e1', titulo: 'Novo agendamento: Corte', detalhe: 'Bruna', dataAgendamento: '2026-08-10T13:00:00.000Z',
    });
    let chamouMarcarLida = false;
    await page.route('**/api/notificacoes/e1/lida', (route) => { chamouMarcarLida = true; return route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/notificacoes', (route) => route.fulfill({ json: { notificacoes: [] } }));

    await page.click('.ds-notificacoes-item-marcar-lida', { force: true });

    expect(chamouMarcarLida).toBe(true);
    // Não navegou pra Agenda — continua em Início (view padrão do painel).
    await expect(page.locator('.ds-menu-link[data-menu="inicio"]')).toHaveClass(/ds-menu-link-ativo/);
  });
});
