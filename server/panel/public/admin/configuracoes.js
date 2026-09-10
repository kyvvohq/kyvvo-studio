// Página de Configurações da área admin da Kyvvo (US38) — preços dos planos
// e configurações gerais do sistema, antes hardcoded no código, agora
// editáveis aqui sem precisar de deploy. Consome GET/PATCH
// /api/configuracoes*.

// token / identificação do admin / dropdown "Sair" agora vivem em shell.js
// (US53), carregado antes deste script em todas as páginas admin.

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('kyvvo_admin_token');
    window.location.href = '/login.html';
    return null;
  }
  return res.json();
}

const conteudo = document.getElementById('conteudo');

// ---------- Modal genérico (duplicado intencionalmente, ver comentário acima sobre isolamento entre telas admin) ----------
function escFecharModal(e) {
  if (e.key === 'Escape') fecharModal();
}

function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharModal);
}

function abrirModal(tituloHtml, conteudoHtml, { larga = false } = {}) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card${larga ? ' modal-card-larga' : ''}">
      <button class="modal-close" id="modal-close" aria-label="Fechar">✕</button>
      ${tituloHtml}
      ${conteudoHtml}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModal(); });
  document.addEventListener('keydown', escFecharModal);
  return overlay;
}

// Duplicado intencionalmente do app.js do painel admin (mesmo raciocínio de
// isolamento entre as telas admin — ver comentário em admin/app.js).
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function formatarPreco(preco) {
  return preco != null ? `R$ ${Number(preco).toFixed(2).replace('.', ',')}` : '—';
}

// US67/CA04 — rótulos de exibição dos eixos estruturais da grade 2x2
// (somente leitura no admin, ver renderLinhaPlano).
const TECNOLOGIA_LABELS = { bot: 'Bot', ia: 'IA' };
const TIPO_NUMERO_LABELS = { proprio: 'Número próprio', kyvvo: 'Número Kyvvo' };

// US74 — chaves/rótulos dos 3 limites de uso editáveis por plano (CA01: só
// essas 3 são aceitas pelo backend).
const PLANO_LIMITE_CHAVES = ['conversas_mes', 'profissionais', 'unidades'];
const PLANO_LIMITE_ROTULOS = { conversas_mes: 'Conversas/mês', profissionais: 'Profissionais', unidades: 'Unidades' };

// Planos do Kyvvo People (produto separado, migration 064) — mesma tabela
// `planos`/`plano_limites`, mesma rota de PATCH, mas com menos campos (sem a
// grade 2x2 de marketing do Studio — tecnologia/tipo_numero/features/
// headline não fazem sentido pro People ainda) e limites diferentes.
const PLANO_LIMITE_CHAVES_PEOPLE = ['vagas_ativas', 'candidatos_notificados_mes'];
const PLANO_LIMITE_ROTULOS_PEOPLE = { vagas_ativas: 'Vagas ativas simultâneas', candidatos_notificados_mes: 'Candidatos notificados/mês (WhatsApp)' };

function formatarLimiteAdmin(valor) {
  return valor == null ? 'Ilimitado' : String(valor);
}

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

// CA06 — rótulos de exibição das configurações gerais (chave vem do banco,
// ver migration 029_configuracoes_sistema.sql).
const CONFIG_SISTEMA_LABELS = {
  trial_dias: 'Dias de trial',
  carencia_dias_inadimplencia: 'Dias de carência após inadimplência',
  max_tentativas_reenvio_token: 'Máximo de tentativas de reenvio de token',
  email_suporte: 'E-mail de suporte exibido no portal',
  whatsapp_suporte: 'WhatsApp de suporte',
  whatsapp_handoff_retorno_horas: 'Devolver conversa ao bot após (horas sem retomada do salão)',
};
const CONFIG_SISTEMA_NUMERICAS = new Set(['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token', 'whatsapp_handoff_retorno_horas']);
const CONFIG_SISTEMA_ORDEM = ['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token', 'email_suporte', 'whatsapp_suporte', 'whatsapp_handoff_retorno_horas'];

