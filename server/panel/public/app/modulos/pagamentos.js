// Tela "Plano e cobrança" (US32/US35/US36/US37) — extraído de app.js (fase
// 5b da modularização, 2026-10-16). formatarPreco, formatarDataCurtaISO,
// htmlFormPagamento e wireFormPagamento continuam globais (window), definidas
// em /pagamento-form.js (script clássico carregado antes de app.js — ver
// app/modulos/cadastro.js e financeiro.js, mesmo padrão).
import { api } from '../core/api.js';
import { conteudo, abrirModal, fecharModal, mostrarToast } from '../core/shell.js';

const PAGAMENTOS_STATUS_LABEL = {
  trial: 'Trial',
  ativo: 'Ativo',
  inadimplente: 'Inadimplente',
  suspenso: 'Suspenso',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};
const PAGAMENTOS_STATUS_BADGE = {
  trial: 'badge-trial-ativo',
  ativo: 'badge-status-ativo',
  inadimplente: 'badge-status-inadimplente',
  suspenso: 'badge-status-suspenso',
  expirado: 'badge-trial-expirado',
  cancelado: 'badge-status-inativo',
};

// Status de cada cobrança individual no histórico (vem direto da Asaas,
// diferente do status da assinatura acima). PENDING = amarelo, CONFIRMED/
// RECEIVED = verde, OVERDUE/CANCELED/REFUNDED = vermelho.
const HISTORICO_STATUS_LABEL = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Confirmado',
  OVERDUE: 'Vencido',
  CANCELED: 'Cancelado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Cancelado',
};
const HISTORICO_STATUS_BADGE = {
  PENDING: 'badge-pagamento-pending',
  CONFIRMED: 'badge-pagamento-confirmado',
  RECEIVED: 'badge-pagamento-confirmado',
  OVERDUE: 'badge-pagamento-cancelado',
  CANCELED: 'badge-pagamento-cancelado',
  CANCELLED: 'badge-pagamento-cancelado',
  REFUNDED: 'badge-pagamento-cancelado',
};
function renderHistoricoStatus(status) {
  const classe = HISTORICO_STATUS_BADGE[status] || 'badge-status-inativo';
  const label = HISTORICO_STATUS_LABEL[status] || status;
  return `<span class="badge ${classe}">${label}</span>`;
}

// formatarDataCurtaISO agora vive em pagamento-form.js (US52).

// CA01-CA06 (US36) — bloco de status do trial na aba de pagamentos: badge +
// barra de progresso + CTA, com 3 estados (ativo / expirando ≤3 dias /
// expirado) derivados de trial_ativo e trial_dias_restantes.
function renderBlocoTrial(trialInfo) {
  const diasRestantes = trialInfo.trial_dias_restantes;
  const percentual = trialInfo.trial_percentual != null ? Math.min(100, Math.max(0, trialInfo.trial_percentual)) : 0;
  const corBarra = percentual > 80 ? 'trial-barra-vermelha' : percentual > 50 ? 'trial-barra-amarela' : 'trial-barra-verde';

  let badgeClasse = 'badge-trial-ativo';
  let badgeTexto = 'TRIAL ATIVO';
  let mensagem = 'Você está no período gratuito de 14 dias.';
  let cta = trialInfo.trial_fim
    ? `Garanta seu acesso — cadastre uma forma de pagamento agora e não pague nada até ${formatarDataCurtaISO(trialInfo.trial_fim)}.`
    : '';

  if (!trialInfo.trial_ativo) {
    badgeClasse = 'badge-trial-expirado';
    badgeTexto = 'TRIAL EXPIRADO';
    mensagem = 'Seu período gratuito encerrou. Cadastre uma forma de pagamento para continuar usando o Kyvvo.';
    cta = '';
  } else if (diasRestantes != null && diasRestantes <= 3) {
    badgeClasse = 'badge-trial-expirando';
    badgeTexto = 'TRIAL EXPIRANDO';
    mensagem = `Seu trial expira em ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}. Cadastre um pagamento para não perder o acesso.`;
  }

  const progresso = trialInfo.trial_inicio && trialInfo.trial_fim
    ? `
      <div class="trial-progresso">
        <div class="trial-progresso-barra"><div class="trial-progresso-preenchido ${corBarra}" style="width:${percentual}%"></div></div>
        <div class="trial-progresso-legenda">
          <span>Início: ${formatarDataCurtaISO(trialInfo.trial_inicio)}</span>
          <span>Término: ${formatarDataCurtaISO(trialInfo.trial_fim)}</span>
        </div>
        <div class="trial-progresso-dias">
          <strong>${trialInfo.trial_ativo ? `${diasRestantes} dias restantes` : 'Trial encerrado'}</strong>
          <span>${trialInfo.trial_dias_utilizados} de 14 dias utilizados</span>
        </div>
      </div>
    `
    : '';

  return `
    <div class="trial-status-bloco">
      <span class="badge ${badgeClasse}">${badgeTexto}</span>
      <p class="modal-texto">${mensagem}</p>
      ${progresso}
      ${cta ? `<p class="modal-texto">${cta}</p>` : ''}
    </div>
  `;
}

