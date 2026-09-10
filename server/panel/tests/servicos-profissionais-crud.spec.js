const { test, expect } = require('@playwright/test');

// Cobre US17: CRUD de serviços e profissionais pelo portal (listar, criar,
// editar, excluir, e o vínculo de quais serviços cada profissional atende).
// As chamadas de API são mockadas via page.route — sem dependência de
// Postgres real.

async function entrarNoPainel(page, { servicos = [], profissionais = [] } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  // plano 'custom' fixo pra manter o menu Profissionais visível/clicável
  // nestes testes (data-somente-plano-custom); mostrar_profissional segue a
  // mesma regra do backend real (profissionais > 1) — sem isso os campos
  // "Profissional preferencial" ficam sempre escondidos (contaStatus null).
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({
      json: {
        role: 'administrador',
        plano: 'custom',
        status: 'ativo',
        email_verified: true,
        onboarding_dispensado: true,
        configuracao: { sem_servicos: false, sem_profissionais: false, whatsapp_desconectado: false, horario_nao_confirmado: false },
        mostrar_profissional: profissionais.length > 1,
      },
    })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/servicos', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { servicos } });
  });
  await page.route('**/api/profissionais', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { profissionais } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('Serviços — CRUD (US17/PR4)', () => {
  test('lista os serviços cadastrados com labels e botões sempre visíveis', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true }] });
    await page.click('.menu-item[data-menu="cadastro"]');
    const item = page.locator('.servico-item');
    await expect(item).toContainText('Serviço: Corte');
    await expect(item).toContainText('Duração: 30 min');
    await expect(item).toContainText('Valor: R$ 50,00');
    // Editar/Desabilitar/Excluir visíveis sem precisar abrir nenhum menu.
    await expect(item.locator('[data-acao-servico="editar"]')).toBeVisible();
    await expect(item.locator('[data-acao-servico="desabilitar"]')).toBeVisible();
    await expect(item.locator('[data-acao-servico="excluir"]')).toBeVisible();
  });

  // US60 — descrição curta é opcional: aparece no card quando cadastrada.
  test('serviço com descrição mostra o texto no card', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, descricao: 'Inclui lavagem e finalização' }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('.servico-item')).toContainText('Inclui lavagem e finalização');
  });

  test('serviço com profissional preferencial mostra o nome dele no card', async ({ page }) => {
    // 2 profissionais: com só 1, "Profissional preferencial" some do card
    // (não é mais uma escolha real) — mesma regra de mostrar_profissional.
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissional_preferencial_id: 'p1' }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }, { id: 'p2', nome: 'Ana', servicos: [] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('.servico-item')).toContainText('Profissional preferencial: Bruna');
  });

  test('serviço desabilitado mostra o badge e o botão vira "Habilitar"', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: false }] });
    await page.click('.menu-item[data-menu="cadastro"]');
    const item = page.locator('.servico-item');
    await expect(item).toHaveClass(/servico-desabilitado/);
    await expect(item.locator('.badge')).toHaveText('Desabilitado');
    await expect(item.locator('[data-acao-servico="habilitar"]')).toHaveText('Habilitar');
  });

  test('sem serviços cadastrados, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [] });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('.vazio')).toContainText('Nenhum serviço cadastrado');
  });

  test('cria um novo serviço com profissional preferencial', async ({ page }) => {
    // 2 profissionais: com só 1 o campo "Profissional preferencial" some do
    // formulário (data-somente hidden), impossível de selectOption nele.
    await entrarNoPainel(page, { servicos: [], profissionais: [{ id: 'p1', nome: 'Bruna', servicos: [] }, { id: 'p2', nome: 'Ana', servicos: [] }] });
    let corpoEnviado = null;
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ativo: true, ...corpoEnviado } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#btn-novo-servico');
    await page.fill('#servico-nome', 'Escova');
    await page.fill('#servico-duracao', '45');
    await page.fill('#servico-preco', '60');
    await page.fill('#servico-descricao', 'Escova modeladora');
    await page.selectOption('#servico-profissional-preferencial', 'p1');
    await page.click('#btn-salvar-servico');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({
      nome: 'Escova',
      duracao_minutos: 45,
      preco: 60,
      descricao: 'Escova modeladora',
      profissional_preferencial_id: 'p1',
    });
  });

  test('editar um serviço existente pré-preenche o formulário (inclusive descrição e profissional preferencial)', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, descricao: 'Inclui lavagem', profissional_preferencial_id: 'p1' }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('[data-acao-servico="editar"]');

    await expect(page.locator('#servico-nome')).toHaveValue('Corte');
    await expect(page.locator('#servico-duracao')).toHaveValue('30');
    await expect(page.locator('#servico-preco')).toHaveValue('50');
    await expect(page.locator('#servico-descricao')).toHaveValue('Inclui lavagem');
    await expect(page.locator('#servico-profissional-preferencial')).toHaveValue('p1');
  });

  test('desabilitar e habilitar um serviço chama PATCH com ativo invertido', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true }] });
    let corpoEnviado = null;
    await page.route('**/api/servicos/s1', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: false } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('[data-acao-servico="desabilitar"]');

    await expect(page.locator('.toast-sucesso')).toHaveText(/desabilitado/);
    expect(corpoEnviado).toMatchObject({ ativo: false });
  });

  test('exclui um serviço (soft delete) e some da listagem', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: null, ativo: true }] });
    let metodoRecebido = null;
    await page.route('**/api/servicos/s1', (route) => {
      metodoRecebido = route.request().method();
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('[data-acao-servico="excluir"]');

    await expect(page.locator('.modal-card')).toContainText('não estará mais disponível para novos agendamentos');
    await page.click('#btn-confirmar-excluir-servico');

    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
    expect(metodoRecebido).toBe('DELETE');
  });

  test('cancelar a exclusão fecha o popup sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true }] });
    let chamou = false;
    await page.route('**/api/servicos/s1', (route) => {
      chamou = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('[data-acao-servico="excluir"]');
    await page.click('#btn-voltar-excluir-servico');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamou).toBe(false);
  });
});

