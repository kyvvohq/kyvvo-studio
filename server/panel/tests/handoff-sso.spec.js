const { test, expect } = require('@playwright/test');

// Cobre o login automático ao trocar de produto (handoff via kyvvo-platform):
// clicar no item do menu de perfil chama POST /api/meus-produtos/handoff e
// navega pra URL devolvida; se o handoff falhar por qualquer motivo, cai no
// link puro (href original, landing pública do produto). As chamadas de API
// são mockadas via page.route — sem dependência de rede real nem do
// kyvvo-platform.

async function entrarComOutroProduto(page, outrosProdutos) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({
      json: {
        role: 'administrador',
        plano: 'professional',
        status: 'ativo',
        email_verified: true,
        onboarding_dispensado: true,
        configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false, horario_nao_confirmado: false },
        outros_produtos: outrosProdutos,
      },
    })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#user-menu-toggle');
}

test.describe('Trocar de produto — login automático (handoff)', () => {
  test('clicar no produto chama o handoff e navega pra URL devolvida', async ({ page }) => {
    await entrarComOutroProduto(page, [{ chave: 'crm', nome: 'CRM', url: 'https://crm.kyvvo.com.br' }]);

    let corpoEnviado = null;
    await page.route('**/api/meus-produtos/handoff', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { url: 'https://crm.kyvvo.com.br/crm/sso?code=abc123' } });
    });
    await page.route('https://crm.kyvvo.com.br/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>CRM SSO</body></html>' })
    );

    await page.click('[data-produto-chave="crm"]');
    await page.waitForURL('https://crm.kyvvo.com.br/crm/sso?code=abc123');

    expect(corpoEnviado).toEqual({ produto: 'crm' });
  });

  test('handoff falhando cai no link puro (href original)', async ({ page }) => {
    await entrarComOutroProduto(page, [{ chave: 'people', nome: 'People', url: 'https://people.kyvvo.com.br' }]);

    await page.route('**/api/meus-produtos/handoff', (route) => route.fulfill({ status: 502, json: { error: 'fora do ar' } }));
    await page.route('https://people.kyvvo.com.br/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>People landing</body></html>' })
    );

    await page.click('[data-produto-chave="people"]');
    await page.waitForURL('https://people.kyvvo.com.br/');
  });

  test('sem outros produtos ativos, o item não aparece no menu', async ({ page }) => {
    await entrarComOutroProduto(page, []);
    await expect(page.locator('#user-menu-outros-produtos [data-produto-chave]')).toHaveCount(0);
  });
});
