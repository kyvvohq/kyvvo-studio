const { test, expect } = require('@playwright/test');

// Cobre US02.5 (nome do dia da semana abaixo da data na view Dia) e US02.6
// (view Mês lista horário-duração de cada agendamento, empilhados na célula,
// em vez de só uma contagem). As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, { dia, mes, configuracao } = {}) {
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
    if (view === 'mes') return route.fulfill({ json: { view: 'mes', mes: '2026-07', agendamentos: mes || [] } });
    return route.fulfill({ json: { view: 'dia', data: '2026-07-08', agendamentos: dia || [] } });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
}

test.describe('View Dia — nome do dia da semana (US02.5)', () => {
  test('mostra o nome do dia da semana logo abaixo da data', async ({ page }) => {
    await entrarNoPainel(page);
    // A view Dia abre direto na data de hoje (não fixada em teste), então só
    // valida que o elemento existe e tem algum dia da semana em pt-BR.
    const diaSemana = page.locator('.nav-periodo-dia-semana');
    await expect(diaSemana).toBeVisible();
    await expect(diaSemana).toHaveText(/segunda|terça|quarta|quinta|sexta|sábado|domingo/i);
  });
});

test.describe('formatarDataISO — fuso de Brasília, não UTC', () => {
  test('perto da meia-noite UTC (21h-23h59 em Brasília) a agenda busca o dia certo, não o de amanhã', async ({ page }) => {
    // 23h30 em Brasília (17/07) = 02h30 UTC do dia 18/07 — cenário exato do
    // bug: toISOString() sozinho devolveria "2026-07-18".
    await page.clock.install({ time: new Date('2026-07-17T23:30:00-03:00') });

    let dataRequisitada = null;
    await page.route('**/api/configuracao', (route) =>
      route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', horario_abertura: '08:00:00', horario_fechamento: '20:00:00' } })
    );
    await page.route('**/api/agendamentos**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('view') === 'dia') dataRequisitada = url.searchParams.get('data');
      return route.fulfill({ json: { view: 'dia', data: url.searchParams.get('data'), agendamentos: [] } });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
      window.localStorage.setItem('kyvvo_nome', 'Ana');
    });
    await page.goto('/painel.html');

    await expect(page.locator('.nav-periodo-data strong')).toContainText('17 de julho de 2026');
    expect(dataRequisitada).toBe('2026-07-17');
  });
});

test.describe('View Dia — grade de horários (PR2/PR8 — hora em hora)', () => {
  test('mostra uma linha por horário do intervalo configurado', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { horario_abertura: '09:00:00', horario_fechamento: '11:00:00' },
    });
    const linhas = page.locator('.grade-linha');
    // 09:00, 10:00 — hora em hora até (exclusive) 11:00.
    await expect(linhas).toHaveCount(2);
    await expect(linhas.nth(0).locator('.grade-linha-hora')).toHaveText('09:00');
    await expect(linhas.nth(1).locator('.grade-linha-hora')).toHaveText('10:00');
  });

  test('horário de almoço não aparece como linha disponível', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: {
        horario_abertura: '09:00:00', horario_fechamento: '12:00:00',
        horario_almoco_ativo: true, horario_almoco_inicio: '10:00:00', horario_almoco_fim: '11:00:00',
      },
    });
    const horarios = await page.locator('.grade-linha-hora').allTextContents();
    expect(horarios).toEqual(['09:00', '11:00']);
  });

  test('agendamento numa meia-hora (14:30) cai no bucket "14:00" e mostra o horário exato no card', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { horario_abertura: '13:00:00', horario_fechamento: '16:00:00' },
      dia: [{
        id: 'ag-meia-hora', data_hora: '2026-07-08T17:30:00.000Z', status: 'confirmado', encaixe: false,
        cliente: 'Carla', profissional: 'Bruna', servico: 'Escova', duracao_minutos: 30, preco: '40.00',
      }],
    });
    // 17:30 UTC = 14:30 Brasília — sem linha própria "14:30" na grade horária,
    // precisa entrar dentro da linha "14:00".
    const linha = page.locator('.grade-linha').filter({ hasText: '14:00' });
    await expect(linha.locator('.grade-ag-servico')).toHaveText('Escova');
    await expect(linha.locator('.grade-ag-meta')).toContainText('14:30');
  });

  test('agendamento aparece na linha do horário com serviço, cliente, duração, valor e profissional', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { horario_abertura: '09:00:00', horario_fechamento: '11:00:00' },
      dia: [{
        id: 'ag1', data_hora: '2026-07-08T13:00:00.000Z', status: 'confirmado', encaixe: false,
        cliente: 'Maria Silva', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00',
      }],
    });
    // 13:00 UTC = 10:00 Brasília.
    const linha = page.locator('.grade-linha').filter({ hasText: '10:00' });
    await expect(linha.locator('.grade-ag-servico')).toHaveText('Corte');
    await expect(linha.locator('.grade-ag-cliente')).toHaveText('Maria Silva');
    await expect(linha.locator('.grade-ag-meta')).toContainText('30min');
    await expect(linha.locator('.grade-ag-meta')).toContainText('R$ 50,00');
    await expect(linha.locator('.grade-ag-meta')).toContainText('Bruna');
  });

  test('dois agendamentos no mesmo horário (profissionais diferentes) dividem a linha', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { horario_abertura: '09:00:00', horario_fechamento: '11:00:00' },
      dia: [
        { id: 'ag1', data_hora: '2026-07-08T13:00:00.000Z', status: 'confirmado', cliente: 'Maria', profissional: 'Bruna', servico: 'Corte', duracao_minutos: 30, preco: '50.00' },
        { id: 'ag2', data_hora: '2026-07-08T13:00:00.000Z', status: 'confirmado', cliente: 'Joana', profissional: 'Ana', servico: 'Escova', duracao_minutos: 45, preco: '40.00' },
      ],
    });
    const linha = page.locator('.grade-linha').filter({ hasText: '10:00' });
    await expect(linha.locator('.grade-ag-card')).toHaveCount(2);
    await expect(linha.locator('.grade-ag-grupo')).toHaveAttribute('style', /repeat\(2/);
  });

  test('hover no horário mostra "+" e abre novo agendamento pré-preenchido com data e hora', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { horario_abertura: '09:00:00', horario_fechamento: '10:00:00' },
    });
    const linha = page.locator('.grade-linha').filter({ hasText: '09:00' });
    await linha.hover();
    await linha.locator('.grade-linha-add').click();
    await expect(page.locator('#form-novo-agendamento')).toBeVisible();
    const dataValue = await page.locator('#novo-ag-data').inputValue();
    expect(dataValue).toBeTruthy();
  });

  test('Anterior/Próximo pulam dia fechado', async ({ page }) => {
    await entrarNoPainel(page, {
      configuracao: { dias_funcionamento: [1, 2, 3, 4, 5] }, // sábado e domingo fechados
    });
    // Não afirma qual dia exato (depende da data real do teste), só que o
    // rótulo do dia da semana nunca é sábado/domingo depois de navegar.
    for (let i = 0; i < 8; i++) {
      await page.click('[data-nav="1"]');
      await expect(page.locator('.nav-periodo-dia-semana')).not.toHaveText(/sábado|domingo/i);
    }
  });
});

