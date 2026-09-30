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
  // mesma regra do backend real (profissionais > 1) — sem isso a coluna
  // "Profissionais" e o campo "Profissional exclusivo" ficam sempre
  // escondidos (contaStatus null).
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

// Abre o menu "⋯" (componente .ds-acoes do design system) de uma linha de
// serviço e clica na ação pedida — mesmo padrão já usado por Clientes/Agenda.
async function escolherAcaoServico(page, id, acao) {
  const caixa = page.locator(`.ds-acoes[data-servico-id="${id}"]`);
  await caixa.locator('.ds-acoes-btn').click();
  await caixa.locator(`.ds-acoes-item[data-acao="${acao}"]`).click();
}

test.describe('Serviços — CRUD (US17/PR4)', () => {
  test('lista os serviços numa tabela com nome, duração e valor', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissionais_exclusivos: [] }] });
    await page.click('.menu-item[data-menu="cadastro"]');
    const linha = page.locator('tr[data-servico-abrir="s1"]');
    await expect(linha).toContainText('Corte');
    await expect(linha).toContainText('30 min');
    await expect(linha).toContainText('R$ 50,00');
    await expect(linha.locator('.badge-status-ativo')).toHaveText('Ativo');
  });

  // US60 — descrição curta é opcional: aparece na linha quando cadastrada.
  test('serviço com descrição mostra o texto na linha', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, descricao: 'Inclui lavagem e finalização', profissionais_exclusivos: [] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('tr[data-servico-abrir="s1"]')).toContainText('Inclui lavagem e finalização');
  });

  test('serviço com profissional exclusivo mostra o nome dele na coluna Profissionais', async ({ page }) => {
    // 2 profissionais: com só 1, a coluna "Profissionais" some da tabela
    // (não é mais uma escolha real) — mesma regra de mostrar_profissional.
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissionais_exclusivos: ['p1'] }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }, { id: 'p2', nome: 'Ana', servicos: [] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('tr[data-servico-abrir="s1"]')).toContainText('Bruna');
  });

  test('serviço desabilitado mostra o badge e o kebab oferece "Habilitar"', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: false, profissionais_exclusivos: [] }] });
    await page.click('.menu-item[data-menu="cadastro"]');
    const linha = page.locator('tr[data-servico-abrir="s1"]');
    await expect(linha.locator('.badge-status-inativo')).toHaveText('Desabilitado');
    const caixa = linha.locator('.ds-acoes');
    await caixa.locator('.ds-acoes-btn').click();
    await expect(caixa.locator('.ds-acoes-item[data-acao="habilitar"]')).toHaveText('Habilitar');
  });

  test('sem serviços cadastrados, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [] });
    await page.click('.menu-item[data-menu="cadastro"]');
    await expect(page.locator('.vazio')).toContainText('Nenhum serviço cadastrado');
  });

  test('cria um novo serviço com profissional exclusivo selecionado', async ({ page }) => {
    // 2 profissionais: com só 1 a lista de profissionais exclusivos some do
    // formulário (data-somente hidden), impossível de marcar checkbox nela.
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
    await page.check('#servico-profissionais input[value="p1"]');
    await page.click('#btn-salvar-servico');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado).toMatchObject({
      nome: 'Escova',
      duracao_minutos: 45,
      preco: 60,
      descricao: 'Escova modeladora',
      profissionais_exclusivos: ['p1'],
    });
  });

  test('editar um serviço existente pré-preenche o formulário (inclusive descrição e profissional exclusivo)', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, descricao: 'Inclui lavagem', profissionais_exclusivos: ['p1'] }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await escolherAcaoServico(page, 's1', 'editar');

    await expect(page.locator('#servico-nome')).toHaveValue('Corte');
    await expect(page.locator('#servico-duracao')).toHaveValue('30');
    await expect(page.locator('#servico-preco')).toHaveValue('50');
    await expect(page.locator('#servico-descricao')).toHaveValue('Inclui lavagem');
    await expect(page.locator('#servico-profissionais input[value="p1"]')).toBeChecked();
  });

  test('desabilitar um serviço pelo kebab chama PATCH com ativo invertido', async ({ page }) => {
    await entrarNoPainel(page, { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissionais_exclusivos: [] }] });
    let corpoEnviado = null;
    await page.route('**/api/servicos/s1', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: false } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await escolherAcaoServico(page, 's1', 'desabilitar');

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
    await escolherAcaoServico(page, 's1', 'excluir');

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
    await escolherAcaoServico(page, 's1', 'excluir');
    await page.click('#btn-voltar-excluir-servico');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamou).toBe(false);
  });
});

