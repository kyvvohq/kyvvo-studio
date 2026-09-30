const { test, expect } = require('@playwright/test');

// Cobre o redesenho de Configurações > Notificações: matriz de canais
// (Descrição/E-mail/WhatsApp/Studio), incluindo os 3 tipos novos orientados
// a evento (agenda criada/confirmada/remarcada) e o campo numérico de
// disparos_acabando. As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function entrarNaTelaNotificacoes(page, notificacoesAtivas = {}) {
  await page.route('**/api/configuracao', (route) => {
    if (route.request().method() === 'PATCH') return route.fallback();
    return route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', notificacoes_ativas: notificacoesAtivas } });
  });
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
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
  test('lista os 5 tipos com as colunas Descrição/E-mail/WhatsApp/Studio', async ({ page }) => {
    await entrarNaTelaNotificacoes(page);
    await expect(page.locator('th')).toHaveText(['Descrição', 'E-mail', 'WhatsApp', 'Studio']);
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
    expect(corpoEnviado.notificacoesAtivas.agenda_criada.canais).toEqual({ studio: true, email: true, whatsapp: false });
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
    expect(cfgEnviado.canais).toEqual({ studio: false, email: false, whatsapp: false });
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
