const { test, expect } = require('@playwright/test');

// Quadro (kanban: colunas = profissionais) — filtros por profissional e por
// serviço, e a linha vermelha de "agora" (só aparece no dia de hoje, dentro
// do horário comercial). API mockada via page.route — sem Postgres real.

const PROFISSIONAIS = [{ id: 'p1', nome: 'Ana' }, { id: 'p2', nome: 'Bia' }];
const SERVICOS = [{ id: 's1', nome: 'Corte' }, { id: 's2', nome: 'Escova' }];
const AGENDAMENTOS = [
  {
    id: 'a1', data_hora: '2026-07-17T14:00:00-03:00', status: 'confirmado', encaixe: false,
    cliente_id: 'c1', cliente: 'Cliente Um', cliente_telefone: '5511999990001',
    profissional_id: 'p1', profissional: 'Ana', servico_id: 's1', servico: 'Corte', duracao_minutos: 30, preco: 50,
  },
  {
    id: 'a2', data_hora: '2026-07-17T14:00:00-03:00', status: 'confirmado', encaixe: false,
    cliente_id: 'c2', cliente: 'Cliente Dois', cliente_telefone: '5511999990002',
    profissional_id: 'p2', profissional: 'Bia', servico_id: 's2', servico: 'Escova', duracao_minutos: 30, preco: 60,
  },
];

async function entrarNoQuadro(page, { agendamentos = AGENDAMENTOS, hora = '2026-07-17T14:15:00-03:00' } = {}) {
  await page.clock.install({ time: new Date(hora) });
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: {
      dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h',
      horario_abertura: '08:00:00', horario_fechamento: '20:00:00', horario_almoco_ativo: false,
    } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({ json: { role: 'administrador', plano: 'professional', status: 'ativo', email_verified: true, onboarding_dispensado: true, configuracao: {} } })
  );
  await page.route('**/api/tenant/modulos', (route) => route.fulfill({ json: { modulos: [] } }));
  await page.route('**/api/profissionais', (route) => route.fulfill({ json: { profissionais: PROFISSIONAIS } }));
  await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: SERVICOS } }));
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.menu-item[data-menu="quadro"]');
}

test.describe('Quadro — filtros e linha de agora', () => {
  test('sem filtro, mostra os 2 profissionais e os 2 agendamentos', async ({ page }) => {
    await entrarNoQuadro(page);
    await expect(page.locator('.quadro-cab')).toHaveCount(2);
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Um');
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Dois');
  });

  test('filtro por profissional deixa só a coluna dele', async ({ page }) => {
    await entrarNoQuadro(page);
    await page.selectOption('#quadro-filtro-profissional', 'p1');
    await expect(page.locator('.quadro-cab')).toHaveCount(1);
    await expect(page.locator('.quadro-cab')).toContainText('Ana');
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Um');
    await expect(page.locator('.quadro-grade')).not.toContainText('Cliente Dois');
  });

  test('filtro por serviço esconde o agendamento de outro serviço (célula some "Disponível")', async ({ page }) => {
    await entrarNoQuadro(page);
    await page.selectOption('#quadro-filtro-servico', 's2');
    // Continuam as 2 colunas (o filtro de serviço não mexe em profissionais)...
    await expect(page.locator('.quadro-cab')).toHaveCount(2);
    // ...mas só o agendamento de Escova (s2) aparece; o de Corte (s1) some.
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Dois');
    await expect(page.locator('.quadro-grade')).not.toContainText('Cliente Um');
  });

  test('no dia de hoje, dentro do horário comercial, mostra a linha de agora', async ({ page }) => {
    await entrarNoQuadro(page);
    await expect(page.locator('.quadro-linha-agora')).toBeVisible();
  });

  test('fora do horário comercial (antes de abrir), não mostra a linha de agora', async ({ page }) => {
    await entrarNoQuadro(page, { hora: '2026-07-17T06:00:00-03:00' });
    await expect(page.locator('.quadro-linha-agora')).toHaveCount(0);
  });
});
