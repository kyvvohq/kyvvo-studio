const { test, expect } = require('@playwright/test');

// Cobre US61: bloqueios manuais de agenda pelo portal (listar, criar — pra
// toda a agenda ou só um profissional —, validar e excluir), agora como aba
// "Bloqueio de agenda" da tela Configurações > Cadastro. As chamadas de API
// são mockadas via page.route — sem dependência de Postgres real.

async function entrarNoPainel(page, { bloqueios = [], profissionais = [], plano = 'professional' } = {}) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/tenant/status', (route) =>
    route.fulfill({
      json: {
        role: 'administrador',
        plano,
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
  await page.route('**/api/servicos', (route) => route.fulfill({ json: { servicos: [] } }));
  await page.route('**/api/bloqueios', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { bloqueios } });
  });
  // Feriados nacionais (switch de bloqueio) — mock padrão desabilitado com
  // lista fixa de 2 itens, suficiente pros testes de CRUD de bloqueio manual
  // que não mexem nessa seção; os testes dedicados abaixo sobrescrevem.
  await page.route('**/api/feriados', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: { habilitado: false, feriados: [{ nome: 'Confraternização Universal', mes: 1, dia: 1 }, { nome: 'Natal', mes: 12, dia: 25 }] },
    });
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

async function abrirTelaBloqueios(page) {
  await page.click('#menu-config-toggle');
  await page.click('.menu-item[data-menu="cadastro"]');
  await page.click('#subtabs-cadastro .tab[data-aba-cadastro="bloqueios"]');
}

// Abre o menu "⋯" (componente .ds-acoes do design system) de uma linha de
// bloqueio e clica na ação pedida — mesmo padrão de escolherAcaoServico.
async function escolherAcaoBloqueio(page, id, acao) {
  const caixa = page.locator(`.ds-acoes[data-bloqueio-id="${id}"]`);
  await caixa.locator('.ds-acoes-btn').click();
  await caixa.locator(`.ds-acoes-item[data-acao="${acao}"]`).click();
}