test.describe('Novo agendamento — profissional preferencial e serviço desabilitado (PR4)', () => {
  test('serviço desabilitado não aparece no dropdown de novo agendamento', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [
        { id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true },
        { id: 's2', nome: 'Hidratação', duracao_minutos: 60, preco: 80, ativo: false },
      ],
    });
    await page.click('#btn-novo-agendamento');
    const opcoes = await page.locator('#novo-ag-servico option').allTextContents();
    expect(opcoes.some((o) => o.includes('Corte'))).toBe(true);
    expect(opcoes.some((o) => o.includes('Hidratação'))).toBe(false);
  });

  test('escolher um serviço com profissional preferencial pré-seleciona ele', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissional_preferencial_id: 'p1' }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }, { id: 'p2', nome: 'Ana', servicos: [] }],
    });
    await page.click('#btn-novo-agendamento');
    await page.selectOption('#novo-ag-servico', 's1');
    await expect(page.locator('#novo-ag-profissional')).toHaveValue('p1');
  });
});

test.describe('Profissionais — CRUD (US17)', () => {
  test('lista os profissionais com a contagem de serviços atendidos', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1', 's2'] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    const item = page.locator('.agendamento-item');
    await expect(item).toContainText('Bruna');
    await expect(item).toContainText('2 serviços atendidos');
  });

  test('cria profissional novo com serviços selecionados', async ({ page }) => {
    await entrarNoPainel(page, { profissionais: [] });
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] } });
    });
    let corpoEnviado = null;
    await page.route('**/api/profissionais', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    await page.click('#btn-novo-profissional');
    await page.fill('#profissional-nome', 'Carla');
    await page.check('#profissional-servicos input[value="s1"]');
    await page.click('#btn-salvar-profissional');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome: 'Carla', servicos: ['s1'] });
  });

  test('nome em branco fica destacado como obrigatório', async ({ page }) => {
    await entrarNoPainel(page, { profissionais: [] });
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { servicos: [] } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    await page.click('#btn-novo-profissional');
    await page.click('#btn-salvar-profissional');

    await expect(page.locator('#profissional-nome')).toHaveClass(/campo-invalido/);
  });
});
