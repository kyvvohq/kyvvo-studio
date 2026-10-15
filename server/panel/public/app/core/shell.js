// Casca do painel (toasts, modal genérico, ícones, tema, banner de
// cobrança, avisos de onboarding, user menu) — extraído de app.js (fase 1 da
// modularização, 2026-10-15). Só funções/constantes puras: todo o *wiring*
// de addEventListener continua em app.js, que já tem `selecionarMenu` (o
// roteador) no mesmo escopo — não precisa de evento customizado pra isso,
// só o api.js (camada mais baixa, ver core/api.js) precisou de um.
import { token, api } from './api.js';

// ---------- escapeHtml ----------
// Único texto exibido em renderWhatsapp() que não vem do próprio backend do
// Kyvvo (nome verificado / mensagem de erro vêm da Graph API da Meta) — por
// isso escapado explicitamente, diferente do resto do app.js que confia nos
// dados já validados do próprio perfil do tenant.
export function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ---------- Toasts ----------
export function mostrarToast(mensagem, tipo = 'sucesso') {
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

// ---------- Modal genérico ----------
function escFecharModal(e) {
  if (e.key === 'Escape') fecharModal();
}

export function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharModal);
}

export function abrirModal(tituloHtml, conteudoHtml, classeExtra) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card${classeExtra ? ` ${classeExtra}` : ''}">
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

// ---------- Ícones do menu (Lucide inline, sem CDN) ----------
// Mesmo dialeto do shell do Kyvvo People (span[data-icon] -> <svg>). Os
// paths ficam aqui e não em cada HTML pra não duplicar; o SVG usa
// currentColor, então hover/active do .ds-menu-link já pinta o ícone junto.
export const ICON_PATHS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'calendar-days': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  'building-2': '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  'sliders-horizontal': '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  'calendar-x': '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="m14 13-4 4"/><path d="m10 13 4 4"/>',
  'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  'credit-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  kanban: '<path d="M5 3v14"/><path d="M12 3v8"/><path d="M19 3v18"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'sun-moon': '<path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/>',
};

function svgIcone(nome) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'menu-icon');
  svg.innerHTML = ICON_PATHS[nome] || '';
  return svg;
}

// Prefixa o ícone dentro do .ds-menu-icone de cada .ds-menu-link/
// .ds-menu-grupo-botao que tenha data-icon e ainda não tenha um SVG.
// Idempotente — pode rodar de novo depois que o menu dinâmico (por módulo)
// inserir itens novos.
export function injetarIconesMenu() {
  document.querySelectorAll('.ds-menu-link[data-icon], .ds-menu-grupo-botao[data-icon]').forEach((item) => {
    const alvo = item.querySelector('.ds-menu-icone');
    if (!alvo || alvo.querySelector('svg.menu-icon')) return;
    alvo.appendChild(svgIcone(item.dataset.icon));
  });
}

// ---------- Tema claro/escuro ----------
// Aplicado antes do paint por um snippet no <head> (chave `kyvvo_tema`); aqui
// só ligamos o toggle do menu de perfil e sincronizamos o rótulo do estado.
export function temaAtual() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
// O wordmark é imagem (mesmo asset do People) — cor gravada no SVG, não
// currentColor, então themear é trocar o <img src> inteiro, não recolorir.
function aplicarLogo(escuro) {
  document.querySelectorAll('.js-logo-kyvvo').forEach((img) => {
    img.src = escuro ? '/ds/logo-dark.svg' : '/ds/logo.svg';
  });
}
export function sincronizarTema() {
  const escuro = temaAtual() === 'dark';
  const btn = document.getElementById('btn-tema-toggle');
  if (btn) btn.setAttribute('aria-checked', String(escuro));
  const estado = document.getElementById('user-menu-tema-estado');
  if (estado) estado.textContent = escuro ? 'Escuro' : 'Claro';
  aplicarLogo(escuro);
}
export function definirTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem('kyvvo_tema', tema);
  sincronizarTema();
}

// ---------- Refs de DOM do shell (reaproveitadas pelas telas, fases futuras) ----------
export const conteudo = document.getElementById('conteudo');
export const menuNav = document.getElementById('painel-sidebar');
export const menuEl = menuNav.querySelector('.ds-menu-lista');
export const subtabsEl = document.getElementById('subtabs');
export const subtabsCadastroEl = document.getElementById('subtabs-cadastro');
// Só as abas da barra da Agenda (Dia/Semana/Mês) — componente .agenda-visoes
// do DS (components.css/README "Agenda — Dia, Semana e Mês"). Escopado pra
// não pegar as abas de Cadastro (Serviços/Profissionais/Bloqueio), que têm
// listener próprio mais abaixo.
export const tabs = document.querySelectorAll('#subtabs .agenda-visao');

