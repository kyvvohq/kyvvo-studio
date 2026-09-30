const { test, expect } = require('@playwright/test');

// Cobre ST10.3 (US10): o painel busca GET /api/tenant/modulos ao carregar e
// acrescenta um item de menu por módulo ativo além dos fixos
// (Agendamento/Perfil/Configuração), que continuam sempre visíveis. O módulo
// "agenda_inteligente" não gera item duplicado (já é o item fixo
// "Agendamento"). As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function mockDashboardApis(page, modulos) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-06', agendamentos: [] } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos } }));
}

async function entrarNoPainel(page, modulos) {
  await mockDashboardApis(page, modulos);
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Menu dinâmico por módulo (ST10.3)', () => {
  test('módulo ativo (financeiro) aparece como item de menu', async ({ page }) => {
    await entrarNoPainel(page, [
      { key: 'agenda_inteligente', nome: 'Agendamento', preco_mensal: null },
      { key: 'financeiro', nome: 'Financeiro', preco_mensal: 49.9 },
    ]);
    await expect(page.locator('.menu-item[data-menu="modulo:financeiro"]')).toHaveText('Financeiro');
    // agenda_inteligente não duplica o item fixo "Agendamento".
    await expect(page.locator('.menu-item[data-menu="modulo:agenda_inteligente"]')).toHaveCount(0);
  });

  test('itens fixos continuam sempre visíveis mesmo sem módulos extras', async ({ page }) => {
    await entrarNoPainel(page, [{ key: 'agenda_inteligente', nome: 'Agendamento', preco_mensal: null }]);
    // Agenda é item fixo direto na sidebar (promovido de submenu — antes
    // vivia dentro de um grupo "Agenda" expansível com um único filho).
    await expect(page.locator('.menu-item[data-menu="agendamento"]')).toBeVisible();
    // Perfil (PR11) continua item do user menu; Configuração virou submenu de
    // Configurações na sidebar.
    await page.click('#user-menu-toggle');
    await expect(page.locator('.user-menu-item[data-menu="perfil"]')).toBeVisible();
    await page.click('#menu-config-toggle');
    await expect(page.locator('.menu-item[data-menu="configuracao"]')).toBeVisible();
  });

  test('módulo não ativo não aparece no menu', async ({ page }) => {
    await entrarNoPainel(page, [{ key: 'agenda_inteligente', nome: 'Agendamento', preco_mensal: null }]);
    await expect(page.locator('.menu-item[data-menu="modulo:financeiro"]')).toHaveCount(0);
  });

  // "crm"/"people" são OUTROS PRODUTOS Kyvvo, não módulos internos do Studio
  // — mesmo ativos, não podem virar item de sidebar (isso vive no menu de
  // perfil, ver renderOutrosProdutos em app.js).
  test('módulos de outros produtos (crm/people) não aparecem na sidebar', async ({ page }) => {
    await entrarNoPainel(page, [
      { key: 'agenda_inteligente', nome: 'Agendamento', preco_mensal: null },
      { key: 'crm', nome: 'Kyvvo CRM', preco_mensal: null },
      { key: 'people', nome: 'Kyvvo People', preco_mensal: null },
    ]);
    await expect(page.locator('.menu-item[data-menu="modulo:crm"]')).toHaveCount(0);
    await expect(page.locator('.menu-item[data-menu="modulo:people"]')).toHaveCount(0);
  });

  test('clicar no item do módulo mostra aviso de "em breve"', async ({ page }) => {
    // "financeiro" não serve mais de exemplo aqui — desde a US18 ele tem tela
    // própria (ver financeiro.spec.js). "estoque" continua sem tela.
    await entrarNoPainel(page, [
      { key: 'agenda_inteligente', nome: 'Agendamento', preco_mensal: null },
      { key: 'estoque', nome: 'Estoque', preco_mensal: 49.9 },
    ]);
    await page.click('.menu-item[data-menu="modulo:estoque"]');
    await expect(page.locator('#conteudo')).toContainText('Em breve');
    await expect(page.locator('.menu-item[data-menu="modulo:estoque"]')).toHaveClass(/active/);
  });
});
