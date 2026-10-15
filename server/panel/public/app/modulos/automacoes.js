// Automações — extraído de app.js (fase 3 da modularização, 2026-10-15).
// O "Menu ⋯" de cada linha (editar/duplicar/excluir) é tratado pelo listener
// global `ds-acoes-escolher`, que fica em app.js (precisa ficar no mesmo
// escopo de todas as outras telas que o usam) — por isso `automacoesAtuais`,
// `duplicarAutomacao`, `abrirModalAutomacao` e `abrirModalExcluirAutomacao`
// são exportados, não só usados internamente.
import { api } from '../core/api.js';
import { conteudo, mostrarToast, abrirModal, fecharModal, escapeHtml, iconeSvgHtml, validarObrigatorios, formatarDataHoraDisparo } from '../core/shell.js';

// Frase longa usada no <select> do formulário.
const AUTOMACAO_GATILHO_LABEL = {
  agendamento_criado: 'Confirmação de agenda — quando o agendamento é criado',
  agendamento_concluido: 'Feedback do serviço — depois do atendimento concluído',
  aniversario_cliente: 'Aniversário do cliente — no dia do aniversário',
  cliente_inativo: 'Clientes inativos — sem agendar há um tempo',
};

// Rótulo curto (coluna "Gatilho" da tabela).
const AUTOMACAO_GATILHO_CURTO = {
  agendamento_criado: 'Confirmação de agenda',
  agendamento_concluido: 'Feedback do serviço',
  aniversario_cliente: 'Aniversário do cliente',
  cliente_inativo: 'Clientes inativos',
};
const AUTOMACAO_GATILHOS_ORDEM = Object.keys(AUTOMACAO_GATILHO_CURTO);

let automacoesFiltroGatilho = '';
let automacoesTemplatesCache = [];
let automacoesAbaAtiva = 'lista';
export let automacoesAtuais = [];

// Relatório de disparos do próprio tenant (pedido do Bruno, 2026-09-20) —
// mesmos rótulos/status do log que o admin da Kyvvo já vê, só filtrado pro
// salão logado.
const STATUS_DISPARO_LABEL = {
  enviado: 'Enviado',
  erro: 'Erro no envio',
  bloqueado_optout: 'Bloqueado (opt-out)',
  bloqueado_24h: 'Bloqueado (24h)',
  bloqueado_limite_plano: 'Bloqueado (limite do plano)',
};
function badgeStatusDisparo(status) {
  const classe = status === 'enviado' ? 'badge-status-ativo' : 'badge-status-inativo';
  return `<span class="badge ${classe}">${escapeHtml(STATUS_DISPARO_LABEL[status] || status)}</span>`;
}
// Trunca em 25 caracteres + "…", com o texto inteiro no title (tooltip nativo
// do navegador — sem componente novo, sem JS extra). Mensagens antigas
// (antes da coluna mensagem_texto existir) mostram "—".
function truncarMensagem(msg) {
  if (!msg) return '—';
  if (msg.length <= 25) return escapeHtml(msg);
  return `<span title="${escapeHtml(msg)}">${escapeHtml(msg.slice(0, 25))}...</span>`;
}