// ---------- Aviso fixo de conta bloqueada (banner de cobrança) ----------
// Substitui a antiga tela cheia de bloqueio. Cópia curta por motivo, mesmo
// texto-base de BLOQUEIO_MENSAGENS (server/panel/lib/trial-conta.js) —
// duplicado aqui de propósito, mesmo padrão já usado em bloqueio.html
// (BLOQUEIO_COPY), pra não precisar de mais uma chamada de API só pra montar
// o texto do aviso.
export const COBRANCA_BANNER_MENSAGENS = {
  trial_expirado: 'Seu período de teste terminou.',
  inadimplente: 'Não conseguimos confirmar seu pagamento.',
  suspenso: 'Sua assinatura foi suspensa por falha no pagamento.',
  cancelado: 'Sua assinatura foi encerrada.',
};

// "Até o próximo login" (não localStorage permanente, que é o que
// kyvvo_avisos_dispensados/renderAvisos usa pros avisos do US59) — guarda o
// TOKEN atual como "dispensado"; como um novo login sempre gera um token
// novo, a comparação abaixo falha sozinha na próxima sessão, sem precisar
// tocar em login.html/cadastro.html/equipe-convite.html pra limpar nada.
export function avisoCobrancaDispensadoNestaSessao() {
  try {
    return sessionStorage.getItem('kyvvo_aviso_cobranca_token') === token;
  } catch (e) {
    return false;
  }
}
export function dispensarAvisoCobranca() {
  try {
    sessionStorage.setItem('kyvvo_aviso_cobranca_token', token);
  } catch (e) {
    // Sem sessionStorage (modo privado restritivo, etc.) — só esconde por
    // esta renderização, sem persistir; reaparece no próximo reload, o que é
    // aceitável (mesmo espírito de fail-open já usado no resto do arquivo).
  }
  const banner = document.getElementById('cobranca-banner');
  if (banner) banner.hidden = true;
}

// `forcar` ignora o dispensado da sessão — usado quando o `api()` abaixo
// detecta um 403 de bloqueio (o usuário tentou editar algo, o aviso precisa
// voltar mesmo que ele já tivesse fechado antes nesta mesma sessão).
export function renderBannerCobranca(motivo, forcar = false) {
  const banner = document.getElementById('cobranca-banner');
  const texto = document.getElementById('cobranca-banner-texto');
  if (!banner || !texto) return;
  if (!motivo || (!forcar && avisoCobrancaDispensadoNestaSessao())) {
    banner.hidden = true;
    return;
  }
  const mensagem = COBRANCA_BANNER_MENSAGENS[motivo] || 'Sua assinatura precisa de atenção.';
  texto.textContent = `${mensagem} Toque aqui para regularizar em Plano e cobrança.`;
  banner.hidden = false;
}

// ---------- Avisos contextuais (US59) + mensagens do admin Kyvvo ----------
// Mensagem + rótulo/destino do botão de ação de cada tipo de aviso. `critico:
// true` = sem botão de dispensar, some só quando a pendência é resolvida
// (CA "avisos críticos permanecem visíveis enquanto pendência existir").
export function construirAvisos(status) {
  const avisos = [];
  if (status.pagamento_pendente) {
    avisos.push({
      id: 'pagamento_pendente',
      critico: true,
      mensagem: '⚠️ Não conseguimos confirmar seu último pagamento. Atualize sua forma de pagamento para evitar a suspensão do acesso.',
      acaoLabel: 'Resolver agora',
      acaoMenu: 'pagamentos',
    });
  }
  const configuracao = status.configuracao || {};
  if (configuracao.sem_servicos) {
    avisos.push({
      id: 'sem_servicos',
      critico: false,
      mensagem: 'Cadastre seus serviços para começar a receber agendamentos.',
      acaoLabel: 'Cadastrar serviços',
      acaoMenu: 'servicos',
    });
  }
  if (configuracao.sem_profissionais) {
    avisos.push({
      id: 'sem_profissionais',
      critico: false,
      mensagem: 'Cadastre seus profissionais para organizar a agenda.',
      acaoLabel: 'Cadastrar profissionais',
      acaoMenu: 'profissionais',
    });
  }
  if (configuracao.whatsapp_desconectado) {
    avisos.push({
      id: 'whatsapp_desconectado',
      critico: false,
      mensagem: 'Conecte seu WhatsApp para receber agendamentos automaticamente pelo bot.',
      acaoLabel: 'Conectar WhatsApp',
      acaoMenu: 'whatsapp',
    });
  }
  return avisos;
}