test.describe('Bloqueios de agenda — CRUD (US61)', () => {
  test('lista bloqueios com período, profissional e motivo', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [
        { id: 'b1', profissional_id: 'p1', profissional: 'Bruna', inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: 'Consulta médica' },
      ],
    });
    await abrirTelaBloqueios(page);
    const linha = page.locator('tr[data-bloqueio-abrir="b1"]');
    await expect(linha).toContainText('Bruna');
    await expect(linha).toContainText('Consulta médica');
  });

  test('bloqueio sem profissional mostra "Toda a agenda"', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-21T13:00:00.000Z', motivo: null }],
    });
    await abrirTelaBloqueios(page);
    await expect(page.locator('tr[data-bloqueio-abrir="b1"]')).toContainText('Toda a agenda');
  });

  test('sem bloqueios cadastrados, mostra mensagem vazia', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await abrirTelaBloqueios(page);
    await expect(page.locator('.vazio')).toContainText('Nenhum bloqueio cadastrado');
  });

  test('cria um bloqueio de um dia só para toda a agenda (sem selecionar profissional)', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [{ id: 'p1', nome: 'Bruna' }] });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.fill('#bloqueio-motivo', 'Manutenção do salão');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.profissional_id).toBeNull();
    expect(corpoEnviado.motivo).toBe('Manutenção do salão');
    expect(corpoEnviado.inicio).toBe('2026-08-10T12:00:00.000Z');
    expect(corpoEnviado.fim).toBe('2026-08-10T15:00:00.000Z');
  });

  test('cria um bloqueio para um profissional específico', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [{ id: 'p1', nome: 'Bruna' }, { id: 'p2', nome: 'Carla' }] });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.selectOption('#bloqueio-profissional', 'p1');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.profissional_id).toBe('p1');
  });

  test('período de vários dias desabilita o horário e bloqueia o dia inteiro', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 'novo', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-15');

    await expect(page.locator('#bloqueio-hora-inicio')).toBeDisabled();
    await expect(page.locator('#bloqueio-hora-fim')).toBeDisabled();
    await expect(page.locator('#bloqueio-horario-aviso')).toContainText('o bloqueio vale o dia inteiro');

    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/criado com sucesso/);
    expect(corpoEnviado.inicio).toBe('2026-08-10T03:00:00.000Z');
    expect(corpoEnviado.fim).toBe('2026-08-16T02:59:59.000Z');
  });

  test('voltar de um período de vários dias pro mesmo dia reabilita o horário (e exige preencher de novo)', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');

    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-15');
    await expect(page.locator('#bloqueio-hora-inicio')).toBeDisabled();

    await page.fill('#bloqueio-periodo-fim', '2026-08-10');
    await expect(page.locator('#bloqueio-hora-inicio')).toBeEnabled();
    await expect(page.locator('#bloqueio-horario-aviso')).toBeEmpty();
  });

  test('campo Profissional aparece em qualquer plano exceto o Essencial, independente da quantidade de profissionais', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [{ id: 'p1', nome: 'Bruna' }], plano: 'business' });
    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await expect(page.locator('#bloqueio-profissional')).toBeVisible();
  });

  test('campo Profissional some no plano Essencial mesmo com mais de um profissional', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [],
      profissionais: [{ id: 'p1', nome: 'Bruna' }, { id: 'p2', nome: 'Carla' }],
      plano: 'starter',
    });
    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await expect(page.locator('#bloqueio-profissional')).toBeHidden();
  });

  test('fim antes ou igual ao início mostra erro sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    let chamou = false;
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      chamou = true;
      return route.fulfill({ status: 201, json: {} });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '12:00');
    await page.fill('#bloqueio-hora-fim', '09:00');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('#bloqueio-erro')).toHaveText('O fim do bloqueio deve ser depois do início.');
    expect(chamou).toBe(false);
  });

  test('conflito com agendamento existente (409) mostra o erro do backend', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [], profissionais: [] });
    await page.route('**/api/bloqueios', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 409, json: { error: 'Não é possível bloquear: há 1 agendamento(s) confirmado(s) nesse período.' } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#btn-novo-bloqueio');
    await page.fill('#bloqueio-periodo-inicio', '2026-08-10');
    await page.fill('#bloqueio-periodo-fim', '2026-08-10');
    await page.fill('#bloqueio-hora-inicio', '09:00');
    await page.fill('#bloqueio-hora-fim', '12:00');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('#bloqueio-erro')).toHaveText(/Não é possível bloquear/);
  });

  test('exclui um bloqueio e some da listagem', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: null }],
    });
    let metodoRecebido = null;
    await page.route('**/api/bloqueios/b1', (route) => {
      metodoRecebido = route.request().method();
      return route.fulfill({ json: { ok: true } });
    });

    await abrirTelaBloqueios(page);
    await escolherAcaoBloqueio(page, 'b1', 'excluir');
    await expect(page.locator('.modal-card')).toContainText('A agenda volta a ficar disponível');
    await page.click('#btn-confirmar-excluir-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/excluído com sucesso/);
    expect(metodoRecebido).toBe('DELETE');
  });

  test('clicar na linha do bloqueio abre a edição pré-preenchida', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-08-10T12:00:00.000Z', fim: '2026-08-10T15:00:00.000Z', motivo: 'Manutenção' }],
    });
    await abrirTelaBloqueios(page);
    await page.click('tr[data-bloqueio-abrir="b1"]');

    await expect(page.locator('h3')).toHaveText('Editar bloqueio');
    await expect(page.locator('#bloqueio-periodo-inicio')).toHaveValue('2026-08-10');
    await expect(page.locator('#bloqueio-hora-inicio')).toHaveValue('09:00');
    await expect(page.locator('#bloqueio-motivo')).toHaveValue('Manutenção');
  });

  test('editar um bloqueio chama PATCH em vez de POST', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-08-10T12:00:00.000Z', fim: '2026-08-10T15:00:00.000Z', motivo: 'Manutenção' }],
    });
    let metodoRecebido = null;
    let corpoEnviado = null;
    await page.route('**/api/bloqueios/b1', (route) => {
      metodoRecebido = route.request().method();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'b1', ...corpoEnviado } });
    });

    await abrirTelaBloqueios(page);
    await page.click('tr[data-bloqueio-abrir="b1"]');
    await page.fill('#bloqueio-motivo', 'Manutenção elétrica');
    await page.click('#btn-salvar-bloqueio');

    await expect(page.locator('.toast-sucesso')).toHaveText(/atualizado com sucesso/);
    expect(metodoRecebido).toBe('PATCH');
    expect(corpoEnviado.motivo).toBe('Manutenção elétrica');
  });

  test('desabilitar um bloqueio pelo kebab chama PATCH com ativo invertido', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-08-10T12:00:00.000Z', fim: '2026-08-10T15:00:00.000Z', motivo: null, ativo: true }],
    });
    let corpoEnviado = null;
    await page.route('**/api/bloqueios/b1', (route) => {
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'b1', ativo: false } });
    });

    await abrirTelaBloqueios(page);
    await escolherAcaoBloqueio(page, 'b1', 'desabilitar');

    await expect(page.locator('.toast-sucesso')).toHaveText(/desabilitado/);
    expect(corpoEnviado).toMatchObject({ ativo: false });
  });

  test('bloqueio desabilitado mostra o badge e o kebab oferece "Habilitar"', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-08-10T12:00:00.000Z', fim: '2026-08-10T15:00:00.000Z', motivo: null, ativo: false }],
    });
    await abrirTelaBloqueios(page);
    const linha = page.locator('tr[data-bloqueio-abrir="b1"]');
    await expect(linha.locator('.badge-status-inativo')).toHaveText('Desabilitado');
    const caixa = linha.locator('.ds-acoes');
    await caixa.locator('.ds-acoes-btn').click();
    await expect(caixa.locator('.ds-acoes-item[data-acao="habilitar"]')).toHaveText('Habilitar');
  });

  test('cancelar a exclusão fecha o popup sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, {
      bloqueios: [{ id: 'b1', profissional_id: null, profissional: null, inicio: '2026-07-20T13:00:00.000Z', fim: '2026-07-20T15:00:00.000Z', motivo: null }],
    });
    let chamou = false;
    await page.route('**/api/bloqueios/b1', (route) => {
      chamou = true;
      return route.fulfill({ json: { ok: true } });
    });

    await abrirTelaBloqueios(page);
    await escolherAcaoBloqueio(page, 'b1', 'excluir');
    await page.click('#btn-voltar-excluir-bloqueio');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect(chamou).toBe(false);
  });

  test('o cabeçalho "Configurações" fica destacado quando Bloqueio de agenda está ativo', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await abrirTelaBloqueios(page);
    await expect(page.locator('#menu-config-toggle')).toHaveClass(/tem-filho-ativo/);
  });
});

