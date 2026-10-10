const { test, expect } = require('@playwright/test');

// Cobre o item de menu "Início" (dashboard, reformulado em 5 seções: Seu
// dia, Próximos atendimentos, Atendimento agente Kyvvo, Oportunidades,
// Financeiro). As chamadas de API são mockadas via page.route — sem
// dependência de Postgres real.

const RESUMO_PADRAO = {
  atendimentos_hoje: 0,
  horarios_livres_hoje: 0,
  previsto_hoje: 0,
  oportunidades: { clientes_sem_retorno: 0, horarios_livres_amanha: 0 },
  atendimento_ia: null,
  financeiro: null,
};

async function entrarNoPainel(page, { dia = [], resumo = {} } = {}) {
  // "Agora" fixado às 10h de Brasília — os fixtures de cada teste marcam
  // horários antes/depois desse ponto pra exercitar o filtro de "só o que
  // ainda vai acontecer hoje".
  await page.clock.install({ time: new Date('2026-07-17T10:00:00-03:00') });
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos: dia } });
  });
  await page.route('**/api/inicio/resumo', (route) =>
    route.fulfill({ json: { ...RESUMO_PADRAO, ...resumo } })
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
    // "Conversa" abre o WhatsApp via window.open — sem stub o Playwright
    // tentaria abrir uma aba/popup de verdade. Grava as chamadas num array
    // pra o teste conferir a URL sem depender de uma janela real.
    window.__opens = [];
    window.open = (url) => { window.__opens.push(url); return null; };
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="inicio"]');
}