let dados = null;
// Chaves de configuração geral atualmente em modo de edição inline (planos
// não usam mais edição inline — ver abrirModalEditarPlano — só as
// configurações gerais continuam editando direto na linha da tabela).
const sistemaEmEdicao = new Set();

async function carregar() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  dados = await api('/api/configuracoes');
  if (!dados) return;
  render();
}

function render() {
  const planosStudio = dados.planos.filter((p) => p.produto !== 'people');
  const planosPeople = dados.planos.filter((p) => p.produto === 'people');
  const html = `
    <h2 class="titulo-detalhe">Configurações do sistema</h2>
    <section class="secao-detalhe">
      <h3>Preços dos planos — Studio</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead>
            <tr>
              <th>Plano</th><th>Descrição</th><th>Destaque</th><th>Ativo</th><th></th>
            </tr>
          </thead>
          <tbody>${planosStudio.map(renderLinhaPlano).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Preços dos planos — People</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead>
            <tr>
              <th>Plano</th><th>Preço/mês</th><th>Vagas ativas</th><th>Notificados/mês</th><th>Ativo</th><th></th>
            </tr>
          </thead>
          <tbody>${planosPeople.map(renderLinhaPlanoPeople).join('') || '<tr><td colspan="6">Nenhum plano People cadastrado.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Configurações gerais</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Configuração</th><th>Valor</th><th></th></tr></thead>
          <tbody>${CONFIG_SISTEMA_ORDEM.map(renderLinhaSistema).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="secao-detalhe">
      <h3>Log de auditoria — últimas ${dados.log.length}</h3>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Campo</th><th>Valor anterior</th><th>Valor novo</th><th>Alterado por</th><th>Data</th></tr></thead>
          <tbody>
            ${dados.log.length ? dados.log.map((l) => `
              <tr>
                <td>${escapeHtml(l.campo)}</td>
                <td>${escapeHtml(l.valor_anterior ?? '—')}</td>
                <td>${escapeHtml(l.valor_novo ?? '—')}</td>
                <td>${escapeHtml(l.alterado_por_nome || '—')}</td>
                <td>${formatarDataHora(l.alterado_em)}</td>
              </tr>
            `).join('') : '<tr><td colspan="5">Nenhuma alteração registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
  conteudo.innerHTML = html;
  wireEventos();
}

function renderLinhaPlano(plano) {
  const toggleAtivoClasse = plano.ativo ? 'toggle-on' : 'toggle-off';
  const toggleDestaqueClasse = plano.destaque ? 'toggle-on' : 'toggle-off';
  return `
    <tr data-plano="${plano.chave}">
      <td>${escapeHtml(plano.nome)}</td>
      <td>${escapeHtml(plano.descricao || '—')}</td>
      <td><span class="toggle-readonly ${toggleDestaqueClasse}" data-testid="destaque-${plano.chave}" title="${plano.destaque ? 'Em destaque' : 'Sem destaque'}"></span></td>
      <td><span class="toggle-readonly ${toggleAtivoClasse}" data-testid="ativo-${plano.chave}" title="${plano.ativo ? 'Ativo' : 'Inativo'}"></span></td>
      <td class="celula-acoes-plano">
        <button class="btn-secundario btn-tabela" data-testid="editar-${plano.chave}" data-acao="editar-plano" data-chave="${plano.chave}">Editar</button>
      </td>
    </tr>
  `;
}

function renderLinhaPlanoPeople(plano) {
  const toggleAtivoClasse = plano.ativo ? 'toggle-on' : 'toggle-off';
  const limites = plano.limites || {};
  return `
    <tr data-plano="${plano.chave}">
      <td>${escapeHtml(plano.nome)}</td>
      <td>${formatarPreco(plano.preco_mensal)}</td>
      <td>${formatarLimiteAdmin(limites.vagas_ativas)}</td>
      <td>${formatarLimiteAdmin(limites.candidatos_notificados_mes)}</td>
      <td><span class="toggle-readonly ${toggleAtivoClasse}" data-testid="ativo-${plano.chave}" title="${plano.ativo ? 'Ativo' : 'Inativo'}"></span></td>
      <td class="celula-acoes-plano">
        <button class="btn-secundario btn-tabela" data-testid="editar-${plano.chave}" data-acao="editar-plano-people" data-chave="${plano.chave}">Editar</button>
      </td>
    </tr>
  `;
}

// ---------- Modal "Editar plano People" (versão enxuta — sem a grade 2x2 de marketing do Studio) ----------
function abrirModalEditarPlanoPeople(chave) {
  const plano = dados.planos.find((p) => p.chave === chave);
  if (!plano) return;

  const limites = plano.limites || {};
  const camposLimites = PLANO_LIMITE_CHAVES_PEOPLE.map((chaveLimite) => `
    <div>
      <label for="plano-people-limite-${chaveLimite}">${PLANO_LIMITE_ROTULOS_PEOPLE[chaveLimite]}</label>
      <input type="number" min="0" id="plano-people-limite-${chaveLimite}" value="${limites[chaveLimite] ?? ''}" placeholder="ilimitado">
    </div>
  `).join('');

  abrirModal(
    '<h3>Editar plano People</h3>',
    `
      <div class="modal-erro" id="plano-people-erro"></div>
      <form id="form-editar-plano-people">
        <label for="plano-people-nome">Nome *</label>
        <input type="text" id="plano-people-nome" value="${escapeHtml(plano.nome)}">

        <label for="plano-people-descricao">Descrição</label>
        <input type="text" id="plano-people-descricao" value="${escapeHtml(plano.descricao || '')}">

        <label for="plano-people-preco">Preço mensal *</label>
        <input type="number" step="0.01" min="1" id="plano-people-preco" value="${plano.preco_mensal}">

        <label>Limites de uso</label>
        <div class="pagamento-grid-2col">${camposLimites}</div>

        <label class="toggle-linha"><span class="toggle-switch"><input type="checkbox" id="plano-people-ativo" ${plano.ativo ? 'checked' : ''}><span class="toggle-switch-trilho"></span></span> Ativo</label>

        <p class="modal-texto">⚠️ Alterações de preço afetam apenas novas assinaturas — quem já assina continua pagando o valor original.</p>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-sair-editar-plano-people">Sair</button>
          <button type="submit" class="btn-primario" id="btn-salvar-editar-plano-people">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-sair-editar-plano-people').addEventListener('click', fecharModal);
  document.getElementById('form-editar-plano-people').addEventListener('submit', async (e) => {
    e.preventDefault();
    await salvarPlanoPeople(chave);
  });
}

