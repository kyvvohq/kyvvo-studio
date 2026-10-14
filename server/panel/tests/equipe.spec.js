const { test, expect } = require('@playwright/test');

// Cobre US62 — convites de equipe com perfis de acesso: tela "Equipe"
// (listar membros/convites, convidar, desativar/reativar, remover, cancelar
// convite) e a restrição de itens de menu por perfil (administrador vê tudo,
// operador só o operacional). Equipe mudou de lugar (2026-10-14): saiu do
// menu do usuário e virou aba de Configurações > Cadastro, junto de
// Serviços/Profissionais/Bloqueio de agenda — e passou a exigir plano
// Smart ou Smart Plus (chaves `professional`/`enterprise`), não mais o
// plano Custom inexistente que deixava a aba escondida pra 100% dos
// tenants. As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

async function entrarNoPainel(page, { role = 'administrador', plano = 'professional', membros = [], convites = [] } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-08-06', agendamentos: [] } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({
      json: {
        email_verified: true,
        status: 'ativo',
        trial_ativo: false,
        dias_restantes: null,
        pagamento_pendente: false,
        role,
        // Aba Equipe exige data-planos="professional,enterprise,custom"
        // (Smart/Smart Plus — ver server/db/047_planos_eixo_valor.sql, a
        // `chave` não mudou com o rename pra Smart/Smart Plus) ALÉM de
        // data-somente-admin — sem um plano permitido aqui, fica escondida
        // mesmo pra administrador.
        plano,
        configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false },
      },
    })
  );
  await page.route('**/api/equipe', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { membros, convites } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

async function abrirTelaEquipe(page, opts) {
  await entrarNoPainel(page, opts);
  await page.click('.menu-item[data-menu="cadastro"]');
  await page.click('#subtabs-cadastro .tab[data-aba-cadastro="equipe"]');
}

const MEMBRO_ADMIN = { id: 'u1', nome: 'Ana Souza', email: 'ana@salao.com', role: 'administrador', ativo: true, criado_em: '2026-07-01T00:00:00.000Z' };
const MEMBRO_OPERADOR = { id: 'u2', nome: 'Bruna Lima', email: 'bruna@salao.com', role: 'operador', ativo: true, criado_em: '2026-07-05T00:00:00.000Z' };
const CONVITE_PENDENTE = { id: 'c1', email: 'joana@salao.com', role: 'operador', status: 'pendente', expires_at: '2026-08-12', criado_em: '2026-08-05' };

test.describe('Restrição de menu por perfil (US62)', () => {
  test('administrador em plano Smart vê a aba Equipe dentro de Cadastro', async ({ page }) => {
    await entrarNoPainel(page, { role: 'administrador', plano: 'professional' });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('#subtabs-cadastro .tab[data-aba-cadastro="equipe"]')).toBeVisible();
    // Minha Empresa/Cobrança/Preferências ficam no submenu de Configurações.
    await expect(page.locator('.menu-item[data-menu="empresa"]')).toBeVisible();
    await expect(page.locator('.menu-item[data-menu="pagamentos"]')).toBeVisible();
    await expect(page.locator('.menu-item[data-menu="configuracao"]')).toBeVisible();
  });

  test('operador não vê a aba Equipe nem itens restritos ao administrador', async ({ page }) => {
    await entrarNoPainel(page, { role: 'operador', plano: 'professional' });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('#subtabs-cadastro .tab[data-aba-cadastro="equipe"]')).toBeHidden();
    await expect(page.locator('.menu-item[data-menu="empresa"]')).toBeHidden();
    await expect(page.locator('.menu-item[data-menu="pagamentos"]')).toBeHidden();
    await expect(page.locator('.menu-item[data-menu="configuracao"]')).toBeHidden();
    // Itens operacionais continuam disponíveis.
    await expect(page.locator('.user-menu-item[data-menu="perfil"]')).toBeVisible();
    await expect(page.locator('.menu-item[data-menu="whatsapp"]')).toBeVisible();
  });

  test('administrador em plano Essencial (fora de Smart/Smart Plus) não vê a aba Equipe', async ({ page }) => {
    await entrarNoPainel(page, { role: 'administrador', plano: 'starter' });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('#subtabs-cadastro .tab[data-aba-cadastro="equipe"]')).toBeHidden();
    // Serviços continua disponível — só Equipe é restrito por plano.
    await expect(page.locator('#subtabs-cadastro .tab[data-aba-cadastro="servicos"]')).toBeVisible();
  });

  test('administrador em plano Smart Plus também vê a aba Equipe', async ({ page }) => {
    await entrarNoPainel(page, { role: 'administrador', plano: 'enterprise' });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('#subtabs-cadastro .tab[data-aba-cadastro="equipe"]')).toBeVisible();
  });
});

test.describe('Tela Equipe — listagem (US62)', () => {
  test('lista membros com perfil e status', async ({ page }) => {
    await abrirTelaEquipe(page, { membros: [MEMBRO_ADMIN, MEMBRO_OPERADOR] });

    const linhas = page.locator('table').first().locator('tbody tr');
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0)).toContainText('Ana Souza');
    await expect(linhas.nth(0)).toContainText('Administrador');
    await expect(linhas.nth(0)).toContainText('Ativo');
    await expect(linhas.nth(1)).toContainText('Bruna Lima');
    await expect(linhas.nth(1)).toContainText('Operador');
  });

  test('sem membros e sem convites, mostra mensagens vazias', async ({ page }) => {
    await abrirTelaEquipe(page);
    await expect(page.locator('#conteudo')).toContainText('Nenhum membro cadastrado.');
    await expect(page.locator('#conteudo')).toContainText('Nenhum convite pendente.');
  });

  test('lista convites pendentes com botão de cancelar', async ({ page }) => {
    await abrirTelaEquipe(page, { convites: [CONVITE_PENDENTE] });
    await expect(page.locator('#conteudo')).toContainText('joana@salao.com');
    await expect(page.locator('#conteudo')).toContainText('Pendente');
    await expect(page.locator('[data-acao-convite="cancelar"]')).toBeVisible();
  });
});