test.describe('Feriados nacionais — switch de bloqueio', () => {
  test('lista os feriados com nome e data DD/MM', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await page.route('**/api/feriados', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        json: {
          habilitado: false,
          feriados: [
            { nome: 'Confraternização Universal', mes: 1, dia: 1 },
            { nome: 'Tiradentes', mes: 4, dia: 21 },
            { nome: 'Natal', mes: 12, dia: 25 },
          ],
        },
      });
    });
    await abrirTelaBloqueios(page);

    const linhas = page.locator('.relatorios-status-linha');
    await expect(linhas).toHaveCount(3);
    await expect(linhas.nth(0)).toContainText('Confraternização Universal');
    await expect(linhas.nth(0)).toContainText('01/01');
    await expect(linhas.nth(2)).toContainText('Natal');
    await expect(linhas.nth(2)).toContainText('25/12');
  });

  test('desabilitado por padrão mostra o texto "Habilitar" no switch', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await abrirTelaBloqueios(page);
    await expect(page.locator('#toggle-feriados')).not.toBeChecked();
    await expect(page.locator('#toggle-feriados-texto')).toHaveText('Habilitar');
  });

  test('habilitar pede confirmação antes de chamar a API', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    let chamou = false;
    await page.route('**/api/feriados', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      chamou = true;
      return route.fulfill({ json: { habilitado: true, agendamentos_movidos: 0 } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#toggle-feriados');
    await expect(page.locator('.modal-card')).toContainText('movido automaticamente para o primeiro dia útil disponível');
    expect(chamou).toBe(false);

    await page.click('#btn-confirmar-feriados');
    await expect(page.locator('.toast-sucesso')).toContainText('Feriados nacionais bloqueados');
    expect(chamou).toBe(true);
  });

  test('cancelar a confirmação desmarca o switch de novo sem chamar a API', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    let chamou = false;
    await page.route('**/api/feriados', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      chamou = true;
      return route.fulfill({ json: { habilitado: true, agendamentos_movidos: 0 } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#toggle-feriados');
    await page.click('#btn-cancelar-feriados');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('#toggle-feriados')).not.toBeChecked();
    expect(chamou).toBe(false);
  });

  test('habilitar com agendamentos movidos mostra a contagem no toast', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await page.route('**/api/feriados', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ json: { habilitado: true, agendamentos_movidos: 3 } });
    });

    await abrirTelaBloqueios(page);
    await page.click('#toggle-feriados');
    await page.click('#btn-confirmar-feriados');

    await expect(page.locator('.toast-sucesso')).toContainText('3 agendamento(s) movido(s) para o primeiro dia útil disponível');
  });

  test('desabilitar não pede confirmação', async ({ page }) => {
    await entrarNoPainel(page, { bloqueios: [] });
    await page.route('**/api/feriados', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { habilitado: true, feriados: [] } });
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ json: { habilitado: false, agendamentos_movidos: 0 } });
    });

    await abrirTelaBloqueios(page);
    await expect(page.locator('#toggle-feriados')).toBeChecked();
    await page.click('#toggle-feriados');

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.toast-sucesso')).toContainText('Feriados nacionais liberados');
  });
});
