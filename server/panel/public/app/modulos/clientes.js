// Clientes — extraído de app.js (fase 4b da modularização, 2026-10-16).
// O "Menu ⋯" de cada linha (disparo/agendamento/editar) e a seleção em lote
// pro disparo são tratados pelos listeners globais `ds-acoes-escolher`,
// `change` e `click`, que ficam em app.js (precisam ficar no mesmo escopo de
// todas as outras telas que os usam) — por isso `clientesAtuais`,
// `clientesSelecionados`, `clientesSelecionadosInfo`,
// `atualizarBarraSelecaoClientes`, `clientesFiltro`, `clientesCampoFocado`
// (+ setter) e as funções de abrir modal são exportados.
//
// `abrirModalNovoAgendamento` é um modal de Agenda (fase 7, ainda em app.js)
// — em vez de importar de volta (import circular: app.js já importa este
// módulo), dispara o evento `kyvvo:abrir-novo-agendamento`, igual ao padrão
// já usado por `kyvvo:navegar`/`kyvvo:bloqueio`.
import { api } from '../core/api.js';
import {
  conteudo, mostrarToast, abrirModal, fecharModal, escapeHtml, validarObrigatorios,
  formatarDataCurta, formatarDataHoraCurta,
} from '../core/shell.js';
import { automacoesTemplatesCache, definirAutomacoesTemplatesCache, definirAutomacoesAbaAtiva } from './automacoes.js';

// Tela só de leitura: clientes nascem automaticamente ao agendar (POST
// /agendamentos), não existe cadastro manual nem edição/exclusão aqui.
function formatarFormaPagamento(forma) {
  const rotulos = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro', outro: 'Outro' };
  return rotulos[forma] || 'Não informado';
}

