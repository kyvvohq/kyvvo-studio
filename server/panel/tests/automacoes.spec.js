const { test, expect } = require('@playwright/test');

// Tela Configurações > Automações — mesmo layout de People e CRM (componentes
// do DS: cabeçalho com "+ Nova automação", filtro, tabela Nome / Gatilho /
// Modelo / Ativa e menu ⋯ com Editar / Duplicar / Excluir), várias
// automações por gatilho, canal sempre WhatsApp (não aparece). 4 gatilhos: Confirmação de agenda, Feedback
// do serviço, Aniversário do cliente, Clientes inativos. API mockada via
// page.route (sem Postgres).

const TEMPLATES = [
  { nome: 'studio_confirmacao', status: 'APPROVED', parametros_corpo: [], parametros_nomeados: false },
  { nome: 'studio_feedback', status: 'APPROVED', parametros_corpo: [], parametros_nomeados: false },
];

function automacaoBase(over = {}) {
  return {
    id: over.id || 'a1', gatilho: 'agendamento_criado', canal: 'whatsapp',
    nome: 'Confirmação de agenda', ativo: true, removivel: true,
    corpo: 'Oi {{cliente}}', whatsapp_template: 'studio_confirmacao',
    atualizado_em: '2026-09-10T12:00:00Z', ...over,
  };
}

