// Tela Financeiro (US18/US71) — livro-caixa manual + lançamentos vindos de
// agendamento. Extraído de app.js (fase 5a da modularização, 2026-10-16).
// formatarPreco continua global (window), definida em /pagamento-form.js
// (script clássico carregado antes de app.js — ver app/modulos/cadastro.js).
import { api } from '../core/api.js';
import {
  conteudo, abrirModal, fecharModal, mostrarToast, validarObrigatorios,
  formatarDataISO, formatarHora, nomeDiaSemana, inicioDaSemana,
  FORMAS_PAGAMENTO_ORDEM, FORMAS_PAGAMENTO_LABEL, configuracao,
} from '../core/shell.js';

// Livro-caixa manual simples — primeira funcionalidade real do módulo
// "financeiro" (só aparece no menu se o tenant tiver o módulo ativo, via
// carregarModulosNoMenu). Sem edição/exclusão de lançamento nesta versão —
// escopo combinado foi só registrar e listar.
let mesFinanceiroRef = new Date();
// US71 — abas Mês/Semana/Dia da página /financeiro. `semanaFinanceiroRef`/
// `diaFinanceiroRef` guardam só uma data qualquer dentro do período (o
// início real da semana é sempre recalculado via inicioDaSemana()).
let abaFinanceiroAtiva = 'dia';
let semanaFinanceiroRef = new Date();
let diaFinanceiroRef = new Date();
export let lancamentosAtuais = [];
// Movimentações: filtro por tipo (pills Todas/Receitas/Despesas) + busca
// livre (descrição/serviço/cliente), sempre client-side em cima da lista já
// carregada pro período ativo — sem endpoint próprio, a lista de um
// dia/semana/mês nunca é grande o bastante pra justificar paginação server-side.
let financeiroFiltroTipo = 'todas';
let financeiroFiltroBusca = '';
let financeiroFiltroDebounce;
let financeiroCampoFocado = null;

export function definirAbaFinanceiroAtiva(aba) {
  abaFinanceiroAtiva = aba;
}
export function definirFinanceiroFiltroTipo(tipo) {
  financeiroFiltroTipo = tipo;
}
export function definirFinanceiroCampoFocado(id) {
  financeiroCampoFocado = id;
}

const MESES_ABREV_FINANCEIRO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// "04–10 AGO 2026" — label de intervalo pra aba Semana; `inicio` já é a
// segunda-feira da semana (ver inicioDaSemana()).
function labelIntervaloSemanaFinanceiro(inicio) {
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 6);
  const diaIni = String(inicio.getDate()).padStart(2, '0');
  const diaFim = String(fim.getDate()).padStart(2, '0');
  return `${diaIni}–${diaFim} ${MESES_ABREV_FINANCEIRO[fim.getMonth()].toUpperCase()} ${fim.getFullYear()}`;
}

// US71/CA05 — abre o Financeiro já na aba/período desejado. Pensada pra ser
// chamada pelos cards do resumo financeiro na tela inicial (US70): quando as
// duas USs estiverem juntas na main, o clique de cada card troca
// `selecionarMenu('modulo:financeiro')` por esta função.
export function abrirFinanceiroComFiltro(periodo, referencia) {
  abaFinanceiroAtiva = periodo === 'dia' ? 'dia' : 'mes';
  if (abaFinanceiroAtiva === 'dia' && referencia) {
    diaFinanceiroRef = new Date(`${referencia}T12:00:00`);
  } else if (abaFinanceiroAtiva === 'mes' && referencia) {
    mesFinanceiroRef = new Date(`${referencia}-01T12:00:00`);
  }
  document.dispatchEvent(new CustomEvent('kyvvo:navegar', { detail: 'modulo:financeiro' }));
}

// Visual do componente data-ds-abas (@kyvvohq/design-system v2.7.0), mas sem
// o atributo data-ds-abas em si: Dia/Semana/Mês buscam dados diferentes por
// aba (não são 3 painéis estáticos do mesmo fetch, como Automações/
// Pagamentos), então o clique continua no handler delegado de sempre
// (data-financeiro-aba, mais abaixo) recarregando a tela inteira — só o
// estilo da lista de abas vem do DS.
function tabsFinanceiroHtml() {
  const abas = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']];
  return `
    <div class="ds-abas-lista" role="tablist" data-testid="tabs-financeiro">
      ${abas.map(([chave, rotulo]) => `
        <button type="button" class="ds-aba${abaFinanceiroAtiva === chave ? ' active' : ''}" role="tab" aria-selected="${abaFinanceiroAtiva === chave ? 'true' : 'false'}" data-financeiro-aba="${chave}">${rotulo}</button>
      `).join('')}
    </div>
  `;
}