test.describe('Novo agendamento — profissional exclusivo e serviço desabilitado (PR4)', () => {
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

  test('escolher um serviço com profissional exclusivo restringe as opções do campo Profissional', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissionais_exclusivos: ['p1'] }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }, { id: 'p2', nome: 'Ana', servicos: [] }],
    });
    await page.click('#btn-novo-agendamento');
    await page.selectOption('#novo-ag-servico', 's1');
    const opcoes = await page.locator('#novo-ag-profissional option').allTextContents();
    expect(opcoes.some((o) => o.includes('Bruna'))).toBe(true);
    expect(opcoes.some((o) => o.includes('Ana'))).toBe(false);
  });

  test('serviço sem profissional exclusivo mostra todos os profissionais', async ({ page }) => {
    await entrarNoPainel(page, {
      servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50, ativo: true, profissionais_exclusivos: [] }],
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'] }, { id: 'p2', nome: 'Ana', servicos: [] }],
    });
    await page.click('#btn-novo-agendamento');
    await page.selectOption('#novo-ag-servico', 's1');
    const opcoes = await page.locator('#novo-ag-profissional option').allTextContents();
    expect(opcoes.some((o) => o.includes('Bruna'))).toBe(true);
    expect(opcoes.some((o) => o.includes('Ana'))).toBe(true);
  });
});

// Abre o menu "⋯" (componente .ds-acoes do design system) de uma linha de
// profissional e clica na ação pedida — mesmo padrão de escolherAcaoServico.
async function escolherAcaoProfissional(page, id, acao) {
  const caixa = page.locator(`.ds-acoes[data-profissional-id="${id}"]`);
  await caixa.locator('.ds-acoes-btn').click();
  await caixa.locator(`.ds-acoes-item[data-acao="${acao}"]`).click();
}

test.describe('Profissionais — CRUD (US17)', () => {
  test('lista os profissionais numa tabela com a contagem de serviços atendidos', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1', 's2'], ativo: true }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    const linha = page.locator('tr[data-profissional-abrir="p1"]');
    await expect(linha).toContainText('Bruna');
    await expect(linha).toContainText('2 serviços atendidos');
    await expect(linha.locator('.badge-status-ativo')).toHaveText('Ativo');
  });

  test('profissional desabilitado mostra o badge e o kebab oferece "Habilitar"', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: [], ativo: false }],
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    const linha = page.locator('tr[data-profissional-abrir="p1"]');
    await expect(linha.locator('.badge-status-inativo')).toHaveText('Desabilitado');
    const caixa = linha.locator('.ds-acoes');
    await caixa.locator('.ds-acoes-btn').click();
    await expect(caixa.locator('.ds-acoes-item[data-acao="habilitar"]')).toHaveText('Habilitar');
  });

  test('clicar na linha do profissional abre a edição', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: ['s1'], ativo: true }],
    });
    await page.route('**/api/servicos', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ json: { servicos: [{ id: 's1', nome: 'Corte', duracao_minutos: 30, preco: 50 }] } });
    });
    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    await page.click('tr[data-profissional-abrir="p1"]');
    await expect(page.locator('#profissional-nome')).toHaveValue('Bruna');
  });

  test('desabilitar um profissional pelo kebab chama PATCH com ativo invertido', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: [], ativo: true }],
    });
    let corpoEnviado = null;
    await page.route('**/api/profissionais/p1', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'p1', nome: 'Bruna', ativo: false } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    await escolherAcaoProfissional(page, 'p1', 'desabilitar');

    await expect(page.locator('.toast-sucesso')).toHaveText(/desabilitado/);
    expect(corpoEnviado).toMatchObject({ ativo: false });
  });

  test('excluir um profissional pelo kebab chama DELETE', async ({ page }) => {
    await entrarNoPainel(page, {
      profissionais: [{ id: 'p1', nome: 'Bruna', servicos: [], ativo: true }],
    });
    let metodoRecebido = null;
    await page.route('**/api/profissionais/p1', (route) => {
      metodoRecebido = route.request().method();
      return route.fulfill({ json: { ok: true } });
    });

    await page.click('.menu-item[data-menu="cadastro"]');
    await page.click('#subtabs-cadastro .tab[data-aba-cadastro="profissionais"]');
    await escolherAcaoProfissional(page, 'p1', 'excluir');
    await page.click('#btn-confirmar-excluir-profissional');

    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
    expect(metodoRecebido).toBe('DELETE');
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