function formatarMeioHistorico(meio) {
  if (meio === 'PIX') return 'Pix';
  if (meio === 'CREDIT_CARD') return 'Cartão de crédito';
  return meio || '—';
}

// "Plano e cobrança" em 3 abas (Planos / Cobrança / Histórico), componente
// data-ds-abas do @kyvvohq/design-system (v2.7.0) — as 3 vêm do mesmo fetch,
// então os 3 painéis nascem prontos no DOM e a troca é só show/hide via DS,
// sem re-render. A lógica condicional por status (trial com/sem pagamento
// agendado, sem meio cadastrado, ativo/inadimplente/suspenso/cancelado) é a
// mesma de sempre, só reorganizada em qual das 3 strings de HTML cada pedaço
// cai.
let abaPagamentosAtiva = 'planos';

export async function renderPagamentos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [dados, planosDisponiveis] = await Promise.all([
    api('/api/pagamentos'),
    api('/api/planos'),
  ]);
  if (!dados) return;

  const meioLabel = dados.meio_pagamento === 'cartao'
    ? `Cartão •••• ${dados.cartao_final || '----'}`
    : dados.meio_pagamento === 'pix'
      ? 'Pix recorrente'
      : 'Não cadastrado';

  let planosHtml = '';
  let cobrancaHtml = '';
  let historicoHtml = '';

  if (dados.status === 'trial' && dados.meio_pagamento) {
    // CA05 (US37) — pagamento já cadastrado durante o trial: a cobrança está
    // agendada pro fim do trial, mas ainda não aconteceu (por isso o tenant
    // continua em 'trial', não 'ativo' — ver /api/pagamentos/cadastrar).
    planosHtml = `
      <div class="financeiro-resumo-card financeiro-resumo-card-3linhas" style="margin-bottom:16px">
        <div class="financeiro-resumo-label">Plano Atual</div>
        <div class="financeiro-resumo-linha2">${dados.plano_nome || 'A definir'}</div>
        <div class="financeiro-resumo-linha3">${dados.valor_plano != null ? formatarPreco(dados.valor_plano) : '—'}</div>
      </div>
    `;
    cobrancaHtml = `
      <div class="financeiro-resumo">
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas">
          <div class="financeiro-resumo-label">Meio de pagamento</div>
          <div class="financeiro-resumo-linha2">${meioLabel}</div>
          <div class="financeiro-resumo-linha3">—</div>
        </div>
        <div class="financeiro-resumo-card financeiro-resumo-card-3linhas status-card-pendente">
          <div class="financeiro-resumo-label">Status</div>
          <div class="financeiro-resumo-linha2">Trial com pagamento agendado</div>
        </div>
      </div>
      <p class="modal-texto">
        Próxima cobrança: ${dados.proxima_cobranca ? `${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}` : 'não disponível'}
      </p>
      <button class="btn-secundario" id="btn-cadastrar-pagamento">Alterar forma de pagamento</button>
    `;
  } else if (dados.status === 'trial') {
    const trialInfo = await api('/api/pagamentos/status');
    if (!trialInfo) return;

    planosHtml = `
      <div class="financeiro-resumo-card" style="margin-bottom:16px">
        <div class="financeiro-resumo-label">Plano atual</div>
        <div>${dados.plano_nome || 'A definir'}${dados.valor_plano != null ? ` — ${formatarPreco(dados.valor_plano)}/mês após o trial` : ''}</div>
      </div>
    `;
    cobrancaHtml = `
      ${renderBlocoTrial(trialInfo)}
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">${trialInfo.trial_ativo ? 'Cadastrar pagamento' : 'Escolher plano'}</button>
    `;
  } else if (!dados.meio_pagamento) {
    cobrancaHtml = `
      <p class="modal-texto">Nenhum meio de pagamento cadastrado.</p>
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">Cadastrar forma de pagamento</button>
    `;
  } else {
    // CA01/CA04/CA06 (US35) — cancelado é um estado à parte: some o botão de
    // "Alterar plano" (não há mais assinatura ativa pra alterar) e mostra
    // "Reativar assinatura" no lugar; o collapse "Alterar forma de pagar"
    // (com "Cancelar assinatura" dentro) só aparece com status 'ativo'/
    // inadimplente/suspenso — quem já cancelou não tem mais assinatura pra
    // alterar/cancelar de novo.
    const cancelado = dados.status === 'cancelado';
    const ativo = dados.status === 'ativo';
    const statusBadgeClasse = PAGAMENTOS_STATUS_BADGE[dados.status] || 'badge-status-inativo';

    planosHtml = `
      <div class="pagamento-plano-card">
        <div class="pagamento-plano-linha">
          <span class="pagamento-plano-nome">${dados.plano_nome || '—'}</span>
          <span class="pagamento-plano-valor">${dados.valor_plano != null ? formatarPreco(dados.valor_plano) : '—'}</span>
        </div>
        <div class="pagamento-plano-linha pagamento-plano-linha-secundaria">
          <span>${meioLabel}</span>
          <span>${dados.ciclo || 'Mensal'}</span>
        </div>
        <div class="pagamento-plano-linha pagamento-plano-linha-secundaria">
          <span class="badge ${statusBadgeClasse}">${PAGAMENTOS_STATUS_LABEL[dados.status] || dados.status}</span>
          ${cancelado
            ? '<button type="button" class="btn-primario btn-pequeno" id="btn-reativar-pagamento">Reativar assinatura</button>'
            : '<button type="button" class="btn-secundario btn-pequeno" id="btn-trocar-plano">Alterar plano</button>'}
        </div>
      </div>
    `;

    cobrancaHtml = `
      ${cancelado
        ? `<p class="modal-texto">Seu acesso está ativo até ${formatarDataCurtaISO(dados.acesso_ate)}. Após essa data, o sistema será suspenso.</p>`
        : `<p class="modal-texto">
            Próxima cobrança: ${dados.proxima_cobranca
              ? `${dados.proxima_cobranca.plano_nome || dados.plano_nome || 'Plano'}, ${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}`
              : 'não disponível'}
          </p>`}

      ${cancelado ? '' : `
        <div class="pagamento-detalhes">
          <h4 class="pagamento-detalhes-titulo">Alterar forma de pagar</h4>
          <div class="pagamento-detalhes-conteudo" id="pagamento-detalhes-conteudo">
            ${htmlFormPagamento(dados, {
              comBotaoCancelar: false,
              botoesPequenos: true,
              botaoExtraHtml: ativo ? '<button type="button" class="btn-perigo btn-pequeno" id="btn-cancelar-assinatura">Cancelar assinatura</button>' : '',
            })}
          </div>
        </div>
      `}
    `;

    const historico = dados.historico || [];
    historicoHtml = `
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Data da cobrança</th><th>Plano</th><th>Valor</th><th>Tipo</th><th>Meio de pagamento</th><th>Status</th></tr></thead>
          <tbody>
            ${historico.length
              ? historico.map((h) => `<tr><td>${formatarDataCurtaISO(h.data)}</td><td>${h.plano_nome || '—'}</td><td>${formatarPreco(h.valor)}</td><td>${h.ciclo || 'Mensal'}</td><td>${formatarMeioHistorico(h.meio)}</td><td>${renderHistoricoStatus(h.status)}</td></tr>`).join('')
              : '<tr><td colspan="6">Nenhuma cobrança registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  // Aba Planos sempre ganha a lista de planos disponíveis (vitrine
  // read-only, comparação lado a lado) — trocar de plano continua sendo
  // pelo botão "Alterar plano" (abre o mesmo modal de sempre, com
  // confirmação); a lista aqui não decide nada sozinha, só informa.
  planosHtml += renderListaPlanosDisponiveis(planosDisponiveis, dados.plano_slug);
  if (!historicoHtml) historicoHtml = '<p class="modal-texto">Sem cobranças registradas ainda.</p>';

  const html = `
    <div class="nav-periodo"><strong>Plano e cobrança</strong></div>
    <div class="ds-abas" data-ds-abas>
      <div class="ds-abas-lista">
        <button type="button" class="ds-aba" id="aba-pagamentos-planos" aria-controls="painel-pagamentos-planos" aria-selected="${abaPagamentosAtiva === 'planos' ? 'true' : 'false'}">Planos</button>
        <button type="button" class="ds-aba" id="aba-pagamentos-cobranca" aria-controls="painel-pagamentos-cobranca" aria-selected="${abaPagamentosAtiva === 'cobranca' ? 'true' : 'false'}">Cobrança</button>
        <button type="button" class="ds-aba" id="aba-pagamentos-historico" aria-controls="painel-pagamentos-historico" aria-selected="${abaPagamentosAtiva === 'historico' ? 'true' : 'false'}">Histórico</button>
      </div>
      <div class="ds-abas-painel" id="painel-pagamentos-planos" aria-labelledby="aba-pagamentos-planos" ${abaPagamentosAtiva === 'planos' ? '' : 'hidden'}>${planosHtml}</div>
      <div class="ds-abas-painel" id="painel-pagamentos-cobranca" aria-labelledby="aba-pagamentos-cobranca" ${abaPagamentosAtiva === 'cobranca' ? '' : 'hidden'}>${cobrancaHtml}</div>
      <div class="ds-abas-painel" id="painel-pagamentos-historico" aria-labelledby="aba-pagamentos-historico" ${abaPagamentosAtiva === 'historico' ? '' : 'hidden'}>${historicoHtml}</div>
    </div>
  `;

  conteudo.innerHTML = html;
  conteudo.querySelector('.ds-abas').addEventListener('ds-abas-alterar', (e) => {
    abaPagamentosAtiva = e.detail.id === 'painel-pagamentos-cobranca' ? 'cobranca'
      : e.detail.id === 'painel-pagamentos-historico' ? 'historico' : 'planos';
  });
  const btnCadastrar = document.getElementById('btn-cadastrar-pagamento');
  if (btnCadastrar) btnCadastrar.addEventListener('click', () => abrirModalPagamento(dados));
  const btnReativar = document.getElementById('btn-reativar-pagamento');
  if (btnReativar) btnReativar.addEventListener('click', () => abrirModalPagamento(dados));
  const btnTrocarPlano = document.getElementById('btn-trocar-plano');
  if (btnTrocarPlano) btnTrocarPlano.addEventListener('click', () => abrirModalTrocarPlano(dados));

  // "Alterar forma de pagar" (aba Cobrança) — pedido explícito: sem collapse,
  // os campos já ficam direto na página (antes era um toggle "▾" escondendo
  // o formulário; `pagamento-detalhes-conteudo` agora nunca começa `hidden`,
  // ver o HTML acima). Só existe fora do estado 'cancelado'.
  const painelDetalhes = document.getElementById('pagamento-detalhes-conteudo');
  if (painelDetalhes) {
    wireFormPagamento(dados, { onSucesso: () => renderPagamentos() });
    const btnCancelarAssinatura = document.getElementById('btn-cancelar-assinatura');
    if (btnCancelarAssinatura) btnCancelarAssinatura.addEventListener('click', () => abrirModalCancelarAssinatura(dados));
  }
}

// Grade de cards lado a lado (mesmo layout de .planos-preview/.plano-card do
// plano-cobranca.html do People) — vitrine read-only, trocar de plano
// continua sendo pelo botão "Alterar plano" (abre abrirModalTrocarPlano,
// que mantém a lista em linha com rádio, outro contexto/largura).
function renderListaPlanosDisponiveis(planos, planoSlugAtual) {
  if (!planos || !planos.length) return '';
  const cards = planos.map((p) => {
    const atual = p.slug === planoSlugAtual;
    return `
      <div class="plano-card${atual ? ' atual' : ''}">
        <div class="nome">${p.nome}${atual ? ' <span class="badge badge-status-ativo">Seu plano</span>' : ''}</div>
        <div class="preco">${formatarPreco(Number(p.preco_mensal))}<span style="font-size:12px;color:var(--muted)">/mês</span></div>
        ${p.frase_beneficio ? `<div class="detalhe">${p.frase_beneficio}</div>` : ''}
        ${detalhesLimitesPlano(p.limites)}
      </div>
    `;
  }).join('');
  return `
    <div class="pagamento-secao-divisor"></div>
    <h3 class="inicio-secao-titulo">Planos disponíveis</h3>
    <div class="planos-preview">${cards}</div>
  `;
}

// Rótulos dos limites vindos de GET /api/planos (plano.limites) — mesmo
// conteúdo/categorias já usadas na grade de preços da landing
// (server/public/index.html, PLANO_LIMITE_ROTULOS), duplicado aqui porque as
// duas telas vivem em origens diferentes.
const PLANO_TROCA_LIMITE_ROTULOS = {
  conversas_mes: { icone: '💬', singular: 'conversa/mês', plural: 'conversas/mês', ilimitado: 'Conversas ilimitadas' },
  profissionais: { icone: '👤', singular: 'profissional', plural: 'profissionais', ilimitado: 'Profissionais ilimitados' },
  unidades: { icone: '🏢', singular: 'unidade', plural: 'unidades', ilimitado: 'Unidades ilimitadas' },
};
const PLANO_TROCA_ICONES = ['⭐', '👑', '⚡', '🚀'];

function badgesLimitesPlano(limites) {
  if (!limites) return '';
  return Object.entries(PLANO_TROCA_LIMITE_ROTULOS)
    .filter(([chave]) => limites[chave] !== undefined)
    .map(([chave, rotulo]) => {
      const valor = limites[chave];
      const texto = valor == null || valor === -1
        ? rotulo.ilimitado
        : Number(valor) === 1 ? `1 ${rotulo.singular}` : `Até ${valor} ${rotulo.plural}`;
      return `<span class="plano-opcao-badge">${rotulo.icone} ${texto}</span>`;
    }).join('');
}

// Mesma fonte de limites de badgesLimitesPlano, mas como linhas de texto
// simples (.detalhe) — formato usado pelos cards de .plano-card, igual ao
// plano-cobranca.html do People.
function detalhesLimitesPlano(limites) {
  if (!limites) return '';
  return Object.entries(PLANO_TROCA_LIMITE_ROTULOS)
    .filter(([chave]) => limites[chave] !== undefined)
    .map(([chave, rotulo]) => {
      const valor = limites[chave];
      const texto = valor == null || valor === -1
        ? rotulo.ilimitado
        : Number(valor) === 1 ? `1 ${rotulo.singular}` : `Até ${valor} ${rotulo.plural}`;
      return `<div class="detalhe">${texto}</div>`;
    }).join('');
}

// Modal de troca de plano — lista só os planos ativos (GET /api/planos já
// filtra por ativo=true), com o plano atual marcado e desabilitado. Sem
// proration: a troca vale a partir da próxima cobrança (ver comentário em
// PATCH /api/pagamentos/plano no backend). Ícone/cor por posição são só
// decoração (não vêm do banco); descrição e badges de limite usam os dados
// reais já cadastrados (frase_beneficio/limites), sem inventar número novo.
async function abrirModalTrocarPlano(dadosAtuais) {
  abrirModal('<h3>Trocar de plano</h3>', '<div class="vazio">Carregando planos...</div>', 'modal-card-pagamento');
  const planos = await api('/api/planos');
  if (!planos) return;

  const opcoesHtml = planos.map((p, i) => {
    const atual = p.slug === dadosAtuais.plano_slug;
    return `
      <label class="plano-opcao${atual ? ' plano-opcao-atual' : ''}">
        <input type="radio" name="plano-novo" value="${p.slug}" ${atual ? 'checked disabled' : ''}>
        <span class="plano-opcao-icone plano-opcao-icone-${i % PLANO_TROCA_ICONES.length}" aria-hidden="true">${PLANO_TROCA_ICONES[i % PLANO_TROCA_ICONES.length]}</span>
        <span class="plano-opcao-corpo">
          <span class="plano-opcao-nome">${p.nome}</span>
          ${p.frase_beneficio ? `<span class="plano-opcao-desc">${p.frase_beneficio}</span>` : ''}
          <span class="plano-opcao-badges">${badgesLimitesPlano(p.limites)}</span>
        </span>
        <span class="plano-opcao-preco">
          <span class="plano-opcao-preco-valor">${formatarPreco(Number(p.preco_mensal))}<small>/mês</small></span>
          <span class="plano-opcao-preco-nota">Cobrados mensalmente</span>
        </span>
      </label>
    `;
  }).join('');

  const conteudo = `
    <p class="modal-texto">A troca vale a partir da próxima cobrança — o ciclo atual não muda.</p>
    <div class="plano-opcoes">${opcoesHtml}</div>
    <div class="plano-troca-aviso">
      <span class="plano-troca-aviso-icone" aria-hidden="true">🔄</span>
      <span class="plano-troca-aviso-texto">
        <strong>A troca vale a partir da próxima cobrança</strong>
        <span class="plano-troca-aviso-desc">O valor do novo plano será aplicado no próximo ciclo. O ciclo atual continuará normalmente, sem alterações.</span>
      </span>
    </div>
    <div class="modal-erro" id="trocar-plano-erro"></div>
    <div class="modal-acoes">
      <button class="btn-secundario" id="btn-sair-trocar-plano">Sair</button>
      <button class="btn-primario" id="btn-confirmar-trocar-plano">Confirmar troca →</button>
    </div>
  `;
  abrirModal('<h3>Trocar de plano</h3>', conteudo, 'modal-card-pagamento modal-card-trocar-plano');

  document.getElementById('btn-sair-trocar-plano').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-trocar-plano').addEventListener('click', async () => {
    const escolhido = document.querySelector('input[name="plano-novo"]:checked:not(:disabled)');
    if (!escolhido) {
      document.getElementById('trocar-plano-erro').textContent = '⚠️ Escolha um plano diferente do atual.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-trocar-plano');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/pagamentos/plano', {
      method: 'PATCH',
      body: JSON.stringify({ plano: escolhido.value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Plano alterado com sucesso.', 'sucesso');
      renderPagamentos();
    } else {
      document.getElementById('trocar-plano-erro').textContent = '⚠️ ' + ((resultado && resultado.error) || 'Erro ao trocar de plano.');
      btn.disabled = false;
      btn.textContent = 'Confirmar troca →';
    }
  });
}

// CA02/CA03/CA04 (US35.2) — modal de confirmação de cancelamento de
// assinatura, no mesmo padrão de abrirModalExcluirServico/abrirModalCancelar.
// Mostra a data de fim do período já pago (calculada a partir da próxima
// cobrança, já que o cancelamento não estorna o período corrente).
function abrirModalCancelarAssinatura(dados) {
  const dataAcesso = dados.proxima_cobranca ? formatarDataCurtaISO(dados.proxima_cobranca.data) : 'o fim do período já pago';

  abrirModal(
    '<h3>Cancelar assinatura</h3>',
    `
      <p class="modal-texto">Sua assinatura será encerrada. Você continuará com acesso até ${dataAcesso}. Após essa data, seu acesso será suspenso.</p>
      <div class="modal-erro" id="cancelar-assinatura-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-manter-assinatura">Manter assinatura</button>
        <button class="btn-perigo" id="btn-confirmar-cancelamento">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-manter-assinatura').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelamento').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/pagamentos/assinatura', { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      const dataFinal = resultado.acesso_ate ? formatarDataCurtaISO(resultado.acesso_ate) : dataAcesso;
      mostrarToast(`Assinatura cancelada. Seu acesso continua até ${dataFinal}.`, 'sucesso');
      renderPagamentos();
    } else {
      document.getElementById('cancelar-assinatura-erro').textContent = (resultado && resultado.error) || 'Erro ao cancelar assinatura.';
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// htmlFormPagamento/wireFormPagamento agora vivem em pagamento-form.js
// (US52) — reaproveitadas também pela tela de bloqueio pós-trial.

function abrirModalPagamento(dadosAtuais) {
  abrirModal('<h3>Forma de pagamento</h3>', htmlFormPagamento(dadosAtuais), 'modal-card-pagamento');
  wireFormPagamento(dadosAtuais, {
    onFechar: fecharModal,
    onSucesso: () => {
      fecharModal();
      renderPagamentos();
    },
  });
}