function renderLinhaDisparo(d) {
  return `
    <tr>
      <td>${formatarDataHoraDisparo(d.criado_em)}</td>
      <td>${escapeHtml(d.cliente_nome || '—')}</td>
      <td>${escapeHtml(d.telefone_e164 || '—')}</td>
      <td>${escapeHtml(d.template_nome || '—')}</td>
      <td>${truncarMensagem(d.mensagem_texto)}</td>
      <td>${badgeStatusDisparo(d.status)}</td>
    </tr>
  `;
}
function renderAbaDisparos(dados) {
  if (!dados) return '<div class="vazio">Carregando...</div>';
  const limite = dados.limitePlano;
  let cardLimite = '';
  if (limite) {
    if (limite.limite == null) {
      cardLimite = `<div class="pagamento-plano-card" style="margin-bottom:16px"><p style="margin:0">Seu plano (${escapeHtml(limite.planoNome)}) não tem limite de disparos de WhatsApp.</p></div>`;
    } else {
      const estourou = limite.usadoMesAtual >= limite.limite;
      const pct = Math.min(100, Math.round((limite.usadoMesAtual / limite.limite) * 100));
      const corBarra = estourou ? 'automacoes-limite-vermelha' : pct >= 70 ? 'automacoes-limite-amarela' : 'automacoes-limite-verde';
      cardLimite = `
        <div class="pagamento-plano-card" style="margin-bottom:16px${estourou ? ';border-color:#F04438' : ''}">
          <p style="margin:0 0 4px;font-weight:600">Disparos de WhatsApp este mês (plano ${escapeHtml(limite.planoNome)})</p>
          <p style="margin:0;font-size:20px;font-weight:700${estourou ? ';color:#F04438' : ''}">${limite.usadoMesAtual} / ${limite.limite}</p>
          <div class="automacoes-limite-barra"><div class="automacoes-limite-preenchido ${corBarra}" style="width:${pct}%"></div></div>
          ${estourou ? '<p style="margin:6px 0 0;font-size:13px;color:#F04438">Limite atingido — as automações pararam de enviar até o mês virar. Fale com a Kyvvo pra ajustar seu plano.</p>' : ''}
        </div>
      `;
    }
  }
  return `
    ${cardLimite}
    <div class="automacoes-card">
      <div class="tabela-wrapper" style="margin-bottom:0">
        <table class="tabela-automacoes">
          <thead><tr><th>Data/hora</th><th>Cliente</th><th>Número</th><th>Modelo</th><th>Mensagem</th><th>Status</th></tr></thead>
          <tbody>${dados.disparos.length ? dados.disparos.map(renderLinhaDisparo).join('') : '<tr><td colspan="6">Nenhum disparo ainda.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function opcoesTemplateAutomacao(selecionado) {
  return `<option value="">— escolher modelo —</option>` + automacoesTemplatesCache.map((t) => `
    <option value="${escapeHtml(t.nome)}" ${t.nome === selecionado ? 'selected' : ''}>
      ${escapeHtml(t.nome)}${t.status && t.status !== 'APPROVED' ? ` (${t.status.toLowerCase()})` : ''}
    </option>`).join('');
}

export async function renderAutomacoes() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [dados, dadosTemplates, dadosDisparos] = await Promise.all([
    api('/api/automacoes'),
    api('/api/automacoes/templates-whatsapp'),
    api('/api/automacoes/disparos'),
  ]);
  if (!dados) return;
  const automacoesLista = dados.automacoes || [];
  automacoesTemplatesCache = (dadosTemplates && dadosTemplates.templates) || [];
  // Três estados distintos (antes qualquer lista vazia mostrava "conecte o
  // WhatsApp", mesmo com o número ativo): sem WhatsApp conectado, conectado
  // mas sem modelo aprovado na lista, ou erro ao buscar na Meta.
  const conectado = !!(dadosTemplates && dadosTemplates.conectado);
  let aviso = '';
  if (!conectado) {
    aviso = `<div class="pagamento-plano-card" style="margin-bottom:16px">
         <p style="margin:0">Pra as automações dispararem, conecte o WhatsApp do seu negócio em <a href="#" id="link-ir-whatsapp">Configurações → WhatsApp</a>.</p>
       </div>`;
  } else if (dadosTemplates && dadosTemplates.erro) {
    aviso = '<div class="pagamento-plano-card" style="margin-bottom:16px"><p style="margin:0">Não consegui carregar os modelos aprovados na Meta agora. Tente de novo em instantes.</p></div>';
  } else if (!automacoesTemplatesCache.length) {
    aviso = '<div class="pagamento-plano-card" style="margin-bottom:16px"><p style="margin:0">Nenhum modelo de disparo aprovado foi encontrado na conta do WhatsApp conectada.</p></div>';
  }

  const filtrados = automacoesFiltroGatilho
    ? automacoesLista.filter((a) => a.gatilho === automacoesFiltroGatilho)
    : automacoesLista;

  automacoesAtuais = automacoesLista;

  // Mesmo layout das telas de Automações de People e CRM: cabeçalho do DS com
  // o botão à direita, filtro no topo da tabela, colunas Nome / Gatilho /
  // Modelo / Ativa e o menu ⋯ (Editar / Duplicar / Excluir) em cada linha.
  const rotuloSwitch = (a) => `${a.ativo ? 'Pausar' : 'Ativar'} ${escapeHtml(a.nome)}`;
  const linha = (a) => `
    <div class="ds-tabela-linha" role="row" data-automacao="${a.id}">
      <span role="cell"><span class="ds-tabela-primario">${escapeHtml(a.nome)}</span></span>
      <span role="cell" class="ds-tabela-mudo" data-rotulo="Gatilho">${escapeHtml(AUTOMACAO_GATILHO_CURTO[a.gatilho] || a.gatilho)}</span>
      <span role="cell" data-rotulo="Modelo">${a.whatsapp_template
        ? `<span class="ds-tabela-primario">${escapeHtml(a.whatsapp_template)}</span>`
        : '<span class="ds-badge ds-badge-aviso ds-badge-sm" title="Escolha um modelo aprovado pra esta automação disparar">Sem modelo</span>'}</span>
      <span role="cell" data-rotulo="Ativa">
        ${a.removivel
          ? `<label class="ds-switch"><input type="checkbox" role="switch" class="auto-toggle" aria-label="${rotuloSwitch(a)}" ${a.ativo ? 'checked' : ''}><span class="ds-switch-trilho"></span></label>`
          : '<span class="ds-badge ds-badge-info ds-badge-sm" title="Automação obrigatória — não pode ser desativada nem excluída">Sempre ativa</span>'}
      </span>
      <span role="cell" class="ds-tabela-acoes">
        <div class="ds-acoes" data-automacao-id="${a.id}">
          <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações de ${escapeHtml(a.nome)}">⋯</button>
          <div class="ds-acoes-menu" role="menu" hidden>
            <button type="button" class="ds-acoes-item" role="menuitem" data-acao="editar">Editar</button>
            <button type="button" class="ds-acoes-item" role="menuitem" data-acao="duplicar">Duplicar</button>
            ${a.removivel ? '<button type="button" class="ds-acoes-item ds-acoes-item-perigo" role="menuitem" data-acao="excluir">Excluir</button>' : ''}
          </div>
        </div>
      </span>
    </div>`;

  const corpoLista = !automacoesLista.length
    ? '<div class="ds-vazio"><p class="ds-vazio-titulo">Nenhuma automação configurada ainda</p><p class="ds-vazio-texto">Crie a primeira para avisar seus clientes automaticamente pelo WhatsApp.</p></div>'
    : filtrados.length
      ? filtrados.map(linha).join('')
      : '<div class="ds-vazio"><p class="ds-vazio-titulo">Nenhuma automação encontrada</p><p class="ds-vazio-texto">Ajuste o filtro ou crie uma nova automação.</p></div>';

  conteudo.innerHTML = `
    <div class="automacoes-pagina">
    <div class="ds-pagina-cab">
      <div class="ds-pagina-cab-texto">
        <h1 class="ds-pagina-cab-titulo">Automações</h1>
        <p class="ds-pagina-cab-sub">Mensagens automáticas enviadas pelo WhatsApp no fluxo de agendamentos e clientes.</p>
      </div>
      <div class="ds-pagina-cab-acoes">
        <button type="button" class="ds-btn ds-btn-primario" id="btn-nova-automacao">${iconeSvgHtml('plus')}Nova automação</button>
      </div>
    </div>
    <div class="ds-abas" data-ds-abas>
      <div class="ds-abas-lista">
        <button type="button" class="ds-aba" id="aba-automacoes-lista" aria-controls="painel-automacoes-lista" aria-selected="${automacoesAbaAtiva === 'lista' ? 'true' : 'false'}">Automações</button>
        <button type="button" class="ds-aba" id="aba-automacoes-disparos" aria-controls="painel-automacoes-disparos" aria-selected="${automacoesAbaAtiva === 'disparos' ? 'true' : 'false'}">Disparos${dadosDisparos ? ` <span class="ds-aba-contagem">${dadosDisparos.total}</span>` : ''}</button>
      </div>
      <div class="ds-abas-painel" id="painel-automacoes-lista" aria-labelledby="aba-automacoes-lista" ${automacoesAbaAtiva === 'lista' ? '' : 'hidden'}>
        ${aviso}
        <div class="ds-tabela" role="table" aria-label="Automações" style="--ds-colunas: minmax(0,1.8fr) minmax(0,1.7fr) minmax(0,1fr) 110px 48px">
          <div class="ds-filtros">
            <div class="ds-select">
              <select id="filtro-gatilho-auto" aria-label="Filtrar por gatilho">
                <option value="">Todos os gatilhos</option>
                ${AUTOMACAO_GATILHOS_ORDEM.map((g) => `<option value="${g}" ${automacoesFiltroGatilho === g ? 'selected' : ''}>${AUTOMACAO_GATILHO_CURTO[g]}</option>`).join('')}
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>
          <div class="ds-tabela-cabecalho" role="row">
            <span role="columnheader">Nome</span>
            <span role="columnheader">Gatilho</span>
            <span role="columnheader">Modelo</span>
            <span role="columnheader">Ativa</span>
            <span role="columnheader"><span class="sr-only-automacoes">Ações</span></span>
          </div>
          <div id="lista-automacoes">${corpoLista}</div>
        </div>
      </div>
      <div class="ds-abas-painel" id="painel-automacoes-disparos" aria-labelledby="aba-automacoes-disparos" ${automacoesAbaAtiva === 'disparos' ? '' : 'hidden'}>
        ${renderAbaDisparos(dadosDisparos)}
      </div>
    </div>
    </div>
  `;

  conteudo.querySelector('.ds-abas').addEventListener('ds-abas-alterar', (e) => {
    automacoesAbaAtiva = e.detail.id === 'painel-automacoes-disparos' ? 'disparos' : 'lista';
  });

  const linkWpp = document.getElementById('link-ir-whatsapp');
  if (linkWpp) linkWpp.addEventListener('click', (e) => {
    e.preventDefault();
    // Automações não importa o roteador (selecionarMenu) de app.js — evento
    // customizado em vez de import direto, mesmo motivo de core/api.js: não
    // criar dependência de um módulo de tela pro orquestrador que o importa.
    document.dispatchEvent(new CustomEvent('kyvvo:navegar', { detail: 'whatsapp' }));
  });

  document.getElementById('btn-nova-automacao').addEventListener('click', () => abrirModalAutomacao(null));
  document.getElementById('filtro-gatilho-auto').addEventListener('change', (e) => {
    automacoesFiltroGatilho = e.target.value;
    renderAutomacoes();
  });

  conteudo.querySelectorAll('.ds-tabela-linha[data-automacao]').forEach((linhaEl) => {
    const id = linhaEl.dataset.automacao;
    const toggle = linhaEl.querySelector('.auto-toggle');
    if (!toggle) return;
    toggle.addEventListener('change', async (e) => {
      const r = await api(`/api/automacoes/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo: e.target.checked }) });
      if (!r || r.error) { mostrarToast((r && r.error) || 'Não salvou.', 'erro'); e.target.checked = !e.target.checked; }
      else mostrarToast(e.target.checked ? 'Automação ativada.' : 'Automação desativada.');
    });
  });
}