async function entrar(page, { automacoes = [automacaoBase()], templates = TEMPLATES } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({ json: { role: 'administrador', plano: 'professional', status: 'ativo', email_verified: true, onboarding_dispensado: true, configuracao: {} } })
  );
  await page.route('**/api/agendamentos**', (route) => route.fulfill({ json: { view: 'dia', data: '2026-09-10', agendamentos: [] } }));
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/automacoes/templates-whatsapp', (route) => route.fulfill({ json: { templates } }));
  let lista = automacoes.slice();
  await page.route('**/api/automacoes', (route) => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill({ json: { automacoes: lista } });
    if (m === 'POST') {
      const body = route.request().postDataJSON();
      const nova = automacaoBase({ id: `n${lista.length + 1}`, ...body, ativo: body.ativo !== false });
      lista.push(nova);
      return route.fulfill({ status: 201, json: nova });
    }
    return route.fallback();
  });
  await page.route('**/api/automacoes/*', (route) => {
    const m = route.request().method();
    const id = route.request().url().split('/').pop().split('?')[0];
    if (m === 'PATCH') {
      const body = route.request().postDataJSON();
      lista = lista.map((a) => (a.id === id ? { ...a, ...body } : a));
      return route.fulfill({ json: lista.find((a) => a.id === id) });
    }
    if (m === 'DELETE') { lista = lista.filter((a) => a.id !== id); return route.fulfill({ json: { ok: true } }); }
    return route.fallback();
  });
  await page.route('**/api/automacoes/*/duplicar', (route) => {
    const id = route.request().url().split('/').slice(-2)[0];
    const base = lista.find((a) => a.id === id);
    const copia = { ...base, id: `${id}-copia`, nome: `${base.nome} (cópia)`, ativo: false };
    lista.push(copia);
    return route.fulfill({ status: 201, json: copia });
  });
  // Aba "Disparos" (renderAutomacoes busca junto com a lista) — sem este mock a
  // chamada cairia no servidor estático (404 em texto) e a tela inteira não
  // renderizaria. Registrado depois de '**/api/automacoes/*' pra ter prioridade.
  await page.route('**/api/automacoes/disparos', (route) =>
    route.fulfill({ json: { total: 0, disparos: [], limitePlano: null } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#menu-config-toggle');
  await page.click('.menu-item[data-menu="automacoes"]');
}

// Abre o menu ⋯ da linha e escolhe a ação (Editar / Duplicar / Excluir).
async function escolherAcao(page, id, acao) {
  await page.click(`.ds-acoes[data-automacao-id="${id}"] .ds-acoes-btn`);
  await page.click(`.ds-acoes-item[data-acao="${acao}"]`);
}

test.describe('Automações — lista e ações', () => {
  test('lista com colunas Nome / Gatilho / Modelo / Ativa (sem coluna Canal)', async ({ page }) => {
    await entrar(page);
    const cabecalho = page.locator('.ds-tabela-cabecalho');
    await expect(cabecalho).not.toContainText('Canal');
    await expect(cabecalho).toContainText('Modelo');
    const linha = page.locator('.ds-tabela-linha[data-automacao="a1"]');
    await expect(linha).toContainText('Confirmação de agenda');
    await expect(linha).toContainText('studio_confirmacao');
    await expect(linha.locator('.auto-toggle')).toBeChecked();
  });

  test('menu ⋯ oferece Editar, Duplicar e Excluir', async ({ page }) => {
    await entrar(page);
    await page.click('.ds-acoes[data-automacao-id="a1"] .ds-acoes-btn');
    await expect(page.locator('.ds-acoes-item[data-acao="editar"]')).toBeVisible();
    await expect(page.locator('.ds-acoes-item[data-acao="duplicar"]')).toBeVisible();
    await expect(page.locator('.ds-acoes-item[data-acao="excluir"]')).toBeVisible();
  });

  test('automação sem modelo mostra o selo "Sem modelo"', async ({ page }) => {
    await entrar(page, { automacoes: [automacaoBase({ whatsapp_template: null })] });
    await expect(page.locator('.ds-tabela-linha[data-automacao="a1"]')).toContainText('Sem modelo');
  });

  test('o filtro lista só os 4 gatilhos', async ({ page }) => {
    await entrar(page);
    const opcoes = await page.locator('#filtro-gatilho-auto option').allTextContents();
    expect(opcoes).toEqual([
      'Todos os gatilhos', 'Confirmação de agenda', 'Feedback do serviço',
      'Aniversário do cliente', 'Clientes inativos',
    ]);
  });

  test('"+ Nova automação" cria e a nova linha aparece', async ({ page }) => {
    await entrar(page, { automacoes: [] });
    await page.click('#btn-nova-automacao');
    await page.fill('#automacao-nome', 'Aviso de chegada');
    await page.selectOption('#automacao-gatilho', 'agendamento_criado');
    await page.selectOption('#automacao-template', 'studio_confirmacao');
    await page.fill('#automacao-corpo', 'Chegue 10 min antes, {{cliente}}');
    await page.click('#btn-salvar-automacao');
    await expect(page.locator('#lista-automacoes')).toContainText('Aviso de chegada');
  });

  test('o formulário não tem campo de canal nem de horas', async ({ page }) => {
    await entrar(page, { automacoes: [] });
    await page.click('#btn-nova-automacao');
    await expect(page.locator('#automacao-canal')).toHaveCount(0);
    await expect(page.locator('#automacao-horas')).toHaveCount(0);
  });

  test('Duplicar cria uma cópia desativada', async ({ page }) => {
    await entrar(page);
    await escolherAcao(page, 'a1', 'duplicar');
    await expect(page.locator('#lista-automacoes')).toContainText('Confirmação de agenda (cópia)');
  });

  test('Excluir remove a linha após confirmação', async ({ page }) => {
    await entrar(page);
    await escolherAcao(page, 'a1', 'excluir');
    await page.click('#btn-confirmar-excluir-automacao');
    await expect(page.locator('.ds-tabela-linha[data-automacao="a1"]')).toHaveCount(0);
  });

  test('filtro por gatilho esconde as demais', async ({ page }) => {
    await entrar(page, { automacoes: [
      automacaoBase({ id: 'a1', gatilho: 'agendamento_criado', nome: 'Confirmação' }),
      automacaoBase({ id: 'a2', gatilho: 'aniversario_cliente', nome: 'Parabéns', ativo: false }),
    ] });
    await page.selectOption('#filtro-gatilho-auto', 'aniversario_cliente');
    await expect(page.locator('.ds-tabela-linha[data-automacao="a2"]')).toBeVisible();
    await expect(page.locator('.ds-tabela-linha[data-automacao="a1"]')).toHaveCount(0);
  });
});
