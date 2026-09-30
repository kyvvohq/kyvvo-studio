const { test, expect } = require('@playwright/test');

// Quadro (kanban: colunas = profissionais) — sem filtros (removidos no PR#85,
// o Quadro sempre mostra todos os profissionais/agendamentos), linha vermelha
// de "agora" (só no dia de hoje, dentro do horário comercial) e blocos de
// duração real (PR 2026-09-30, mesma técnica da view Dia — ver
// calcularBlocosDia/minutoAjustadoDia no app.js). API mockada via
// page.route — sem Postgres real.

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

test.describe('Quadro — colunas e linha de agora', () => {
  test('mostra os 2 profissionais e os 2 agendamentos', async ({ page }) => {
    await entrarNoQuadro(page);
    await expect(page.locator('.quadro-cab')).toHaveCount(2);
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Um');
    await expect(page.locator('.quadro-grade')).toContainText('Cliente Dois');
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

test.describe('Quadro — duração real do atendimento', () => {
  const AGENDAMENTO_LONGO = [{
    id: 'a3', data_hora: '2026-07-17T10:00:00-03:00', status: 'confirmado', encaixe: false,
    cliente_id: 'c3', cliente: 'Cliente Longo', cliente_telefone: '5511999990003',
    profissional_id: 'p1', profissional: 'Ana', servico_id: 's1', servico: 'Micro Pigmentação', duracao_minutos: 240, preco: 400,
  }];

  test('um atendimento de 4h ocupa as 4 horas seguintes, não só a primeira', async ({ page }) => {
    await entrarNoQuadro(page, { agendamentos: AGENDAMENTO_LONGO, hora: '2026-07-17T09:00:00-03:00' });
    // Só 1 bloco desenhado (não um card recortado por hora).
    await expect(page.locator('.quadro-grade .agenda-bloco')).toHaveCount(1);
    // 11h/12h/13h (dentro das 4h do atendimento) não podem deixar agendar por
    // cima — o botão "+" só existe em horários livres.
    await expect(page.locator('[data-add-horario="11:00"]')).toHaveCount(0);
    await expect(page.locator('[data-add-horario="12:00"]')).toHaveCount(0);
    await expect(page.locator('[data-add-horario="13:00"]')).toHaveCount(0);
    // Fora do atendimento, o horário continua livre normalmente.
    await expect(page.locator('[data-add-horario="08:00"]')).toHaveCount(1);
    await expect(page.locator('[data-add-horario="14:00"]')).toHaveCount(1);
  });

  test('o bloco de 4h é visualmente mais alto que um de 30min', async ({ page }) => {
    await entrarNoQuadro(page, {
      agendamentos: [...AGENDAMENTO_LONGO, AGENDAMENTOS[1]],
      hora: '2026-07-17T09:00:00-03:00',
    });
    const alturaLonga = await page.locator('.quadro-grade .agenda-bloco').first().evaluate((el) => el.getBoundingClientRect().height);
    // 240min de duração real: bem mais que uma única linha de hora (60px).
    expect(alturaLonga).toBeGreaterThan(180);
  });
});