test.describe('Tela Equipe — convidar membro (US62)', () => {
  test('convite válido chama a API com e-mail e perfil, e recarrega a lista', async ({ page }) => {
    await abrirTelaEquipe(page);
    let payloadEnviado = null;
    await page.route('**/api/equipe/convites', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', email: payloadEnviado.email, role: payloadEnviado.role, status: 'pendente', expires_at: '2026-08-12' } });
    });

    await page.click('#btn-convidar-membro');
    await page.fill('#convite-email', 'novo@salao.com');
    await page.selectOption('#convite-role', 'administrador');
    await page.click('#btn-enviar-convite');

    await expect(page.locator('.toast-sucesso')).toHaveText(/enviado com sucesso/);
    expect(payloadEnviado).toEqual({ email: 'novo@salao.com', role: 'administrador' });
  });

  test('e-mail em branco fica destacado como obrigatório e não chama a API', async ({ page }) => {
    await abrirTelaEquipe(page);
    let chamouApi = false;
    await page.route('**/api/equipe/convites', (route) => {
      chamouApi = true;
      return route.fulfill({ status: 201, json: {} });
    });

    await page.click('#btn-convidar-membro');
    await page.click('#btn-enviar-convite');

    await expect(page.locator('#convite-email')).toHaveClass(/campo-invalido/);
    expect(chamouApi).toBe(false);
  });

  test('erro do backend (e-mail já cadastrado) aparece no modal', async ({ page }) => {
    await abrirTelaEquipe(page);
    await page.route('**/api/equipe/convites', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 409, json: { error: 'Este e-mail já está cadastrado no Kyvvo.' } });
    });

    await page.click('#btn-convidar-membro');
    await page.fill('#convite-email', 'ja-existe@salao.com');
    await page.click('#btn-enviar-convite');

    await expect(page.locator('#convidar-membro-erro')).toHaveText('Este e-mail já está cadastrado no Kyvvo.');
  });
});

test.describe('Tela Equipe — desativar/reativar/remover (US62)', () => {
  test('desativar membro ativo chama PATCH com ativo:false', async ({ page }) => {
    await abrirTelaEquipe(page, { membros: [MEMBRO_OPERADOR] });
    let payloadEnviado = null;
    await page.route('**/api/equipe/membros/u2', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...MEMBRO_OPERADOR, ativo: false } });
    });

    await page.click('[data-acao-membro="desativar"]');
    await expect(page.locator('.modal-card h3')).toHaveText('Desativar membro');
    await page.click('#btn-confirmar-alterar-ativo');

    expect(payloadEnviado).toEqual({ ativo: false });
    await expect(page.locator('.toast-sucesso')).toHaveText(/desativado com sucesso/);
  });

  test('reativar membro desativado chama PATCH com ativo:true', async ({ page }) => {
    await abrirTelaEquipe(page, { membros: [{ ...MEMBRO_OPERADOR, ativo: false }] });
    let payloadEnviado = null;
    await page.route('**/api/equipe/membros/u2', (route) => {
      payloadEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...MEMBRO_OPERADOR, ativo: true } });
    });

    await page.click('[data-acao-membro="reativar"]');
    await page.click('#btn-confirmar-alterar-ativo');

    expect(payloadEnviado).toEqual({ ativo: true });
    await expect(page.locator('.toast-sucesso')).toHaveText(/reativado com sucesso/);
  });

  test('remover membro chama DELETE e mostra confirmação', async ({ page }) => {
    await abrirTelaEquipe(page, { membros: [MEMBRO_OPERADOR] });
    let chamouDelete = false;
    await page.route('**/api/equipe/membros/u2', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      chamouDelete = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('[data-acao-membro="remover"]');
    await expect(page.locator('.modal-card h3')).toHaveText('Remover membro');
    await page.click('#btn-confirmar-remover-membro');

    expect(chamouDelete).toBe(true);
    await expect(page.locator('.toast-sucesso')).toHaveText(/removido com sucesso/);
  });

  test('erro ao desativar último administrador aparece no modal', async ({ page }) => {
    await abrirTelaEquipe(page, { membros: [MEMBRO_ADMIN] });
    await page.route('**/api/equipe/membros/u1', (route) =>
      route.fulfill({ status: 400, json: { error: 'Não é possível desativar o último administrador da conta.' } })
    );

    await page.click('[data-acao-membro="desativar"]');
    await page.click('#btn-confirmar-alterar-ativo');

    await expect(page.locator('#alterar-ativo-membro-erro')).toHaveText('Não é possível desativar o último administrador da conta.');
  });

  test('cancelar convite pendente chama DELETE e recarrega a lista', async ({ page }) => {
    await abrirTelaEquipe(page, { convites: [CONVITE_PENDENTE] });
    let chamouDelete = false;
    await page.route('**/api/equipe/convites/c1', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      chamouDelete = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('[data-acao-convite="cancelar"]');
    await expect(page.locator('.toast-sucesso')).toHaveText(/cancelado/);
    expect(chamouDelete).toBe(true);
  });
});