test.describe('Início (dashboard)', () => {
  test('item de menu "Início" existe e navega pra ele', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toHaveText('Início');
    await expect(page.locator('.menu-item[data-menu="inicio"]')).toHaveClass(/active/);
  });

  test('botão "+ Novo agendamento" abre o modal', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await page.click('#btn-inicio-novo-agendamento');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-card h3')).toHaveText('Novo agendamento');
  });

  test('Seção "Seu dia" mostra os 3 cards vindos de /api/inicio/resumo', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [],
      resumo: { atendimentos_hoje: 8, horarios_livres_hoje: 2, previsto_hoje: 650 },
    });
    const secao = page.locator('.inicio-secao', { hasText: 'Seu dia' });
    await expect(secao).toContainText('8');
    await expect(secao).toContainText('2');
    await expect(secao).toContainText('R$ 650,00');
  });

  test('Próximos atendimentos: lista só o que ainda vai acontecer hoje, com cliente e serviço', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [
        { id: 'passado', data_hora: '2026-07-17T12:00:00.000Z', status: 'confirmado', cliente_id: 'c1', cliente: 'Maria', cliente_telefone: '5534999990001', servico: 'Corte', duracao_minutos: 30, preco: '50.00' },
        { id: 'futuro', data_hora: '2026-07-17T16:00:00.000Z', status: 'confirmado', cliente_id: 'c2', cliente: 'Joana', cliente_telefone: '5534999990002', servico: 'Escova', duracao_minutos: 45, preco: '40.00' },
        { id: 'cancelado-futuro', data_hora: '2026-07-17T18:00:00.000Z', status: 'cancelado', cliente_id: 'c3', cliente: 'Léo', cliente_telefone: '5534999990003', servico: 'Barba', duracao_minutos: 20, preco: '30.00' },
      ],
    });

    const item = page.locator('.inicio-atendimento-item[data-id="futuro"]');
    await expect(item).toBeVisible();
    await expect(item).toContainText('Joana');
    await expect(item).toContainText('Escova');
    await expect(page.locator('.inicio-atendimento-item[data-id="passado"]')).toHaveCount(0);
    await expect(page.locator('.inicio-atendimento-item[data-id="cancelado-futuro"]')).toHaveCount(0);
  });

  test('estado vazio de Próximos atendimentos', async ({ page }) => {
    await entrarNoPainel(page, { dia: [] });
    await expect(page.locator('.vazio')).toHaveText('Nenhum agendamento para o restante de hoje.');
  });

  test('menu ⋯ > "Ver cliente" abre o cadastro do cliente do atendimento', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [{ id: 'ag1', data_hora: '2026-07-17T16:00:00.000Z', status: 'confirmado', cliente_id: 'c1', cliente: 'Joana', cliente_telefone: '5534999990002', servico: 'Escova', duracao_minutos: 45, preco: '40.00' }],
    });
    await page.route('**/api/clientes/c1', (route) =>
      route.fulfill({ json: { cliente: { id: 'c1', nome: 'Joana', telefone: '5534999990002', data_nascimento: null }, historico: [] } })
    );
    await page.click('.inicio-atendimento-item[data-id="ag1"] .ds-acoes-btn');
    await page.click('.inicio-atendimento-item[data-id="ag1"] .ds-acoes-item[data-acao="perfil"]');
    await expect(page.locator('.modal-card h3')).toHaveText('Joana');
  });

  test('menu ⋯ > "Conversa no WhatsApp" abre o WhatsApp com o telefone do cliente', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [{ id: 'ag1', data_hora: '2026-07-17T16:00:00.000Z', status: 'confirmado', cliente_id: 'c1', cliente: 'Joana', cliente_telefone: '5534999990002', servico: 'Escova', duracao_minutos: 45, preco: '40.00' }],
    });
    await page.click('.inicio-atendimento-item[data-id="ag1"] .ds-acoes-btn');
    await page.click('.inicio-atendimento-item[data-id="ag1"] .ds-acoes-item[data-acao="conversa"]');
    const opens = await page.evaluate(() => window.__opens);
    expect(opens).toEqual(['https://wa.me/5534999990002']);
  });

  test('Próximos atendimentos pagina de 3 em 3', async ({ page }) => {
    const dia = Array.from({ length: 5 }, (_, i) => ({
      id: `ag${i}`,
      data_hora: `2026-07-17T${16 + i}:00:00.000Z`,
      status: 'confirmado',
      cliente_id: `c${i}`,
      cliente: `Cliente ${i}`,
      cliente_telefone: `553499999000${i}`,
      servico: 'Corte',
      duracao_minutos: 30,
      preco: '50.00',
    }));
    await entrarNoPainel(page, { dia });

    await expect(page.locator('.inicio-atendimento-item')).toHaveCount(3);
    await expect(page.locator('.inicio-paginacao')).toContainText('1 de 2');

    await page.click('[data-inicio-pagina="proxima"]');
    await expect(page.locator('.inicio-atendimento-item')).toHaveCount(2);
    await expect(page.locator('.inicio-paginacao')).toContainText('2 de 2');
    await expect(page.locator('[data-inicio-pagina="proxima"]')).toBeDisabled();

    await page.click('[data-inicio-pagina="anterior"]');
    await expect(page.locator('.inicio-atendimento-item')).toHaveCount(3);
  });

  test('Seção "Atendimento agente Kyvvo" só aparece quando o backend manda atendimento_ia (tecnologia=ia)', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [],
      resumo: { atendimento_ia: { conversas_hoje: 12, nao_concluiram_hoje: 4, concluidos_hoje: 5, minutos_economizados_hoje: 150 } },
    });
    const secao = page.locator('.inicio-secao', { hasText: 'Atendimento agente Kyvvo' });
    await expect(secao).toContainText('12');
    await expect(secao).toContainText('4');
    await expect(secao).toContainText('5');
    await expect(secao).toContainText('150');
  });

  test('Seção "Atendimento agente Kyvvo" some quando atendimento_ia é null (tecnologia=bot)', async ({ page }) => {
    await entrarNoPainel(page, { dia: [], resumo: { atendimento_ia: null } });
    await expect(page.locator('.inicio-secao', { hasText: 'Atendimento agente Kyvvo' })).toHaveCount(0);
  });

  test('Seção "Oportunidades" mostra os atalhos "Ver clientes" e "Preencher agenda"', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [],
      resumo: { oportunidades: { clientes_sem_retorno: 23, horarios_livres_amanha: 2 } },
    });
    const secao = page.locator('.inicio-secao', { hasText: 'Oportunidades' });
    await expect(secao).toContainText('23 clientes sem retorno');
    await expect(secao).toContainText('2 horários livres amanhã');

    await page.route('**/api/clientes', (route) => route.fulfill({ json: { clientes: [] } }));
    await page.click('[data-acao-atalho-inicio="clientes"]');
    await expect(page.locator('.nav-periodo strong')).toHaveText('Clientes');
  });

  test('Seção "Financeiro" mostra faturado do mês e variação, só quando o backend manda o campo', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [],
      resumo: { financeiro: { faturado_mes: 8420, variacao_pct: 12 } },
    });
    const secao = page.locator('.inicio-secao', { hasText: 'Financeiro' });
    await expect(secao).toContainText('R$ 8420,00');
    await expect(secao).toContainText('+12%');
  });

  test('olho oculta e mostra os valores (Previsto, faturado e variação) e lembra a escolha ao recarregar', async ({ page }) => {
    await entrarNoPainel(page, {
      dia: [],
      resumo: { previsto_hoje: 650, financeiro: { faturado_mes: 8420, variacao_pct: 12 } },
    });
    const pagina = page.locator('.inicio-pagina');
    const olho = page.locator('#btn-inicio-olho');
    await expect(pagina).toContainText('R$ 650,00');
    await expect(pagina).toContainText('R$ 8420,00');
    await expect(olho).toHaveAttribute('aria-label', 'Ocultar valores');

    await olho.click();
    await expect(pagina).not.toContainText('R$ 650,00');
    await expect(pagina).not.toContainText('R$ 8420,00');
    await expect(pagina.locator('.badge-variacao-positiva')).toBeHidden();
    await expect(pagina.locator('.inicio-valor')).toHaveText(['R$ ••••', 'R$ ••••']);
    await expect(olho).toHaveAttribute('aria-pressed', 'true');
    await expect(olho).toHaveAttribute('aria-label', 'Mostrar valores');

    // sai da tela e volta: o render do Início relê a preferência salva
    await page.click('.menu-item[data-menu="agendamento"]');
    await page.click('.menu-item[data-menu="inicio"]');
    await expect(page.locator('.inicio-pagina')).not.toContainText('R$ 650,00');

    await page.locator('#btn-inicio-olho').click();
    await expect(page.locator('.inicio-pagina')).toContainText('R$ 650,00');
    await expect(page.locator('.badge-variacao-positiva')).toBeVisible();
  });

  test('Seção "Financeiro" some quando o backend manda null (sem módulo ativo ou operador)', async ({ page }) => {
    await entrarNoPainel(page, { dia: [], resumo: { financeiro: null } });
    await expect(page.locator('.inicio-secao', { hasText: 'Financeiro' })).toHaveCount(0);
  });
});