// Perfil do cliente (menu Clientes: clicar numa linha da tabela; Início:
// atalho "Cliente" nos Próximos atendimentos) — próximo agendamento, último
// atendimento, histórico completo, observações livres, e um formulário de
// edição (nome/e-mail/nascimento) + exclusão (telefone não é editável: é a
// chave que liga o cliente às mensagens do WhatsApp).
export async function abrirModalClienteDetalhe(clienteId) {
  abrirModal('<h3>Cliente</h3>', '<div class="vazio">Carregando...</div>', 'modal-card-pagamento');
  const dados = await api(`/api/clientes/${clienteId}`);
  if (!dados) return;
  const { cliente, proximo_atendimento: proximo, historico } = dados;
  const ultimo = historico[0];

  const conteudoHtml = `
    <div class="cliente-perfil-telefone">${cliente.telefone}</div>
    <div class="cliente-perfil-acoes-topo">
      <button class="btn-secundario" id="btn-cliente-whatsapp" type="button">WhatsApp</button>
      <button class="btn-primario" id="btn-cliente-novo-agendamento" type="button">Novo agendamento</button>
    </div>

    ${proximo ? `
      <div class="cliente-perfil-secao">
        <h4>Próximo agendamento</h4>
        <p>${formatarDataHoraCurta(proximo.data_hora)} · ${proximo.servico_nome}${proximo.profissional_nome ? ` · ${proximo.profissional_nome}` : ''}</p>
      </div>
    ` : ''}

    <div class="cliente-perfil-secao">
      <h4>Último atendimento</h4>
      <p>${ultimo ? `${formatarDataCurta(ultimo.data_hora)} · ${ultimo.servico_nome}${ultimo.valor != null ? ` · ${formatarPreco(Number(ultimo.valor))}` : ''}` : 'Nenhum atendimento registrado ainda.'}</p>
    </div>

    <div class="cliente-perfil-secao">
      <h4>Histórico</h4>
      ${historico.length
        ? `<ul class="cliente-perfil-historico">${historico.map((h) => `<li>${formatarDataCurta(h.data_hora)} &nbsp; ${h.servico_nome}</li>`).join('')}</ul>`
        : '<p class="vazio-inline">Nenhum atendimento registrado ainda.</p>'}
    </div>

    <div class="cliente-perfil-secao">
      <h4>Observações</h4>
      <textarea id="cliente-observacoes" rows="3" placeholder="Anotações livres sobre o cliente">${cliente.observacoes || ''}</textarea>
    </div>

    <h4 class="cliente-perfil-secao-titulo-editar">Editar cadastro</h4>
    <label for="cliente-nome">Nome</label>
    <input type="text" id="cliente-nome" value="${cliente.nome || ''}" placeholder="Nome do cliente">
    <label for="cliente-email">E-mail</label>
    <input type="email" id="cliente-email" value="${cliente.email || ''}" placeholder="cliente@email.com">
    <label for="cliente-nascimento">Data de nascimento</label>
    <input type="date" id="cliente-nascimento" value="${cliente.data_nascimento || ''}">
    <div class="modal-erro" id="cliente-detalhe-erro"></div>
    <div class="modal-acoes">
      <button class="btn-secundario acao-perigo" id="btn-excluir-cliente-detalhe" type="button">Excluir</button>
      <button class="btn-primario" id="btn-salvar-cliente-detalhe" type="button">Salvar</button>
    </div>
  `;
  abrirModal(`<h3>${cliente.nome || 'Cliente'}</h3>`, conteudoHtml, 'modal-card-pagamento modal-cliente-perfil');

  document.getElementById('btn-cliente-whatsapp').addEventListener('click', () => {
    window.open(`https://wa.me/${cliente.telefone}`, '_blank');
  });
  document.getElementById('btn-cliente-novo-agendamento').addEventListener('click', () => {
    fecharModal();
    document.dispatchEvent(new CustomEvent('kyvvo:abrir-novo-agendamento', {
      detail: { telefone: cliente.telefone.replace(/^55/, ''), nome: cliente.nome },
    }));
  });
  document.getElementById('btn-excluir-cliente-detalhe').addEventListener('click', () => abrirModalExcluirCliente(cliente));
  document.getElementById('btn-salvar-cliente-detalhe').addEventListener('click', async () => {
    const nomeNovo = document.getElementById('cliente-nome').value.trim();
    if (!nomeNovo) {
      document.getElementById('cliente-detalhe-erro').textContent = 'Nome não pode ficar em branco.';
      return;
    }
    const btn = document.getElementById('btn-salvar-cliente-detalhe');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/clientes/${clienteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nome: nomeNovo,
        data_nascimento: document.getElementById('cliente-nascimento').value || null,
        email: document.getElementById('cliente-email').value.trim() || null,
        observacoes: document.getElementById('cliente-observacoes').value || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente atualizado.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('cliente-detalhe-erro').textContent = (resultado && resultado.error) || 'Erro ao salvar cliente.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function abrirModalNovoCliente() {
  abrirModal(
    '<h3>Novo cliente</h3>',
    `
      <form id="form-novo-cliente" novalidate>
        <div class="modal-erro" id="novo-cliente-erro"></div>
        <label for="novo-cliente-nome">Nome *</label>
        <input type="text" id="novo-cliente-nome" data-obrigatorio autocomplete="off">
        <label for="novo-cliente-telefone">Telefone *</label>
        <input type="tel" id="novo-cliente-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off">
        <label for="novo-cliente-email">E-mail</label>
        <input type="email" id="novo-cliente-email" placeholder="cliente@email.com" autocomplete="off">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-cliente">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-cliente">Salvar</button>
        </div>
      </form>
    `,
    'modal-card-pagamento'
  );
  document.getElementById('btn-cancelar-novo-cliente').addEventListener('click', fecharModal);
  const form = document.getElementById('form-novo-cliente');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const primeiroInvalido = validarObrigatorios(form);
    if (primeiroInvalido) {
      primeiroInvalido.focus();
      return;
    }
    const btn = document.getElementById('btn-salvar-novo-cliente');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/clientes', {
      method: 'POST',
      body: JSON.stringify({
        nome: document.getElementById('novo-cliente-nome').value.trim(),
        telefone: document.getElementById('novo-cliente-telefone').value,
        email: document.getElementById('novo-cliente-email').value.trim() || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente cadastrado.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('novo-cliente-erro').textContent = (resultado && resultado.error) || 'Erro ao cadastrar cliente.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

function abrirModalExcluirCliente(cliente) {
  abrirModal(
    '<h3>Excluir cliente</h3>',
    `
      <p class="modal-texto">Essa operação não pode ser desfeita. Deseja confirmar a exclusão de <strong>${cliente.nome || cliente.telefone}</strong>?</p>
      <div class="modal-erro" id="excluir-cliente-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-excluir-cliente">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-cliente">Confirmar</button>
      </div>
    `
  );
  document.getElementById('btn-cancelar-excluir-cliente').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-cliente').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-cliente');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/clientes/${cliente.id}`, { method: 'DELETE' });
    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Cliente excluído com sucesso.', 'sucesso');
      renderClientes();
    } else {
      document.getElementById('excluir-cliente-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir cliente.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// Seleção de clientes pro disparo em lote (menu Clientes) — atravessa
// página/filtro de propósito (o dono pode selecionar de várias páginas),
// então NÃO é resetada dentro de renderClientes(); só ao concluir um
// disparo ou clicar "Limpar seleção". clientesSelecionadosInfo guarda
// nome/telefone de quem foi selecionado em QUALQUER página, pra o passo 1
// do modal listar todo mundo sem precisar buscar de novo na API. Exportados
// porque o listener global de seleção/disparo (change/ds-acoes-escolher/
// click) fica em app.js — só métodos (add/delete/clear), nunca reatribuídos,
// então não precisam de setter.
export let clientesSelecionados = new Set();
export let clientesSelecionadosInfo = new Map();

export function atualizarBarraSelecaoClientes() {
  const barra = document.querySelector('.ds-selecao-barra');
  if (barra && window.KyvvoDS) window.KyvvoDS.selecaoBarraAtualizar(barra, clientesSelecionados.size);
}

// ---------- Menu Clientes: cabeçalho + busca unificada + filtro por status +
// indicadores + tabela paginada. Clicar numa linha abre o perfil completo em
// modal (abrirModalClienteDetalhe, acima) — não há mais expansão inline. ----------
export let clientesAtuais = [];
export let clientesFiltro = { busca: '', status: 'todos', pagina: 1, tamanho: 10 };
let clientesFiltroDebounce;
// Só lido/reatribuído aqui dentro e no listener de app.js (click, pills de
// status/paginação) — exportado com setter pelo mesmo motivo de
// configuracao/contaStatus (import de `let` não pode ser reatribuído de fora).
export let clientesCampoFocado = null;
export function definirClientesCampoFocado(valor) { clientesCampoFocado = valor; }

const CLIENTES_STATUS_LABEL = { ativo: 'Ativo', novo: 'Novo', inativo: 'Inativo' };

// Cards clicáveis (substituem os pills Todos/Ativos/Novos/Inativos) — cada
// um já é o próprio filtro, com a contagem embaixo do título. `chave` bate
// com CLIENTES_STATUS_VALIDOS/CLIENTE_PREDICADOS_STATUS do backend.
const CLIENTES_KPI_CARDS = [
  ['ativo', 'Clientes ativos', 'ativos'],
  ['novo', 'Novos clientes', 'novos'],
  ['inativo', 'Para retornar', 'para_retornar'],
  ['todos', 'Todos os clientes', 'total'],
];

function clientesKpiCard(chave, label, valor, ativo) {
  return `
    <button type="button" class="financeiro-resumo-card clientes-kpi-card${ativo ? ' clientes-kpi-card-ativo' : ''}" data-clientes-status="${chave}">
      <div class="financeiro-resumo-label">${label}</div>
      <div>${Number(valor).toLocaleString('pt-BR')}</div>
    </button>
  `;
}

function renderClienteLinha(c) {
  return `
    <tr class="linha-clicavel" data-cliente-abrir="${c.id}">
      <td class="col-selecao-cliente">
        <input type="checkbox" class="ds-selecao-checkbox" data-cliente-selecionar="${c.id}" aria-label="Selecionar ${escapeHtml(c.nome || 'cliente')}" ${clientesSelecionados.has(c.id) ? 'checked' : ''}>
      </td>
      <td>
        <div>${c.nome || 'Sem nome'}</div>
        <div class="cliente-linha-telefone">${c.telefone}</div>
      </td>
      <td>${c.ultimo_atendimento_data ? formatarDataCurta(c.ultimo_atendimento_data) : '—'}</td>
      <td>${c.proximo_atendimento_data ? formatarDataHoraCurta(c.proximo_atendimento_data) : '—'}</td>
      <td>${formatarPreco(Number(c.total_gasto))}</td>
      <td><span class="badge badge-cliente-${c.status}">${CLIENTES_STATUS_LABEL[c.status]}</span></td>
      <td>
        <span class="ds-acoes" data-cliente-id="${c.id}">
          <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações">⋯</button>
          <div class="ds-acoes-menu" role="menu" hidden>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="disparo">Disparo individual</button>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="agendamento">Novo agendamento</button>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="editar">Editar cliente</button>
          </div>
        </span>
      </td>
    </tr>
  `;
}

export async function renderClientes() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const query = new URLSearchParams({
    busca: clientesFiltro.busca,
    status: clientesFiltro.status,
    pagina: String(clientesFiltro.pagina),
    tamanho: String(clientesFiltro.tamanho),
  });
  const data = await api(`/api/clientes?${query}`);
  if (!data) return;
  clientesAtuais = data.clientes;

  const totalPaginas = Math.max(1, Math.ceil(data.total / clientesFiltro.tamanho));
  if (clientesFiltro.pagina > totalPaginas) clientesFiltro.pagina = totalPaginas;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Clientes</h2>
      <button class="btn-novo-agendamento" id="btn-novo-cliente">+ Novo cliente</button>
    </div>

    <div class="clientes-filtros">
      <input type="text" id="clientes-filtro-busca" placeholder="Buscar por nome, telefone ou e-mail" value="${clientesFiltro.busca}">
    </div>

    <div class="inicio-cards" style="grid-template-columns:repeat(4,1fr)">
      ${CLIENTES_KPI_CARDS.map(([chave, label, kpiKey]) => clientesKpiCard(chave, label, data.kpis[kpiKey], clientesFiltro.status === chave)).join('')}
    </div>
  `;

  if (!data.clientes.length) {
    html += '<div class="vazio">Nenhum cliente encontrado.</div>';
  } else {
    html += `
      <div class="tabela-wrapper">
        <table class="tabela-tenants tabela-clientes">
          <thead>
            <tr>
              <th class="col-selecao-cliente"></th>
              <th>Cliente</th>
              <th>Último atendimento</th>
              <th>Próx. atendimento</th>
              <th>Total gasto</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data.clientes.map(renderClienteLinha).join('')}
          </tbody>
        </table>
      </div>
      <div class="inicio-paginacao">
        <select id="clientes-tamanho">
          <option value="10" ${clientesFiltro.tamanho === 10 ? 'selected' : ''}>10 por página</option>
          <option value="50" ${clientesFiltro.tamanho === 50 ? 'selected' : ''}>50 por página</option>
          <option value="100" ${clientesFiltro.tamanho === 100 ? 'selected' : ''}>100 por página</option>
        </select>
        <button class="btn-secundario" data-clientes-pagina="anterior" ${clientesFiltro.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span>${clientesFiltro.pagina} de ${totalPaginas}</span>
        <button class="btn-secundario" data-clientes-pagina="proxima" ${clientesFiltro.pagina >= totalPaginas ? 'disabled' : ''}>Próximo →</button>
      </div>
    `;
  }

  html += `
    <div class="ds-selecao-barra" data-ds-selecao-barra hidden>
      <span class="ds-selecao-barra-contagem"></span> selecionado(s)
      <button class="ds-selecao-barra-limpar" id="btn-limpar-selecao" type="button">Limpar seleção</button>
      <button class="ds-selecao-barra-acao" id="btn-novo-disparo" type="button">Novo disparo</button>
    </div>
  `;

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-cliente').addEventListener('click', abrirModalNovoCliente);
  // Reflete seleção trazida de outra página/filtro (clientesSelecionados
  // sobrevive ao re-render de propósito — ver comentário na declaração).
  atualizarBarraSelecaoClientes();

  // O re-render (conteudo.innerHTML) recria o campo de busca do zero — sem
  // isso, o campo perde o foco/cursor no meio da digitação assim que o
  // debounce dispara. Restaura o foco (e a posição do cursor, no fim do
  // texto) no campo que estava sendo editado, se for o caso.
  if (clientesCampoFocado) {
    const campoEl = document.getElementById(clientesCampoFocado);
    if (campoEl) {
      campoEl.focus();
      campoEl.setSelectionRange(campoEl.value.length, campoEl.value.length);
    }
  }

  // Busca com debounce (não busca a cada tecla) — volta pra página 1 sempre
  // que o filtro muda, senão uma página 3 filtrada pode ficar vazia sem
  // explicação nenhuma.
  document.getElementById('clientes-filtro-busca').addEventListener('input', (e) => {
    const valor = e.target.value;
    clearTimeout(clientesFiltroDebounce);
    clientesFiltroDebounce = setTimeout(() => {
      clientesFiltro.busca = valor;
      clientesFiltro.pagina = 1;
      definirClientesCampoFocado('clientes-filtro-busca');
      renderClientes();
    }, 400);
  });
  // Só existe quando há resultados (fica junto da paginação, ver acima) —
  // lista vazia não renderiza esse select.
  const tamanhoEl = document.getElementById('clientes-tamanho');
  if (tamanhoEl) {
    tamanhoEl.addEventListener('change', (e) => {
      definirClientesCampoFocado(null);
      clientesFiltro.tamanho = Number(e.target.value);
      clientesFiltro.pagina = 1;
      renderClientes();
    });
  }
}

// ---------- Disparo manual de WhatsApp (seleção de clientes) ----------
// Passo 1 (revisão) → passo 2 (escolher modelo) → POST /api/clientes/disparo-lote
// (backend delega pro pacote compartilhado @kyvvohq/disparos — ver
// routes/disparos.js). O disparo individual (menu "⋯" de cada linha) pula
// direto pro passo 2, sem revisão (não há nada a revisar com 1 cliente só).

// Garante automacoesTemplatesCache populado (mesma cache que a tela de
// Automações usa, importada de app/modulos/automacoes.js) e filtra só os
// templates que o disparo manual sabe preencher — sem
// {{servico}}/{{data}}/{{hora}}/{{profissional}} (fazem sentido só em
// automação de agendamento, não num disparo avulso).
async function opcoesTemplateDisparoManual() {
  if (!automacoesTemplatesCache.length) {
    const dados = await api('/api/automacoes/templates-whatsapp');
    definirAutomacoesTemplatesCache((dados && dados.templates) || []);
  }
  // Nomes reais usados pelos templates aprovados hoje (confirmado ao vivo,
  // 2026-09-23) — não são os mesmos nomes que o motor de automações usa
  // internamente (cliente/salao/servico/...), são o parameter_name de
  // verdade que a Meta devolve. Mesma lista em routes/disparos.js.
  const suportados = new Set(['nome_cliente', 'nome_salao']);
  // Sem parâmetro nenhum (ex.: "hello_world") sempre serve. Com parâmetro,
  // só serve se for NOMEADO e todos os nomes forem dos que o disparo manual
  // sabe preencher (mesma regra em routes/disparos.js
  // templateCompativelComDisparoManual — a rota confere de novo, nunca
  // confia só neste filtro do front).
  return automacoesTemplatesCache.filter((t) => t.status === 'APPROVED' && (
    !t.parametros_corpo.length || (t.parametros_nomeados && t.parametros_corpo.every((nome) => suportados.has(nome)))
  ));
}

export function abrirModalDisparoSelecao() {
  const itens = Array.from(clientesSelecionadosInfo.entries());
  KyvvoDS.modalAbrir(`
    <ul class="disparo-selecao-lista">
      ${itens.map(([id, info]) => `<li>${escapeHtml(info.nome)} <span class="cliente-linha-telefone">${escapeHtml(info.telefone || '')}</span></li>`).join('')}
    </ul>
    <div class="ds-modal-acoes">
      <button type="button" class="btn-secundario" id="btn-disparo-cancelar">Cancelar</button>
      <button type="button" class="btn-primario" id="btn-disparo-proximo">Próximo</button>
    </div>
  `, { titulo: `Novo disparo — ${itens.length} selecionado(s)` });
  document.getElementById('btn-disparo-cancelar').addEventListener('click', () => KyvvoDS.modalFechar());
  document.getElementById('btn-disparo-proximo').addEventListener('click', () => {
    abrirModalDisparoTemplate(itens.map(([id]) => id), { voltarParaSelecao: true });
  });
}

export async function abrirModalDisparoTemplate(clienteIds, opts) {
  const voltarParaSelecao = !!(opts && opts.voltarParaSelecao);
  KyvvoDS.modalAbrir('<div class="vazio">Carregando modelos...</div>', { titulo: 'Novo disparo' });
  const templates = await opcoesTemplateDisparoManual();
  if (!templates.length) {
    KyvvoDS.modalAbrir(`
      <p class="modal-texto">Nenhum modelo aprovado disponível pra disparo manual (precisa de um modelo aprovado na Meta que use só {{cliente}}/{{salao}} como parâmetro).</p>
      <div class="ds-modal-acoes"><button type="button" class="btn-primario" id="btn-disparo-fechar">Entendi</button></div>
    `, { titulo: 'Novo disparo' });
    document.getElementById('btn-disparo-fechar').addEventListener('click', () => KyvvoDS.modalFechar());
    return;
  }
  KyvvoDS.modalAbrir(`
    <form id="form-disparo-template">
      <div class="modal-erro" id="disparo-erro"></div>
      <label for="disparo-template-select">Modelo aprovado (Meta)</label>
      <select id="disparo-template-select">
        ${templates.map((t) => `<option value="${escapeHtml(t.nome)}">${escapeHtml(t.nome)}</option>`).join('')}
      </select>
      <div class="ds-modal-acoes">
        ${voltarParaSelecao ? '<button type="button" class="btn-secundario" id="btn-disparo-voltar">Voltar</button>' : ''}
        <button type="submit" class="btn-primario">Disparar</button>
      </div>
    </form>
  `, { titulo: `Novo disparo — ${clienteIds.length} cliente(s)` });
  if (voltarParaSelecao) {
    document.getElementById('btn-disparo-voltar').addEventListener('click', () => abrirModalDisparoSelecao());
  }
  document.getElementById('form-disparo-template').addEventListener('submit', async (e) => {
    e.preventDefault();
    const templateNome = document.getElementById('disparo-template-select').value;
    const r = await api('/api/clientes/disparo-lote', { method: 'POST', body: JSON.stringify({ clienteIds, templateNome }) });
    if (r && r.ok === false && r.erro === 'limite_plano') {
      abrirModalDisparoLimiteExcedido(clienteIds, r);
      return;
    }
    if (!r || r.error) {
      document.getElementById('disparo-erro').textContent = (r && r.error) || 'Não foi possível disparar.';
      return;
    }
    KyvvoDS.modalFechar();
    mostrarToast(`${r.enviados} enviado(s), ${r.falhas} falha(s).`, r.falhas ? 'erro' : 'sucesso');
    clientesSelecionados.clear();
    clientesSelecionadosInfo.clear();
    renderClientes();
  });
}

function abrirModalDisparoLimiteExcedido(clienteIds, cota) {
  KyvvoDS.modalAbrir(`
    <p class="modal-texto">Seu plano não tem disparos suficientes pra essa ação (restam ${cota.restante} de ${cota.limite} este mês, e a seleção tem ${clienteIds.length}).</p>
    <div class="ds-modal-acoes">
      <button type="button" class="btn-secundario" id="btn-disparo-rever">Rever seleção</button>
      <button type="button" class="btn-primario" id="btn-disparo-comprar">Comprar pacote</button>
    </div>
  `, { titulo: 'Limite de disparos atingido' });
  document.getElementById('btn-disparo-rever').addEventListener('click', () => abrirModalDisparoSelecao());
  document.getElementById('btn-disparo-comprar').addEventListener('click', () => {
    KyvvoDS.modalFechar();
    definirAutomacoesAbaAtiva('disparos');
    // Automações não importa o roteador (selecionarMenu) de app.js — evento
    // customizado em vez de import direto, mesmo padrão já usado em
    // automacoes.js pro link "Configurações → WhatsApp".
    document.dispatchEvent(new CustomEvent('kyvvo:navegar', { detail: 'automacoes' }));
  });
}