// Indicador de status por círculo colorido — cobre todo lançamento (não só
// os vinculados a agendamento como antes): despesa (saída) sempre aparece
// como "Despesa" independente de status; entrada usa o status real
// (previsto/recebido); cancelado (qualquer tipo) sobrepõe os dois, já que
// deixou de valer pro resumo mas continua visível na lista pra conferência.
function statusLancamento(l) {
  if (l.status === 'cancelado') return { emoji: '⚪', texto: 'Cancelado' };
  if (l.tipo === 'saida') return { emoji: '🔴', texto: 'Despesa' };
  if (l.status === 'previsto') return { emoji: '🟡', texto: 'Previsto' };
  return { emoji: '🟢', texto: 'Recebido' };
}

// l.data vem do driver pg como Date (coluna tipo `date`), que serializa em
// JSON como ISO completo ("...T00:00:00.000Z"), não "YYYY-MM-DD" puro —
// .slice(0, 10) normaliza os dois formatos antes de montar a data local ao
// meio-dia (evita virada de dia por fuso, mesmo padrão de formatarDataCurtaISO).
// Compartilhada entre o item da lista e o filtro de busca (lancamentosFiltrados).
function dataLancamentoLabel(l) {
  return new Date(l.data.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// Ações disponíveis por lançamento, na ordem de exibição do menu — varia
// por origem/tipo/status. Cancelado é estado final (só leitura, fica na
// lista pra conferência); todo o resto ganha pelo menos "Editar".
function acoesLancamento(l) {
  if (l.status === 'cancelado') return [];
  const acoes = [];
  if (l.origem === 'agendamento' && l.status === 'previsto') {
    acoes.push({ acao: 'confirmar', label: 'Confirmar pagamento' });
    acoes.push({ acao: 'cancelar', label: 'Cancelar pagamento', perigo: true });
    acoes.push({ acao: 'reagendar', label: 'Reagendar' });
  }
  acoes.push({ acao: 'editar', label: 'Editar' });
  if (l.origem === 'manual' && l.tipo === 'saida') {
    acoes.push({ acao: 'cancelar-despesa', label: 'Cancelar despesa', perigo: true });
  }
  return acoes;
}

export function renderLancamentoItem(l) {
  const classeTipo = l.tipo === 'entrada' ? 'financeiro-entrada' : 'financeiro-saida';
  const origemAgendamento = l.origem === 'agendamento';

  // Na aba Dia o período já está óbvio pelo nav — mostra a hora real do
  // atendimento em vez da data (só existe pra lançamento de agendamento,
  // via a.data_hora; manual não tem hora, mostra a data mesmo). Nas abas
  // Semana/Mês (múltiplos dias na mesma lista) sempre mostra a data.
  const horaOuData = (abaFinanceiroAtiva === 'dia' && origemAgendamento && l.data_hora) ? formatarHora(l.data_hora) : dataLancamentoLabel(l);

  // CA "Cenário 8" — lançamento de agendamento identifica cliente/serviço/
  // data do atendimento; l.descricao (editável via "Editar", ver
  // abrirModalEditarLancamento) sobrepõe o nome do serviço quando presente.
  // CAVEAT: num lançamento de agendamento, sincronizarLancamentoFinanceiro
  // reescreve descricao/valor pro nome/preço do serviço sempre que o
  // agendamento muda de estado de novo (reagendar, por exemplo) — uma
  // descrição/valor editados manualmente aqui podem ser sobrescritos nesse
  // caso. Aceitável: é raro editar e depois reagendar o mesmo atendimento.
  const titulo = l.descricao || (origemAgendamento ? l.servico : (l.tipo === 'entrada' ? 'Entrada' : 'Saída'));
  // Forma de pagamento só existe depois de "Confirmar pagamento" (US64) —
  // some sozinha do detalhe quando ainda é receita prevista.
  const formaPagamentoLabel = l.forma_pagamento ? (FORMAS_PAGAMENTO_LABEL[l.forma_pagamento] || l.forma_pagamento) : null;
  const detalhe = origemAgendamento ? [`${l.cliente || 'Cliente'} · Agendamento`, formaPagamentoLabel].filter(Boolean).join(' · ') : '';
  const valorLabel = l.tipo === 'saida' ? `- ${formatarPreco(l.valor)}` : formatarPreco(l.valor);
  // Valor líquido (Preferências > Formas de pagamento) só aparece quando
  // difere do bruto — tenant sem taxa configurada pra essa forma nunca vê
  // essa linha a mais (valor_liquido sai igual a valor nesse caso).
  const temValorLiquido = l.valor_liquido != null && Number(l.valor_liquido) !== Number(l.valor);
  const status = statusLancamento(l);
  const acoes = acoesLancamento(l);

  return `
    <div class="agendamento-item financeiro-item" data-testid="lancamento-item">
      <div class="agendamento-linha-principal" ${acoes.length ? `data-acoes-toggle="lancamento-${l.id}"` : ''}>
        <div class="financeiro-item-hora">${horaOuData}</div>
        <div class="financeiro-item-corpo">
          <div class="agendamento-hora">${titulo}</div>
          ${detalhe ? `<div class="agendamento-detalhe">${detalhe}</div>` : ''}
        </div>
        <div class="financeiro-item-valor">
          <div class="${classeTipo}">${valorLabel}</div>
          ${temValorLiquido ? `<div class="financeiro-item-liquido">Líquido: ${formatarPreco(l.valor_liquido)}</div>` : ''}
          <div class="financeiro-item-status">${status.emoji} ${status.texto}</div>
        </div>
        ${acoes.length ? '<button class="btn-acoes" aria-label="Ações">⋮</button>' : ''}
      </div>
      ${acoes.length ? `
        <div class="menu-acoes" id="menu-acoes-lancamento-${l.id}">
          ${acoes.map((a) => `<button data-acao-lancamento="${a.acao}" data-id="${l.id}"${a.perigo ? ' class="acao-perigo"' : ''}>${a.label}</button>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// Confirmar pagamento pede a forma de pagamento antes de confirmar — fica
// registrada no lançamento e aparece no histórico de atendimentos do
// cliente (menu Clientes). Reaproveita o mesmo PATCH que abrirModalConcluir
// usa no menu da Agenda — sincronizarLancamentoFinanceiro (US64) já converte
// o lançamento de previsto pra realizado sozinho, sem endpoint próprio.
// Formas habilitadas em Preferências (configuracao.formas_pagamento) viram
// as opções aqui; tenant que nunca configurou nada (objeto vazio) cai nas 4
// opções legadas de sempre, sem cálculo de taxa — zero mudança de
// comportamento pra quem não usa a feature nova.
function opcoesFormaPagamento() {
  const configuradas = configuracao.formas_pagamento || {};
  const ativas = FORMAS_PAGAMENTO_ORDEM.filter((chave) => configuradas[chave] && configuradas[chave].ativo);
  if (ativas.length) return ativas;
  return ['pix', 'cartao', 'dinheiro', 'outro'];
}

export function confirmarPagamentoLancamento(l) {
  const opcoes = opcoesFormaPagamento();
  abrirModal(
    '<h3>Confirmar pagamento</h3>',
    `
      <p class="modal-texto">Qual foi a forma de pagamento?</p>
      <div class="forma-pagamento-opcoes">
        ${opcoes.map((chave, i) => `
          <label class="forma-pagamento-opcao"><input type="radio" name="forma-pagamento" value="${chave}" ${i === 0 ? 'checked' : ''}> ${FORMAS_PAGAMENTO_LABEL[chave]}</label>
        `).join('')}
      </div>
      <div class="modal-erro" id="confirmar-pagamento-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-confirmar-pagamento">Sair</button>
        <button class="btn-primario" id="btn-confirmar-pagamento-lancamento">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-confirmar-pagamento').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-pagamento-lancamento').addEventListener('click', async () => {
    const formaPagamento = document.querySelector('input[name="forma-pagamento"]:checked').value;
    const btn = document.getElementById('btn-confirmar-pagamento-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${l.agendamento_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'concluido', forma_pagamento: formaPagamento }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pagamento confirmado.', 'sucesso');
      renderFinanceiro();
    } else {
      document.getElementById('confirmar-pagamento-erro').textContent = (resultado && resultado.error) || 'Erro ao confirmar pagamento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// PR4 — Cancelar pagamento segue o mesmo padrão de abrirModalCancelar (ST08.4),
// com o texto de aviso pedido explicitamente ("operação não pode ser
// desfeita"). Mesmo PATCH — sincronizarLancamentoFinanceiro remove o valor
// do previsto quando o agendamento é cancelado.
export function abrirModalCancelarPagamentoLancamento(l) {
  abrirModal(
    '<h3>Cancelar pagamento</h3>',
    `
      <p class="modal-texto">Deseja cancelar, essa operação não pode ser desfeita?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-cancelar-pagamento">Sair</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar-pagamento">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-cancelar-pagamento').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar-pagamento').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar-pagamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${l.agendamento_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pagamento cancelado.', 'sucesso');
      renderFinanceiro();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar pagamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// "Editar" (valor/descrição) — disponível em todo lançamento não-cancelado
// (menu de 3 pontos, ver acoesLancamento). PATCH /api/financeiro/lancamentos/:id
// aceita os dois campos direto na linha, sem depender do agendamento de origem.
export function abrirModalEditarLancamento(l) {
  abrirModal(
    '<h3>Editar lançamento</h3>',
    `
      <form id="form-editar-lancamento">
        <div class="modal-erro" id="editar-lancamento-erro"></div>
        <label for="editar-lancamento-valor">Valor em R$ *</label>
        <input type="number" id="editar-lancamento-valor" data-obrigatorio min="0.01" step="0.01" value="${l.valor}">
        <label for="editar-lancamento-descricao">Descrição</label>
        <input type="text" id="editar-lancamento-descricao" value="${l.descricao || ''}" placeholder="${l.origem === 'agendamento' ? l.servico : (l.tipo === 'entrada' ? 'Entrada' : 'Saída')}">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-editar-lancamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-editar-lancamento">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-editar-lancamento').addEventListener('click', fecharModal);
  const form = document.getElementById('form-editar-lancamento');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('editar-lancamento-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      invalido.focus();
      return;
    }
    const btn = document.getElementById('btn-salvar-editar-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/financeiro/lancamentos/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        valor: parseFloat(document.getElementById('editar-lancamento-valor').value),
        descricao: document.getElementById('editar-lancamento-descricao').value.trim() || null,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Lançamento atualizado.', 'sucesso');
      renderFinanceiro();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar lançamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

// "Cancelar despesa" — só existe em lançamento manual de saída (menu de 3
// pontos). Mesmo padrão de abrirModalCancelarPagamentoLancamento, mas marca
// o próprio lançamento como cancelado direto (não depende de agendamento).
export function abrirModalCancelarDespesaLancamento(l) {
  abrirModal(
    '<h3>Cancelar despesa</h3>',
    `
      <p class="modal-texto">Deseja cancelar, essa operação não pode ser desfeita?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-sair-cancelar-despesa">Sair</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar-despesa">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-sair-cancelar-despesa').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar-despesa').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar-despesa');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/financeiro/lancamentos/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Despesa cancelada.', 'sucesso');
      renderFinanceiro();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar despesa.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

function referenciaFinanceiroAtiva() {
  if (abaFinanceiroAtiva === 'semana') return formatarDataISO(inicioDaSemana(semanaFinanceiroRef));
  if (abaFinanceiroAtiva === 'dia') return formatarDataISO(diaFinanceiroRef);
  return formatarDataISO(mesFinanceiroRef).slice(0, 7);
}

// Nav do período compacto — "← RÓTULO →", só setas (sem "Dia anterior"/"Mês
// anterior" por extenso, texto vira aria-label pra acessibilidade).
function navPeriodoFinanceiroHtml() {
  if (abaFinanceiroAtiva === 'semana') {
    const inicio = inicioDaSemana(semanaFinanceiroRef);
    return `
      <div class="nav-periodo">
        <button data-nav="-1" aria-label="Semana anterior" data-testid="nav-semana-anterior">←</button>
        <strong>${labelIntervaloSemanaFinanceiro(inicio)}</strong>
        <button data-nav="1" aria-label="Próxima semana" data-testid="nav-semana-proxima">→</button>
      </div>
    `;
  }
  if (abaFinanceiroAtiva === 'dia') {
    const dataLabel = `${String(diaFinanceiroRef.getDate()).padStart(2, '0')} ${MESES_ABREV_FINANCEIRO[diaFinanceiroRef.getMonth()].toUpperCase()} ${diaFinanceiroRef.getFullYear()}`;
    return `
      <div class="nav-periodo">
        <button data-nav="-1" aria-label="Dia anterior" data-testid="nav-dia-anterior">←</button>
        <div class="nav-periodo-data">
          <strong>${dataLabel}</strong>
          <div class="nav-periodo-dia-semana">${nomeDiaSemana(diaFinanceiroRef)}</div>
        </div>
        <button data-nav="1" aria-label="Próximo dia" data-testid="nav-dia-proximo">→</button>
      </div>
    `;
  }
  const mesLabel = `${mesFinanceiroRef.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).toUpperCase()} ${mesFinanceiroRef.getFullYear()}`;
  return `
    <div class="nav-periodo">
      <button data-nav="-1" aria-label="Mês anterior" data-testid="nav-mes-anterior">←</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1" aria-label="Próximo mês" data-testid="nav-mes-proximo">→</button>
    </div>
  `;
}

function bindNavPeriodoFinanceiro() {
  const btnAnterior = conteudo.querySelector('[data-nav="-1"]');
  const btnProximo = conteudo.querySelector('[data-nav="1"]');
  if (abaFinanceiroAtiva === 'semana') {
    btnAnterior.addEventListener('click', () => { semanaFinanceiroRef.setDate(semanaFinanceiroRef.getDate() - 7); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { semanaFinanceiroRef.setDate(semanaFinanceiroRef.getDate() + 7); renderFinanceiro(); });
  } else if (abaFinanceiroAtiva === 'dia') {
    btnAnterior.addEventListener('click', () => { diaFinanceiroRef.setDate(diaFinanceiroRef.getDate() - 1); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { diaFinanceiroRef.setDate(diaFinanceiroRef.getDate() + 1); renderFinanceiro(); });
  } else {
    btnAnterior.addEventListener('click', () => { mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() - 1); renderFinanceiro(); });
    btnProximo.addEventListener('click', () => { mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() + 1); renderFinanceiro(); });
  }
}

const FINANCEIRO_FILTRO_TIPO_PILLS = [
  ['todas', 'Todas'],
  ['entrada', 'Receitas'],
  ['saida', 'Despesas'],
];

// Filtra a lista já carregada do período ativo por tipo (pill) + busca livre
// por data, nome do cliente, descrição do lançamento (serviço ou descrição
// manual) ou valor — nunca refaz a chamada à API, só reaplica em cima de
// lancamentosAtuais.
function lancamentosFiltrados() {
  const busca = financeiroFiltroBusca.trim().toLowerCase();
  return lancamentosAtuais.filter((l) => {
    if (financeiroFiltroTipo !== 'todas' && l.tipo !== financeiroFiltroTipo) return false;
    if (!busca) return true;
    const alvo = `${dataLancamentoLabel(l)} ${l.cliente || ''} ${l.servico || ''} ${l.descricao || ''} ${formatarPreco(l.valor)}`.toLowerCase();
    return alvo.includes(busca);
  });
}

// PR4 — as 3 abas (Dia/Semana/Mês) usam o mesmo endpoint unificado
// (?periodo=dia|semana|mes&referencia=...) e os mesmos 4 cards (Prevista/
// Recebida/Despesas/Resultado) — só nav do período e o gráfico (só Mês)
// mudam por aba. Movimentações (lista) sempre visível, com filtro por tipo
// e busca — sem colapso "ver detalhamento" como antes.
export async function renderFinanceiro() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const periodo = abaFinanceiroAtiva;
  const referencia = referenciaFinanceiroAtiva();
  const data = await api(`/api/financeiro/lancamentos?periodo=${periodo}&referencia=${referencia}`);
  if (!data) return;

  lancamentosAtuais = data.lancamentos;
  // Decisão confirmada com o Bruno: Resultado = Previsto − Saídas (literal,
  // não soma a Receita Recebida, que já aparece separada no card ao lado).
  const resultado = data.resumo.previsto - data.resumo.saidas;

  let html = `
    <div class="inicio-cabecalho">
      <div>
        <h2>Financeiro</h2>
        <p class="financeiro-subtitulo">Acompanhe as finanças do seu salão.</p>
      </div>
      <button class="btn-novo-agendamento" id="btn-novo-lancamento">+ Novo lançamento</button>
    </div>
  ` + tabsFinanceiroHtml() + navPeriodoFinanceiroHtml() + `
    <div class="financeiro-resumo">
      <div class="financeiro-resumo-card" data-testid="card-previsto">
        <div class="financeiro-resumo-label">Prevista</div>
        <div class="financeiro-previsto">${formatarPreco(data.resumo.previsto)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-realizado">
        <div class="financeiro-resumo-label">Recebida</div>
        <div class="financeiro-entrada">${formatarPreco(data.resumo.realizado)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-saidas">
        <div class="financeiro-resumo-label">Despesas</div>
        <div class="financeiro-saida">${formatarPreco(data.resumo.saidas)}</div>
      </div>
      <div class="financeiro-resumo-card" data-testid="card-total">
        <div class="financeiro-resumo-label">Resultado</div>
        <div class="${resultado >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(resultado)}</div>
      </div>
    </div>
  `;

  // Mesmo layout do menu Clientes: busca full-width numa linha, pills de
  // filtro logo abaixo numa grid de colunas iguais (lado a lado).
  const filtrados = lancamentosFiltrados();
  html += `
    <h3 class="inicio-secao-titulo">Movimentações</h3>
    <div class="financeiro-filtros">
      <input type="text" id="financeiro-filtro-busca" placeholder="🔎 Buscar por data, cliente, descrição ou valor" value="${financeiroFiltroBusca}">
    </div>
    <div class="financeiro-filtro-pills">
      ${FINANCEIRO_FILTRO_TIPO_PILLS.map(([valor, label]) => `<button type="button" class="chip-status${financeiroFiltroTipo === valor ? ' chip-status-ativo' : ''}" data-financeiro-filtro-tipo="${valor}">${label}</button>`).join('')}
    </div>
  `;

  if (!data.lancamentos.length) {
    html += '<div class="vazio">Nenhuma movimentação no período.</div>';
  } else if (!filtrados.length) {
    html += '<div class="vazio">Nenhuma movimentação encontrada.</div>';
  } else {
    html += `<div data-testid="lista-lancamentos">${filtrados.map(renderLancamentoItem).join('')}</div>`;
  }

  conteudo.innerHTML = html;
  bindNavPeriodoFinanceiro();
  document.getElementById('btn-novo-lancamento').addEventListener('click', abrirModalLancamento);

  if (financeiroCampoFocado) {
    const campoEl = document.getElementById(financeiroCampoFocado);
    if (campoEl) {
      campoEl.focus();
      campoEl.setSelectionRange(campoEl.value.length, campoEl.value.length);
    }
  }
  document.getElementById('financeiro-filtro-busca').addEventListener('input', (e) => {
    const valor = e.target.value;
    clearTimeout(financeiroFiltroDebounce);
    financeiroFiltroDebounce = setTimeout(() => {
      financeiroFiltroBusca = valor;
      financeiroCampoFocado = 'financeiro-filtro-busca';
      renderFinanceiro();
    }, 400);
  });
}

function abrirModalLancamento() {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo lançamento</h3>',
    `
      <form id="form-lancamento">
        <div class="modal-erro" id="lancamento-erro"></div>
        <label for="lancamento-tipo">Tipo *</label>
        <select id="lancamento-tipo" data-obrigatorio>
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
        </select>
        <label for="lancamento-valor">Valor em R$ *</label>
        <input type="number" id="lancamento-valor" data-obrigatorio min="0.01" step="0.01">
        <label for="lancamento-data">Data *</label>
        <input type="date" id="lancamento-data" data-obrigatorio value="${hoje}">
        <label for="lancamento-descricao">Descrição (opcional)</label>
        <input type="text" id="lancamento-descricao" placeholder="Ex: venda do dia, compra de material...">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-lancamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-lancamento">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-lancamento').addEventListener('click', fecharModal);

  const form = document.getElementById('form-lancamento');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('lancamento-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      tipo: document.getElementById('lancamento-tipo').value,
      valor: parseFloat(document.getElementById('lancamento-valor').value),
      data: document.getElementById('lancamento-data').value,
      descricao: document.getElementById('lancamento-descricao').value.trim() || null,
    };

    const resultado = await api('/api/financeiro/lancamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Lançamento registrado com sucesso.', 'sucesso');
      renderFinanceiro();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar lançamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}