test.describe('Clientes (US63)', () => {
  async function entrarEmClientes(page, clientes = []) {
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' } })
    );
    await page.route('**/api/agendamentos**', (route) =>
      route.fulfill({ json: { view: 'dia', data: '2026-07-17', agendamentos: [] } })
    );
    await page.route('**/api/clientes', (route) => route.fulfill({ json: { clientes } }));
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');
    await page.click('.menu-item[data-menu="clientes"]');
  }

  test('lista os clientes com nome, telefone e total de agendamentos confirmados', async ({ page }) => {
    await entrarEmClientes(page, [{ id: 'c1', nome: 'Maria', telefone: '34999998888', total_agendamentos: 3 }]);
    const item = page.locator('.agendamento-item');
    await expect(item).toContainText('Cliente: Maria');
    await expect(item).toContainText('Telefone: 34999998888');
    await expect(item).toContainText('3 agendamentos confirmados');
  });

  test('cliente sem nome mostra "Sem nome"', async ({ page }) => {
    await entrarEmClientes(page, [{ id: 'c1', nome: null, telefone: '34999998888', total_agendamentos: 0 }]);
    await expect(page.locator('.agendamento-item')).toContainText('Cliente: Sem nome');
  });

  test('sem clientes cadastrados, mostra mensagem vazia orientando o próximo passo', async ({ page }) => {
    await entrarEmClientes(page, []);
    await expect(page.locator('.vazio')).toContainText('Os clientes aparecem aqui assim que o primeiro agendamento é feito');
  });
});