test.describe('View Mês — componente .agenda-mes do DS', () => {
  test('dia com um agendamento mostra o card compacto (cliente + serviço)', async ({ page }) => {
    await entrarNoPainel(page, {
      mes: [{
        id: 'ag1', data_hora: '2026-07-10T14:00:00.000Z', status: 'confirmado', duracao_minutos: 30,
        cliente: 'Maria Silva', profissional: 'Bruna', servico: 'Corte', preco: '50.00',
      }],
    });
    await page.click('.agenda-visao[data-tab="mes"]');

    const cel = page.locator('.agenda-mes-celula').filter({ has: page.locator('.agenda-dia-num', { hasText: /^10$/ }) });
    await expect(cel.locator('.agenda-card-cliente')).toHaveText('Maria Silva');
    await expect(cel.locator('.agenda-card-servico')).toContainText('Corte');
  });

  test('dia com mais agendamentos do que cabe no card mostra "+N mais"', async ({ page }) => {
    const item = (hora, id) => ({
      id, data_hora: `2026-07-10T${hora}:00:00.000Z`, status: 'confirmado', duracao_minutos: 30,
      cliente: `Cliente ${id}`, profissional: 'Bruna', servico: 'Corte', preco: '50.00',
    });
    await entrarNoPainel(page, {
      mes: [item('11', 'ag1'), item('14', 'ag2'), item('16', 'ag3'), item('18', 'ag4')],
    });
    await page.click('.agenda-visao[data-tab="mes"]');

    const cel = page.locator('.agenda-mes-celula').filter({ has: page.locator('.agenda-dia-num', { hasText: /^10$/ }) });
    // MAX_VISIVEIS = 3 (renderMesGrade) — o 4º vira "+1 mais".
    await expect(cel.locator('.agenda-card-s')).toHaveCount(3);
    await expect(cel.locator('.agenda-mais')).toHaveText('+1 mais');
  });

  test('"+N mais" leva pra visão Dia daquele dia', async ({ page }) => {
    const item = (hora, id) => ({
      id, data_hora: `2026-07-10T${hora}:00:00.000Z`, status: 'confirmado', duracao_minutos: 30,
      cliente: `Cliente ${id}`, profissional: 'Bruna', servico: 'Corte', preco: '50.00',
    });
    await entrarNoPainel(page, {
      mes: [item('11', 'ag1'), item('14', 'ag2'), item('16', 'ag3'), item('18', 'ag4')],
    });
    await page.click('.agenda-visao[data-tab="mes"]');
    await page.locator('.agenda-mais').click();

    await expect(page.locator('.agenda-visao-ativa')).toHaveText('Dia');
  });

  test('dia sem agendamentos não mostra card nenhum', async ({ page }) => {
    await entrarNoPainel(page, { mes: [] });
    await page.click('.agenda-visao[data-tab="mes"]');

    const cel = page.locator('.agenda-mes-celula').filter({ has: page.locator('.agenda-dia-num', { hasText: /^15$/ }) });
    await expect(cel.locator('.agenda-card-s')).toHaveCount(0);
  });

  test('dia fechado (Configuração > Dias de funcionamento) nem vira coluna', async ({ page }) => {
    await entrarNoPainel(page, { mes: [], configuracao: { dias_funcionamento: [1, 2, 3, 4, 5, 6] } }); // domingo fechado
    await page.click('.agenda-visao[data-tab="mes"]');

    const cabecalho = await page.locator('.agenda-mes-cab').allTextContents();
    expect(cabecalho).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
  });

  test('hover num dia mostra "+" que abre novo agendamento pré-preenchido', async ({ page }) => {
    await entrarNoPainel(page, { mes: [] });
    await page.click('.agenda-visao[data-tab="mes"]');

    const cel = page.locator('.agenda-mes-celula').filter({ has: page.locator('.agenda-dia-num', { hasText: /^15$/ }) });
    await cel.hover();
    await cel.locator('.agenda-mes-celula-add').click();
    await expect(page.locator('#form-novo-agendamento')).toBeVisible();
    await expect(page.locator('#novo-ag-data')).toHaveValue('2026-07-15');
  });
});