let avisosAtuais = [];
let avisosAdmin = [];

// Busca GET /api/mensagens-ativas (kyvvo-studio, que por sua vez busca do
// kyvvo-admin — ver lib/mensagens-admin.js) e funde no mesmo painel dos
// avisos de onboarding (US59). Prefixo "admin-" no id evita colisão com os
// ids fixos de onboarding (sem_servicos, horario_nao_confirmado, ...).
export async function carregarMensagensAdmin(avisosOnboarding) {
  try {
    const res = await fetch('/api/mensagens-ativas', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const dados = await res.json();
    avisosAdmin = (dados.mensagens || []).map((m) => ({
      id: `admin-${m.id}`,
      mensagem: m.texto,
      severidade: m.severidade,
      critico: false, // sempre dispensável — severidade já comunica a urgência via cor
    }));
  } catch (e) {
    avisosAdmin = [];
  }
  renderAvisos([...avisosOnboarding, ...avisosAdmin]);
}

function idsAvisosDispensados() {
  try {
    return JSON.parse(localStorage.getItem('kyvvo_avisos_dispensados') || '[]');
  } catch (e) {
    return [];
  }
}

// Auto-recupera avisos dispensados cuja pendência já não existe mais nesta
// consulta — assim, se o usuário excluir todos os serviços de novo no
// futuro, o aviso de "sem_servicos" volta a aparecer em vez de ficar
// escondido pra sempre pela dispensa antiga.
export function renderAvisos(avisos) {
  const idsAtuais = new Set(avisos.map((a) => a.id));
  const dispensadosValidos = idsAvisosDispensados().filter((id) => idsAtuais.has(id));
  localStorage.setItem('kyvvo_avisos_dispensados', JSON.stringify(dispensadosValidos));
  avisosAtuais = avisos;
  renderAvisosNaTela();
}

export function renderAvisosNaTela() {
  const painel = document.getElementById('avisos-painel');
  if (!painel) return;
  const dispensados = new Set(idsAvisosDispensados());
  const visiveis = avisosAtuais.filter((a) => a.critico || !dispensados.has(a.id));
  painel.innerHTML = visiveis.map((a) => {
    // severidade (mensagens do admin: info/aviso/erro) tem prioridade sobre
    // o critico/info binário dos avisos de onboarding (US59), que não tem
    // esse campo.
    const classe = a.severidade === 'erro' ? 'aviso-critico'
      : a.severidade === 'aviso' ? 'aviso-aviso'
        : a.severidade === 'info' ? 'aviso-info'
          : a.critico ? 'aviso-critico' : 'aviso-info';
    return `
    <div class="aviso-item ${classe}" data-aviso-id="${a.id}">
      <span>${escapeHtml(a.mensagem)}</span>
      <div class="aviso-acoes">
        ${a.acaoMenu ? `<button class="aviso-acao" data-acao-aviso-menu="${a.acaoMenu}">${a.acaoLabel}</button>` : ''}
        ${a.critico ? '' : `<button class="aviso-dispensar" data-acao-dispensar-aviso="${a.id}" aria-label="Dispensar aviso">×</button>`}
      </div>
    </div>
  `;
  }).join('');
}

export function dispensarAviso(id) {
  const atuais = idsAvisosDispensados();
  if (!atuais.includes(id)) atuais.push(id);
  localStorage.setItem('kyvvo_avisos_dispensados', JSON.stringify(atuais));
  renderAvisosNaTela();
}

// ---------- "Trocar de produto" (menu de perfil) ----------
export function renderOutrosProdutos(produtos) {
  const container = document.getElementById('user-menu-outros-produtos');
  if (!container) return;
  container.innerHTML = (produtos || [])
    .map((p) => `<a class="user-menu-item" href="${p.url}" data-produto-chave="${p.chave}">${escapeHtml(p.nome)}</a>`)
    .join('');
}

// ---------- User menu (avatar + dropdown) ----------
export const userMenuToggle = document.getElementById('user-menu-toggle');
export const userMenuDropdown = document.getElementById('user-menu-dropdown');

export function fecharUserMenu() {
  userMenuDropdown.hidden = true;
  userMenuToggle.classList.remove('aberto');
}

// Iniciais do responsável (primeiro + último nome) pro avatar do user menu
// — só isso por enquanto, sem foto (upload de foto de perfil fica fora
// deste pacote de mudanças). Também usada pelos avatares de profissional/
// cliente na Agenda (mesma ideia de iniciais, reaproveitada).
export function iniciaisNome(nomeCompleto) {
  const partes = (nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

function truncarTexto(texto, max) {
  return texto && texto.length > max ? texto.slice(0, max) + '…' : (texto || '');
}

export function preencherUserMenu(perfil) {
  document.getElementById('user-menu-avatar').textContent = iniciaisNome(perfil.nome_responsavel);
  document.getElementById('user-menu-nome').textContent = perfil.nome_responsavel || '';
  document.getElementById('user-menu-empresa').textContent = truncarTexto(perfil.nome_segmento, 30);
}

export async function carregarUserMenu() {
  const perfil = await api('/api/perfil');
  if (perfil) preencherUserMenu(perfil);
}

// Repassa o bloqueio avisado por core/api.js (evento, não import direto —
// ver comentário em api.js) pro mesmo caminho de sempre.
document.addEventListener('kyvvo:bloqueio', (e) => renderBannerCobranca(e.detail, true));

// ---------- Saudação (US57) ----------
// Usada pelo título da página Início e, ao salvar o nome em "Meu Perfil",
// pra atualizar sem precisar de logout/login.
function saudacaoPorHorario() {
  const hora = new Date().toLocaleString('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' });
  const h = parseInt(hora, 10);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
export function textoSaudacao() {
  const nomeUsuario = (localStorage.getItem('kyvvo_nome') || '').split(' ')[0] || '';
  return `${saudacaoPorHorario()}${nomeUsuario ? ', ' + nomeUsuario : ''}!`;
}
// A saudação virou o título da página Início (paridade com o Kyvvo People,
// que mostra "Olá, {nome}" no topo do conteúdo, não no cabeçalho fixo). O
// elemento só existe enquanto renderInicio está montado — daí a guarda.
export function atualizarSaudacao() {
  const el = document.getElementById('inicio-saudacao');
  if (el) el.textContent = textoSaudacao();
}

// ---------- Segmento de negócio ----------
// Só adapta a terminologia do texto de "dias de funcionamento" na
// Configuração e o rótulo do campo em Minha Empresa, sem mudar
// comportamento. Mesma lista fixa validada no backend.
const SEGMENTOS = {
  salao_beleza: { dias: 'o salão', nomeCampo: 'Nome do salão' },
  petshop: { dias: 'o petshop', nomeCampo: 'Nome do petshop' },
  psicologia: { dias: 'o consultório', nomeCampo: 'Nome do consultório' },
  fisioterapia: { dias: 'a clínica', nomeCampo: 'Nome da clínica' },
  pilates: { dias: 'o studio', nomeCampo: 'Nome do studio' },
  outro: { dias: 'o negócio', nomeCampo: 'Nome do negócio' },
};
export function infoSegmento(segmento) {
  return SEGMENTOS[segmento] || SEGMENTOS.outro;
}

// ---------- Botão "Salvar" só habilita quando o form muda ----------
// Reaproveitada por Minha Empresa e Preferências (Configuração). Não usa
// FormData (exigiria `name` em cada campo — este app usa só `id`); em vez
// disso tira uma "foto" de id+valor de todo input/select/textarea dentro do
// form e compara a cada input/change. Comparação posicional (não por id/
// name) de propósito — alguns campos são checkboxes sem id próprio (dias da
// semana em Preferências), e a ORDEM deles no DOM não muda.
export function ativarSalvarSoQuandoAlterado(form, btn) {
  const campos = () => Array.from(form.querySelectorAll('input, select, textarea'));
  const snapshot = () => campos()
    .map((el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value))
    .join('|');
  let valorInicial = snapshot();
  btn.disabled = true;
  function verificar() {
    btn.disabled = snapshot() === valorInicial;
  }
  form.addEventListener('input', verificar);
  form.addEventListener('change', verificar);
  return { resetar: () => { valorInicial = snapshot(); verificar(); } };
}

// ---------- Configuração (horário de funcionamento etc.) ----------
// Estado compartilhado por Agenda, Notificações e a própria tela de
// Configuração — nenhuma das duas primeiras foi extraída ainda, por isso
// fica aqui (camada que todo mundo já importa) em vez de dentro de um
// módulo de tela específico. `configuracao` é um `let` exportado (binding
// vivo: quem importa sempre vê o valor atual) — mas só este arquivo pode
// REATRIBUIR o binding, por isso o setter: um módulo importador que precise
// trocar o objeto inteiro (não só ler uma propriedade) chama
// `definirConfiguracao`, nunca `configuracao = ...` direto.
export let configuracao = { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' };
export function definirConfiguracao(nova) {
  configuracao = nova;
}
export async function carregarConfiguracao() {
  const dados = await api('/api/configuracao');
  if (dados) configuracao = dados;
}

// ---------- Balão de notificações (header) ----------
// Polling simples (setInterval no boot, em app.js), mesmo endpoint alimenta
// a contagem do balão e a lista do dropdown de uma vez só. O *wiring* de
// clique nos itens (abre a página certa por tipo) fica em app.js — depende
// de estado de roteador (abaAtual, automacoesAbaAtiva) que ainda não foi
// extraído.
export async function carregarNotificacoes() {
  const sino = document.getElementById('notificacoes-sino');
  const lista = document.getElementById('notificacoes-lista');
  if (!sino || !lista || !window.KyvvoDS) return;
  const dados = await api('/api/notificacoes');
  if (!dados) return;
  const grupos = dados.notificacoes || [];
  const total = grupos.reduce((soma, g) => soma + g.itens.length, 0);
  KyvvoDS.notificacoesAtualizar(sino, total);
  lista.innerHTML = total === 0
    ? '<div class="ds-notificacoes-vazio">Nenhuma notificação por enquanto.</div>'
    : grupos.map((g) => `
        <div class="ds-notificacoes-grupo-titulo">${escapeHtml(g.titulo)}</div>
        ${g.itens.map((item) => `
          <a class="ds-notificacoes-item" href="#" data-tipo="${g.tipo}" data-id="${item.id}"${item.dataAgendamento ? ` data-data-hora="${item.dataAgendamento}"` : ''}>
            <div class="ds-notificacoes-item-titulo">${escapeHtml(item.titulo)}</div>
            <div class="ds-notificacoes-item-meta">${escapeHtml(item.detalhe)}${item.desde ? ' · desde ' + new Date(item.desde).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
            ${g.eventoUnico ? `<button type="button" class="ds-notificacoes-item-marcar-lida" data-id="${item.id}" aria-label="Marcar como lida" title="Marcar como lida">✓</button>` : ''}
          </a>
        `).join('')}
      `).join('');
}

export async function marcarNotificacaoLida(id) {
  const resultado = await api(`/api/notificacoes/${id}/lida`, { method: 'PATCH' });
  if (resultado && !resultado.error) carregarNotificacoes();
}

// ---------- Máscaras de telefone ----------
// formatarTelefoneMascara: número nacional dos campos de cadastro/perfil.
// formatarTelefoneWhatsapp: números de origem WhatsApp (status da conexão,
// tabela de conversas, popup de conversa) — já vêm com DDI, formato
// diferente (bandeira + DDI na frente). Cai de volta pra
// formatarTelefoneMascara quando o valor não bate com o formato esperado.
export function formatarTelefoneMascara(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : '';
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  if (digitos.length <= 10) {
    return resto.length > 4 ? `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}` : `(${ddd}) ${resto}`;
  }
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
}

export function formatarTelefoneWhatsapp(valor) {
  const digitos = (valor || '').replace(/\D/g, '');
  if (digitos.length !== 12 && digitos.length !== 13) return formatarTelefoneMascara(digitos);
  const ddi = digitos.slice(0, 2);
  const ddd = digitos.slice(2, 4);
  const numero = digitos.slice(4);
  const numeroFormatado = `${numero.slice(0, -4)}-${numero.slice(-4)}`;
  const bandeira = ddi === '55' ? '🇧🇷 ' : '';
  return `${bandeira}+${ddi} (${ddd}) ${numeroFormatado}`;
}
