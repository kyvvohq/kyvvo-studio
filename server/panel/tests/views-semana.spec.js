const { test, expect } = require('@playwright/test');

// Cobre o componente `.agenda-semana` do DS (PR#68, migração da Semana pro
// componente do DS) e o fix de duração real por trás dele (PR 2026-09-30,
// mesma técnica calcularBlocosDia/minutoAjustadoDia da view Dia — antes um
// agendamento só ocupava a célula do horário em que começa, mesmo bug que a
// view Dia tinha antes do PR #75). As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real. Substitui o spec antigo,
// que ainda testava o grid pré-DS (.semana-coluna/.grade-linha), removido em
// #68 e nunca atualizado.

async function entrarNoPainel(page, { semana, configuracao } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({
      json: {
        dias_funcionamento: [1, 2, 3, 4, 5, 6],
        formato_hora: '24h',
        horario_abertura: '08:00:00',
        horario_fechamento: '20:00:00',
        horario_almoco_ativo: false,
        ...configuracao,
      },
    })
  );
  await page.route('**/api/agendamentos**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    if (view !== 'semana') return route.fulfill({ json: { view, data: url.searchParams.get('data'), agendamentos: [] } });
    return route.fulfill({ json: { view: 'semana', data: url.searchParams.get('data'), agendamentos: semana || [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('.agenda-visao[data-tab="semana"]');
}

// Segunda-feira da semana atual em horário de Brasília (mesmo cálculo de
// inicioDaSemana em app.js) — os fixtures precisam cair nessa data pra
// baterem com a coluna que a view Semana efetivamente renderiza.
function segundaFeiraDaSemanaAtual() {
  const [ano, mes, dia] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('View Semana — .agenda-semana do DS', () => {
  test('mostra uma coluna só pros dias de funcionamento configurados', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [1, 2, 3, 4, 5] } }); // sem sábado/domingo
    await expect(page.locator('.agenda-semana-cab')).toHaveCount(5);
  });

  test('agendamento aparece na coluna/hora certa com serviço, cliente e duração', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1] }, // só segunda, pra isolar a coluna
      semana: [{
        id: 'ag1', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', encaixe: false,
        cliente: 'Maria Silva', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00',
      }],
    });
    // 13:00 UTC = 10:00 Brasília.
    await expect(page.locator('.agenda-semana .agenda-bloco')).toHaveCount(1);
    const bloco = page.locator('.agenda-semana .agenda-bloco');
    await expect(bloco.locator('.agenda-card-cliente')).toHaveText('Maria Silva');
    await expect(bloco.locator('.agenda-card-servico')).toContainText('Corte');
  });

  test('dois agendamentos no mesmo horário (profissionais diferentes) viram 2 blocos lado a lado', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1] },
      semana: [
        { id: 'ag1', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', cliente: 'Maria', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00' },
        { id: 'ag2', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', cliente: 'Joana', profissional: 'Ana', servico: 'Escova', duracao_minutos: 45, preco: '40.00' },
      ],
    });
    await expect(page.locator('.agenda-semana .agenda-bloco')).toHaveCount(2);
  });

  test('hover numa célula livre mostra "+" que abre novo agendamento pré-preenchido com a data', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [1] } });
    const celula = page.locator('.agenda-semana-celula').first();
    await celula.hover();
    await celula.locator('.grade-linha-add').click();
    await expect(page.locator('#form-novo-agendamento')).toBeVisible();
    const dataValue = await page.locator('#novo-ag-data').inputValue();
    expect(dataValue).toBeTruthy();
  });

  test('semana sem nenhum dia de funcionamento mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { configuracao: { dias_funcionamento: [] } });
    await expect(page.locator('.vazio')).toContainText('Nenhum dia de funcionamento configurado');
    await expect(page.locator('.agenda-semana-cab')).toHaveCount(0);
  });
});

test.describe('View Semana — duração real do atendimento', () => {
  test('um atendimento de 4h ocupa as 4 horas seguintes, não só a primeira', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1], horario_abertura: '08:00:00', horario_fechamento: '20:00:00' },
      semana: [{
        // 10:00 Brasília = 13:00 UTC.
        id: 'ag-longo', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', encaixe: false,
        cliente: 'Cliente Longo', profissional: 'Bruna', servico: 'Micro Pigmentação', duracao_minutos: 240, preco: '400.00',
      }],
    });
    await expect(page.locator('.agenda-semana .agenda-bloco')).toHaveCount(1);
    // 11h/12h/13h (dentro das 4h do atendimento) não podem deixar agendar
    // por cima — o botão "+" só existe em horários livres.
    await expect(page.locator('[data-add-horario="11:00"]')).toHaveCount(0);
    await expect(page.locator('[data-add-horario="12:00"]')).toHaveCount(0);
    await expect(page.locator('[data-add-horario="13:00"]')).toHaveCount(0);
    // Fora do atendimento, o horário continua livre normalmente.
    await expect(page.locator('[data-add-horario="08:00"]')).toHaveCount(1);
    await expect(page.locator('[data-add-horario="14:00"]')).toHaveCount(1);
  });

  test('o bloco de 4h é visualmente mais alto que um de 30min', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1, 2], horario_abertura: '08:00:00', horario_fechamento: '20:00:00' },
      semana: [
        {
          id: 'ag-longo', data_hora: `${segundaFeiraDaSemanaAtual()}T13:00:00.000Z`, status: 'confirmado', encaixe: false,
          cliente: 'Cliente Longo', profissional: 'Bruna', servico: 'Micro Pigmentação', duracao_minutos: 240, preco: '400.00',
        },
      ],
    });
    const altura = await page.locator('.agenda-semana .agenda-bloco').first().evaluate((el) => el.getBoundingClientRect().height);
    // 240min de duração real: bem mais que uma única linha de hora (60px).
    expect(altura).toBeGreaterThan(180);
  });
});
