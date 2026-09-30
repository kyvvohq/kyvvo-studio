const { test, expect } = require('@playwright/test');

// Cobre PR12: "Minha Empresa" (dados do negócio) — nasceu dividindo os
// campos de negócio que antes viviam junto com Meu Perfil. Nome do
// [segmento] com label dinâmico, Endereço estruturado com máscara de CEP e
// autopreenchimento via ViaCEP. As chamadas de API são mockadas via
// page.route — sem dependência de Postgres real nem da API pública do
// ViaCEP (também mockada).

const PERFIL_BASE = {
  nome_responsavel: 'Ana Souza',
  email: 'ana@exemplo.com',
  nome_segmento: 'Salão da Ana',
  segmento: 'salao_beleza',
  telefone: '34999998888',
  whatsapp: '34988887777',
  endereco_cep: '38400000',
  endereco_logradouro: 'Rua das Flores',
  endereco_numero: '100',
  endereco_complemento: null,
  endereco_bairro: 'Centro',
  endereco_cidade: 'Uberlândia',
  endereco_uf: 'MG',
};

async function entrarNoPainel(page, perfil = PERFIL_BASE) {
  await page.route('**/api/configuracao', (route) =>
    route.fulfill({ json: { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h', segmento: 'salao_beleza' } })
  );
  await page.route('**/api/agendamentos**', (route) =>
    route.fulfill({ json: { view: 'dia', data: '2026-07-09', agendamentos: [] } })
  );
  await page.route('**/api/perfil', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: perfil });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('kyvvo_token', 'fake-jwt-token');
    window.localStorage.setItem('kyvvo_nome', 'Ana');
  });
  await page.goto('/painel.html');
  await page.click('#menu-config-toggle');
  await page.click('.menu-item[data-menu="empresa"]');
}

test.describe('Minha Empresa (PR12)', () => {
  test('pré-preenche o formulário com os dados atuais, CEP já mascarado', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_segmento')).toHaveValue('Salão da Ana');
    await expect(page.locator('#endereco-cep')).toHaveValue('38400-000');
    await expect(page.locator('#endereco-logradouro')).toHaveValue('Rua das Flores');
    await expect(page.locator('#endereco-uf')).toHaveValue('MG');
  });

  test('não mostra mais os campos pessoais (Nome do Responsável/Telefone/E-mail, agora em Meu Perfil)', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#nome_responsavel')).toHaveCount(0);
    await expect(page.locator('#telefone')).toHaveCount(0);
  });

  test('label do Nome do [segmento] é dinâmico conforme o segmento do tenant', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, segmento: 'petshop' });
    await expect(page.locator('label[for="nome_segmento"]')).toContainText('Nome do petshop');
  });

  test('campos obrigatórios mostram asterisco vermelho, Complemento não', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('label[for="nome_segmento"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="endereco-cep"] .obrigatorio')).toHaveText('*');
    await expect(page.locator('label[for="endereco-complemento"] .obrigatorio')).toHaveCount(0);
  });

  test('botão Salvar começa desabilitado e só habilita com uma alteração de fato', async ({ page }) => {
    await entrarNoPainel(page);
    await expect(page.locator('#btn-salvar-empresa')).toBeDisabled();
    await page.fill('#nome_segmento', 'Salão da Ana 2');
    await expect(page.locator('#btn-salvar-empresa')).toBeEnabled();
  });

  test('endereço incompleto mostra mensagem única de erro (CA03/CA04)', async ({ page }) => {
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_bairro: '' });
    // Botão Salvar só habilita com alguma alteração de fato — reafirma o
    // número (não é o que falta) só pra tirar o botão do estado desabilitado.
    await page.fill('#endereco-numero', PERFIL_BASE.endereco_numero + '1');
    await page.click('#btn-salvar-empresa');
    await expect(page.locator('#erro-endereco')).toHaveText('Preencha todos os campos do endereço.');
  });

  test('CEP preenchido autocompleta o endereço via ViaCEP (CA04)', async ({ page }) => {
    await page.route('https://viacep.com.br/**', (route) =>
      route.fulfill({
        json: { logradouro: 'Avenida Central', bairro: 'Bairro Novo', localidade: 'Uberaba', uf: 'MG' },
      })
    );
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_cep: '', endereco_logradouro: '', endereco_bairro: '', endereco_cidade: '', endereco_uf: '' });

    await page.fill('#endereco-cep', '38010000');
    await page.locator('#endereco-cep').blur();

    await expect(page.locator('#endereco-logradouro')).toHaveValue('Avenida Central');
    await expect(page.locator('#endereco-bairro')).toHaveValue('Bairro Novo');
    await expect(page.locator('#endereco-cidade')).toHaveValue('Uberaba');
    await expect(page.locator('#endereco-uf')).toHaveValue('MG');
  });

  test('CEP não encontrado mostra aviso pra preencher manualmente (CA04)', async ({ page }) => {
    await page.route('https://viacep.com.br/**', (route) => route.fulfill({ json: { erro: true } }));
    await entrarNoPainel(page, { ...PERFIL_BASE, endereco_cep: '' });

    await page.fill('#endereco-cep', '00000000');
    await page.locator('#endereco-cep').blur();

    await expect(page.locator('#erro-endereco')).toHaveText('CEP não encontrado. Preencha o endereço manualmente.');
  });

  test('salva as alterações com sucesso, sem mandar campos pessoais no payload', async ({ page }) => {
    await entrarNoPainel(page);
    let corpoEnviado = null;
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      corpoEnviado = route.request().postDataJSON();
      return route.fulfill({ json: { ...PERFIL_BASE, nome_segmento: 'Salão da Ana 2' } });
    });

    await page.fill('#nome_segmento', 'Salão da Ana 2');
    await page.click('#btn-salvar-empresa');

    await expect(page.locator('.toast-sucesso')).toHaveText(/Dados da empresa atualizados com sucesso/);
    expect(corpoEnviado).toMatchObject({ nome_segmento: 'Salão da Ana 2' });
    expect(corpoEnviado.endereco).toMatchObject({ cep: '38400-000', cidade: 'Uberlândia', uf: 'MG' });
    expect(corpoEnviado).not.toHaveProperty('nome_responsavel');
    expect(corpoEnviado).not.toHaveProperty('telefone');
  });

  test('erro de rede ao salvar mostra toast de erro', async ({ page }) => {
    await entrarNoPainel(page);
    await page.route('**/api/perfil', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'Erro ao salvar. Tente novamente.' } });
    });

    await page.fill('#nome_segmento', 'Salão da Ana 2');
    await page.click('#btn-salvar-empresa');
    await expect(page.locator('.toast-erro')).toHaveText(/Erro ao salvar/);
  });
});