async function salvarPlanoPeople(chave) {
  const nome = document.getElementById('plano-people-nome').value.trim();
  const descricao = document.getElementById('plano-people-descricao').value.trim();
  const precoMensal = document.getElementById('plano-people-preco').value;
  const ativo = document.getElementById('plano-people-ativo').checked;
  const limites = Object.fromEntries(
    PLANO_LIMITE_CHAVES_PEOPLE.map((chaveLimite) => {
      const valorBruto = document.getElementById(`plano-people-limite-${chaveLimite}`).value.trim();
      return [chaveLimite, valorBruto === '' ? null : Number(valorBruto)];
    })
  );
  const erroEl = document.getElementById('plano-people-erro');
  erroEl.textContent = '';

  if (!nome) {
    erroEl.textContent = 'Nome do plano não pode ficar em branco.';
    return;
  }
  if (!(Number(precoMensal) >= 1)) {
    erroEl.textContent = 'Preço mensal deve ser no mínimo R$ 1,00.';
    return;
  }

  const btn = document.getElementById('btn-salvar-editar-plano-people');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const resultado = await api(`/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({ nome, descricao, preco_mensal: Number(precoMensal), ativo, limites }),
  });

  if (resultado && !resultado.error) {
    fecharModal();
    mostrarToast('Plano atualizado com sucesso.', 'sucesso');
    await carregar();
  } else {
    erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar plano.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// ---------- Modal "Editar plano" (todos os campos, Salvar/Sair) ----------
function abrirModalEditarPlano(chave) {
  const plano = dados.planos.find((p) => p.chave === chave);
  if (!plano) return;

  const features = plano.features || [];
  const limites = plano.limites || {};
  const camposFeatures = [0, 1, 2].map((i) => `
    <div>
      <input type="text" id="plano-editar-feature-${i}" value="${escapeHtml(features[i] ? features[i].label : '')}" placeholder="Diferencial ${i + 1}">
    </div>
  `).join('');
  const camposLimites = PLANO_LIMITE_CHAVES.map((chaveLimite) => `
    <div>
      <label for="plano-editar-limite-${chaveLimite}">${PLANO_LIMITE_ROTULOS[chaveLimite]}</label>
      <input type="number" min="0" id="plano-editar-limite-${chaveLimite}" value="${limites[chaveLimite] ?? ''}" placeholder="ilimitado">
    </div>
  `).join('');

  abrirModal(
    '<h3>Editar plano</h3>',
    `
      <div class="modal-erro" id="plano-editar-erro"></div>
      <form id="form-editar-plano">
        <label for="plano-editar-nome">Nome *</label>
        <input type="text" id="plano-editar-nome" data-testid="input-nome-${chave}" value="${escapeHtml(plano.nome)}">

        <label for="plano-editar-descricao">Descrição</label>
        <input type="text" id="plano-editar-descricao" value="${escapeHtml(plano.descricao || '')}">

        <label for="plano-editar-headline">Headline (diferencial)</label>
        <input type="text" id="plano-editar-headline" data-testid="input-headline-${chave}" value="${escapeHtml(plano.headline_diferencial || '')}">
        <div class="contador-caracteres" id="plano-editar-headline-contador"></div>

        <label for="plano-editar-frase">Frase de benefício</label>
        <input type="text" id="plano-editar-frase" data-testid="input-frase-${chave}" value="${escapeHtml(plano.frase_beneficio || '')}">
        <div class="contador-caracteres" id="plano-editar-frase-contador"></div>

        <label>Diferenciais (até 3)</label>
        <div class="pagamento-grid-3col">${camposFeatures}</div>

        <label>Limites de uso</label>
        <div class="pagamento-grid-3col">${camposLimites}</div>

        <div class="pagamento-grid-2col">
          <div>
            <label for="plano-editar-preco">Preço mensal *</label>
            <input type="number" step="0.01" min="1" id="plano-editar-preco" value="${plano.preco_mensal}">
          </div>
          <div>
            <label for="plano-editar-limite-disparos">Limite de disparos</label>
            <input type="number" step="1" min="0" id="plano-editar-limite-disparos" value="${plano.limite_disparos ?? ''}" placeholder="ilimitado">
          </div>
        </div>

        <label for="plano-editar-badge">Badge</label>
        <input type="text" id="plano-editar-badge" value="${escapeHtml(plano.badge || '')}" placeholder="ex: Mais popular">

        <div class="pagamento-grid-2col">
          <div>
            <label class="toggle-linha"><span class="toggle-switch"><input type="checkbox" id="plano-editar-destaque" ${plano.destaque ? 'checked' : ''}><span class="toggle-switch-trilho"></span></span> Destaque</label>
          </div>
          <div>
            <label class="toggle-linha"><span class="toggle-switch"><input type="checkbox" id="plano-editar-ativo" ${plano.ativo ? 'checked' : ''}><span class="toggle-switch-trilho"></span></span> Ativo</label>
          </div>
        </div>

        <p class="modal-texto">
          <strong>Slug:</strong> ${escapeHtml(plano.slug || plano.chave)} ·
          <strong>Tecnologia:</strong> ${escapeHtml(TECNOLOGIA_LABELS[plano.tecnologia] || plano.tecnologia || '—')} ·
          <strong>Tipo de número:</strong> ${escapeHtml(TIPO_NUMERO_LABELS[plano.tipo_numero] || plano.tipo_numero || '—')}
        </p>
        <p class="modal-texto">⚠️ Alterações de preço afetam apenas novas assinaturas — quem já assina continua pagando o valor original.</p>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-sair-editar-plano">Sair</button>
          <button type="submit" class="btn-primario" data-testid="salvar-${chave}" id="btn-salvar-editar-plano">Salvar</button>
        </div>
      </form>
    `,
    { larga: true }
  );

  document.getElementById('btn-sair-editar-plano').addEventListener('click', fecharModal);

  const headlineEl = document.getElementById('plano-editar-headline');
  const fraseEl = document.getElementById('plano-editar-frase');
  const erroEl = document.getElementById('plano-editar-erro');
  const salvarBtn = document.getElementById('btn-salvar-editar-plano');

  // US73/CA04 — contador + bloqueio do Salvar em tempo real (não só no
  // submit) quando headline/frase passam de 120 caracteres.
  function validarLimitesCopyPlano() {
    document.getElementById('plano-editar-headline-contador').textContent = `${headlineEl.value.length}/120`;
    document.getElementById('plano-editar-frase-contador').textContent = `${fraseEl.value.length}/120`;
    const acimaDoLimite = headlineEl.value.length > 120 || fraseEl.value.length > 120;
    if (acimaDoLimite) {
      erroEl.textContent = 'Headline e frase de benefício têm o máximo de 120 caracteres.';
      salvarBtn.disabled = true;
    } else if (erroEl.textContent.startsWith('Headline e frase')) {
      erroEl.textContent = '';
      salvarBtn.disabled = false;
    }
  }
  headlineEl.addEventListener('input', validarLimitesCopyPlano);
  fraseEl.addEventListener('input', validarLimitesCopyPlano);
  validarLimitesCopyPlano();

  document.getElementById('form-editar-plano').addEventListener('submit', async (e) => {
    e.preventDefault();
    await salvarPlano(chave);
  });
}

function renderLinhaSistema(chave) {
  const editando = sistemaEmEdicao.has(chave);
  const valorAtual = dados.sistema[chave] ?? '';
  const tipoInput = CONFIG_SISTEMA_NUMERICAS.has(chave) ? 'number' : chave === 'email_suporte' ? 'email' : 'text';

  if (editando) {
    return `
      <tr data-config="${chave}">
        <td>${escapeHtml(CONFIG_SISTEMA_LABELS[chave] || chave)}</td>
        <td>
          <input type="${tipoInput}" class="input-config-valor" ${tipoInput === 'number' ? 'min="1" step="1"' : ''} value="${escapeHtml(valorAtual)}">
          <div class="modal-erro" data-erro-config="${chave}"></div>
        </td>
        <td class="celula-acoes-plano">
          <button class="btn-secundario btn-tabela" data-acao="cancelar-config" data-chave="${chave}">Cancelar</button>
          <button class="btn-primario btn-tabela" data-acao="salvar-config" data-chave="${chave}">Salvar</button>
        </td>
      </tr>
    `;
  }

  return `
    <tr data-config="${chave}">
      <td>${escapeHtml(CONFIG_SISTEMA_LABELS[chave] || chave)}</td>
      <td>${escapeHtml(valorAtual)}</td>
      <td class="celula-acoes-plano">
        <button class="btn-secundario btn-tabela" data-acao="editar-config" data-chave="${chave}">Editar</button>
      </td>
    </tr>
  `;
}

function wireEventos() {
  conteudo.querySelectorAll('[data-acao="editar-plano"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalEditarPlano(btn.dataset.chave));
  });
  conteudo.querySelectorAll('[data-acao="editar-plano-people"]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalEditarPlanoPeople(btn.dataset.chave));
  });

  conteudo.querySelectorAll('[data-acao="editar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => { sistemaEmEdicao.add(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="cancelar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => { sistemaEmEdicao.delete(btn.dataset.chave); render(); });
  });
  conteudo.querySelectorAll('[data-acao="salvar-config"]').forEach((btn) => {
    btn.addEventListener('click', () => salvarConfigSistema(btn.dataset.chave));
  });
}

// Lê e valida o formulário do modal "Editar plano" (abrirModalEditarPlano)
// e manda tudo num PATCH só — mesmo formato que a edição inline antiga já
// mandava, só que os campos agora vêm do modal em vez de uma <tr>.
async function salvarPlano(chave) {
  const nome = document.getElementById('plano-editar-nome').value.trim();
  const descricao = document.getElementById('plano-editar-descricao').value.trim();
  const headlineDiferencial = document.getElementById('plano-editar-headline').value.trim();
  const fraseBeneficio = document.getElementById('plano-editar-frase').value.trim();
  const precoMensal = document.getElementById('plano-editar-preco').value;
  const limiteBruto = document.getElementById('plano-editar-limite-disparos').value.trim();
  const badge = document.getElementById('plano-editar-badge').value.trim();
  const destaque = document.getElementById('plano-editar-destaque').checked;
  const ativo = document.getElementById('plano-editar-ativo').checked;
  // US74/CA05 — slots vazios não viram feature; os 3 campos fixos garantem o
  // máximo de 3.
  const features = [0, 1, 2]
    .map((i) => document.getElementById(`plano-editar-feature-${i}`).value.trim())
    .filter(Boolean);
  const limites = Object.fromEntries(
    PLANO_LIMITE_CHAVES.map((chaveLimite) => {
      const valorBruto = document.getElementById(`plano-editar-limite-${chaveLimite}`).value.trim();
      return [chaveLimite, valorBruto === '' ? null : Number(valorBruto)];
    })
  );
  const erroEl = document.getElementById('plano-editar-erro');
  erroEl.textContent = '';

  // US72/CA04 — nome editável, mas o slug (identificador público usado em
  // links) nunca é enviado aqui — continua estrutural, só muda por migration.
  if (!nome) {
    erroEl.textContent = 'Nome do plano não pode ficar em branco.';
    return;
  }
  if (headlineDiferencial.length > 120 || fraseBeneficio.length > 120) {
    erroEl.textContent = 'Headline e frase de benefício têm o máximo de 120 caracteres.';
    return;
  }
  if (!(Number(precoMensal) >= 1)) {
    erroEl.textContent = 'Preço mensal deve ser no mínimo R$ 1,00.';
    return;
  }

  const btn = document.getElementById('btn-salvar-editar-plano');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const resultado = await api(`/api/configuracoes/planos/${chave}`, {
    method: 'PATCH',
    body: JSON.stringify({
      nome,
      descricao,
      headline_diferencial: headlineDiferencial,
      frase_beneficio: fraseBeneficio,
      preco_mensal: Number(precoMensal),
      limite_disparos: limiteBruto === '' ? null : Number(limiteBruto),
      badge: badge === '' ? null : badge,
      destaque,
      ativo,
      features,
      limites,
    }),
  });

  if (resultado && !resultado.error) {
    fecharModal();
    mostrarToast('Plano atualizado com sucesso.', 'sucesso');
    await carregar();
  } else {
    erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar plano.';
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

async function salvarConfigSistema(chave) {
  const linha = conteudo.querySelector(`tr[data-config="${chave}"]`);
  const valor = linha.querySelector('.input-config-valor').value.trim();
  const erroEl = linha.querySelector(`[data-erro-config="${chave}"]`);
  erroEl.textContent = '';

  if (CONFIG_SISTEMA_NUMERICAS.has(chave) && !(Number.isInteger(Number(valor)) && Number(valor) > 0)) {
    erroEl.textContent = 'Deve ser um número inteiro maior que zero.';
    return;
  }
  if (chave === 'email_suporte' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
    erroEl.textContent = 'Informe um e-mail válido.';
    return;
  }

  const resultado = await api('/api/configuracoes/sistema', {
    method: 'PATCH',
    body: JSON.stringify({ [chave]: valor }),
  });

  if (resultado && !resultado.error) {
    sistemaEmEdicao.delete(chave);
    mostrarToast('Configuração atualizada com sucesso.', 'sucesso');
    await carregar();
  } else {
    erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar configuração.';
  }
}

// ---------- Toast (duplicado intencionalmente, ver comentário acima) ----------
function mostrarToast(mensagem, tipo = 'sucesso') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = (tipo === 'sucesso' ? '✅ ' : '❌ ') + mensagem;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-saindo');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

carregar();