// Menu ⋯ de cada linha (tratado no listener global ds-acoes-escolher, em app.js).
export async function duplicarAutomacao(id) {
  const r = await api(`/api/automacoes/${id}/duplicar`, { method: 'POST' });
  if (!r || r.error) mostrarToast((r && r.error) || 'Não deu pra duplicar.', 'erro');
  else { mostrarToast('Automação duplicada (desativada).'); renderAutomacoes(); }
}

export function abrirModalAutomacao(automacao) {
  const editando = !!automacao;
  const gatilhoInicial = editando ? automacao.gatilho : 'agendamento_criado';
  abrirModal(
    `<h3>${editando ? 'Editar automação' : 'Nova automação'}</h3>`,
    `
      <form id="form-automacao">
        <div class="modal-erro" id="automacao-erro"></div>
        <label for="automacao-nome">Nome *</label>
        <input type="text" id="automacao-nome" data-obrigatorio value="${editando ? escapeHtml(automacao.nome) : ''}">

        <label for="automacao-gatilho">Gatilho *</label>
        <select id="automacao-gatilho">
          ${AUTOMACAO_GATILHOS_ORDEM.map((g) => `<option value="${g}" ${g === gatilhoInicial ? 'selected' : ''}>${AUTOMACAO_GATILHO_LABEL[g] || g}</option>`).join('')}
        </select>

        <label for="automacao-template">Modelo aprovado (Meta)</label>
        <select id="automacao-template">${opcoesTemplateAutomacao(editando ? automacao.whatsapp_template : '')}</select>
        <div class="ajuda" style="color:var(--muted-strong);font-size:12px;margin-top:4px">A automação só dispara depois que um modelo aprovado é escolhido.</div>

        <label for="automacao-corpo">Texto de referência *</label>
        <textarea id="automacao-corpo" rows="3" data-obrigatorio placeholder="O cliente recebe o texto do modelo aprovado; este campo é só referência interna.">${editando ? escapeHtml(automacao.corpo || '') : ''}</textarea>
        <div class="ajuda" style="color:var(--muted-strong);font-size:12px;margin-top:4px">Variáveis: {{cliente}} {{servico}} {{profissional}} {{data}} {{hora}} {{salao}}</div>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-automacao">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-automacao">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-automacao').addEventListener('click', fecharModal);

  const selGatilho = document.getElementById('automacao-gatilho');
  const form = document.getElementById('form-automacao');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('automacao-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) { erroEl.textContent = 'Preencha os campos obrigatórios destacados.'; invalido.focus(); return; }

    const payload = {
      nome: document.getElementById('automacao-nome').value.trim(),
      gatilho: selGatilho.value,
      corpo: document.getElementById('automacao-corpo').value.trim(),
      whatsapp_template: document.getElementById('automacao-template').value || null,
    };

    const btn = document.getElementById('btn-salvar-automacao');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const r = await api(editando ? `/api/automacoes/${automacao.id}` : '/api/automacoes', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (r && !r.error) {
      fecharModal();
      mostrarToast(editando ? 'Automação atualizada.' : 'Automação criada.', 'sucesso');
      renderAutomacoes();
    } else {
      erroEl.textContent = (r && r.error) || 'Não deu pra salvar.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

export function abrirModalExcluirAutomacao(automacao) {
  abrirModal(
    '<h3>Excluir automação</h3>',
    `
      <p class="modal-texto">Excluir <strong>${escapeHtml(automacao.nome)}</strong>? Essa ação não pode ser desfeita.</p>
      <div class="modal-erro" id="excluir-automacao-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-excluir-automacao">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-automacao">Excluir</button>
      </div>
    `
  );
  document.getElementById('btn-cancelar-excluir-automacao').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-automacao').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-automacao');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    const r = await api(`/api/automacoes/${automacao.id}`, { method: 'DELETE' });
    if (r && !r.error) {
      fecharModal();
      mostrarToast('Automação excluída.', 'sucesso');
      renderAutomacoes();
    } else {
      document.getElementById('excluir-automacao-erro').textContent = (r && r.error) || 'Não deu pra excluir.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}
