// Fase 1 e 2 da modularização (2026-10-15): núcleo de API/token, casca do
// painel (toasts/modal/ícones/tema/banner/avisos/user-menu/configuração/
// balão de notificações) e as telas Perfil/Minha Empresa/Notificações
// viraram módulos ES próprios. O resto do arquivo ainda é um só — as
// próximas fases continuam extraindo tela por tela (ver plano salvo na
// sessão).
import { token, api } from './app/core/api.js';
import {
  escapeHtml, mostrarToast, abrirModal, fecharModal, injetarIconesMenu, ICON_PATHS,
  sincronizarTema, definirTema, temaAtual, conteudo, menuNav, menuEl, subtabsEl, subtabsCadastroEl, tabs,
  renderBannerCobranca, dispensarAvisoCobranca, construirAvisos, renderAvisos, dispensarAviso,
  carregarMensagensAdmin, renderOutrosProdutos, userMenuToggle, userMenuDropdown, fecharUserMenu, carregarUserMenu,
  iniciaisNome, preencherUserMenu,
  carregarConfiguracao, definirConfiguracao, carregarNotificacoes, marcarNotificacaoLida, configuracao,
  ativarSalvarSoQuandoAlterado, formatarTelefoneWhatsapp, infoSegmento, textoSaudacao,
  formatarDataISO, formatarHora, nomeDiaSemana, inicioDaSemana, validarObrigatorios, iconeSvgHtml, NOMES_DIAS,
  FORMAS_PAGAMENTO_ORDEM, FORMAS_PAGAMENTO_LABEL, formatarDataHoraDisparo, contaStatus, definirContaStatus,
  formatarDataCurta, formatarDataHoraCurta, onboardingElegivel, mostrarModalOnboarding,
} from './app/core/shell.js';
import { renderPerfil, renderMinhaEmpresa } from './app/modulos/perfil.js';
import { renderNotificacoes } from './app/modulos/notificacoes.js';
import { renderRelatorios } from './app/modulos/relatorios.js';
import { renderEquipe } from './app/modulos/equipe.js';
import { renderConfiguracao } from './app/modulos/configuracao.js';
import { renderAutomacoes, automacoesAtuais, duplicarAutomacao, abrirModalAutomacao, abrirModalExcluirAutomacao, definirAutomacoesAbaAtiva } from './app/modulos/automacoes.js';
import {
  renderServicos, servicosAtuais, abrirModalServico, abrirModalExcluirServico, alternarAtivoServico,
  renderProfissionais, profissionaisAtuais, abrirModalProfissional, abrirModalExcluirProfissional, alternarAtivoProfissional,
} from './app/modulos/cadastro.js';
import {
  clientesAtuais, clientesSelecionados, clientesSelecionadosInfo, atualizarBarraSelecaoClientes,
  clientesFiltro, definirClientesCampoFocado,
  abrirModalClienteDetalhe, abrirModalDisparoTemplate, abrirModalDisparoSelecao, renderClientes,
} from './app/modulos/clientes.js';
import {
  bloqueiosAtuais, renderBloqueios, abrirModalBloqueio, abrirModalExcluirBloqueio, alternarAtivoBloqueio,
} from './app/modulos/bloqueios.js';
import { renderWhatsapp } from './app/modulos/whatsapp.js';
import {
  lancamentosAtuais, renderFinanceiro, abrirFinanceiroComFiltro,
  confirmarPagamentoLancamento, abrirModalCancelarPagamentoLancamento,
  abrirModalEditarLancamento, abrirModalCancelarDespesaLancamento,
  definirAbaFinanceiroAtiva, definirFinanceiroFiltroTipo, definirFinanceiroCampoFocado,
} from './app/modulos/financeiro.js';
import { renderPagamentos } from './app/modulos/pagamentos.js';
import {
  corProfissional, horaChave24h, horarioParaMinutosFrontend, horaChaveGradeBucket,
  gerarHorariosGrade, resumoGradeDia, proximoDiaAberto, SLOT_INTERVALO_MINUTOS,
  abrirModalNovoAgendamento, abrirModalConcluir, abrirModalMarcarFalta, abrirModalCancelar,
  abrirModalReagendar, abrirModalEncaixe, renderAgendamentoItem, agendamentosAtuais, definirAgendamentosAtuais,
  renderInicio, inicioProximosAtuais, renderDia, dataRef, definirDataRef,
  TOM_STATUS_AGENDA, AG_STATUS_SEM_ACOES, ALTURA_LINHA_DIA_PX, minutoAjustadoDia, calcularBlocosDia,
} from './app/modulos/agenda.js';

document.getElementById('btn-sair').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // Sem conexão: prossegue com o logout local mesmo assim.
  }
  localStorage.removeItem('kyvvo_token');
  localStorage.removeItem('kyvvo_nome');
  localStorage.removeItem('kyvvo_email');
  window.location.href = 'https://studio.kyvvo.com.br';
});

// US20 — guarda de e-mail não validado (CA10) + banner de trial (CA09) + toast
// de sucesso pós-validação (CA08). Falha na chamada de status não bloqueia o
// portal (fail-open): usuários antigos já são email_verified=true na migration.
// mostrarToast() é definido mais abaixo (seção Toasts).
async function verificarStatusConta() {
  let status;
  try {
    const res = await fetch('/api/tenant/status', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    status = await res.json();
    definirContaStatus(status);
  } catch (e) {
    return;
  }

  // CA10 — conta não validada: acesso ao portal bloqueado até validar.
  if (status.email_verified === false) {
    window.location.href = '/verificar';
    return;
  }

  // US52/CA03 — acesso limitado (não mais tela cheia de bloqueio): o tenant
  // continua vendo o painel normalmente (o backend só bloqueia ESCRITA fora
  // de Plano e cobrança, GET nunca é bloqueado, ver fastify.authenticate/
  // calcularBloqueioAssinatura). Aqui só liga o aviso fixo abaixo do
  // cabeçalho — renderBannerCobranca cuida de mostrar/reforçar.
  window.__bloqueioMotivo = status.bloqueio_motivo || null;
  renderBannerCobranca(status.bloqueio_motivo);
  // Desabilita visualmente os botões "+ Novo X" de cada página (Agenda,
  // Serviços, Profissionais, Clientes, Bloqueios, Financeiro, Equipe — todos
  // compartilham a classe .btn-novo-agendamento) via CSS, exceto o próprio
  // CTA da tela de Plano e cobrança (#btn-cadastrar-pagamento, ver
  // style.css). Classe no <body> (nunca substituído pelo SPA, ao contrário
  // de #conteudo) pra continuar valendo em qualquer página pra onde o
  // usuário navegar depois, sem precisar re-aplicar a cada renderX().
  document.body.classList.toggle('conta-bloqueada', !!status.bloqueio_motivo);

  // CA08 — toast verde ao voltar da validação do token.
  if (new URLSearchParams(location.search).get('verificado') === '1') {
    mostrarToast('E-mail verificado! Seu trial de 14 dias está ativo.', 'sucesso');
    history.replaceState(null, '', location.pathname);
  }

  // US66 — modal de primeiros passos exibido automaticamente só no primeiro
  // acesso elegível, sem ocupar espaço fixo na sidebar (substitui a tela
  // dedicada + item fixo da US56). `menuAtual === 'inicio'` (não só
  // `!== algo`) de propósito: 'inicio' é o valor inicial intocado antes
  // de qualquer navegação (tela pós-login) — essa checagem só abre o modal
  // sozinho se o usuário ainda não clicou em nada desde que a página
  // carregou. Como essa chamada de status é assíncrona, ela pode resolver
  // depois de o usuário já ter navegado manualmente pra outra tela; nesse
  // caso `menuAtual` já mudou e o onboarding não deve interromper a
  // navegação em andamento.
  if (onboardingElegivel(status) && menuAtual === 'inicio') {
    mostrarModalOnboarding(status);
  }

  // CA09 — banner de trial com contador de dias restantes. Não mostra
  // junto com o aviso de conta bloqueada (trial_expirado é um dos motivos
  // de bloqueio) — o #cobranca-banner já cobre essa mensagem, com CTA mais
  // claro; mostrar os dois juntos ("Trial ativo — 0 dias restantes" +
  // "seu trial acabou") seria redundante e confuso.
  const banner = document.getElementById('trial-banner');
  if (banner && !status.bloqueio_motivo && status.status === 'trial' && status.dias_restantes != null) {
    const dias = status.dias_restantes;
    const texto = dias === 1 ? '1 dia restante' : `${dias} dias restantes`;
    banner.textContent = `🎉 Trial ativo — ${texto}. Escolha seu plano antes que expire.`;
    banner.hidden = false;
    document.body.classList.add('com-trial-banner');
    registrarEventoAnalytics('aviso_trial_exibido');
  }

  // US59 — avisos contextuais de cobrança pendente e configuração
  // incompleta. Separados do #trial-banner de propósito: aquele é um único
  // aviso crítico não-dispensável (CA09/US52); estes podem se acumular (mais
  // de uma pendência de configuração ao mesmo tempo) e alguns são
  // dispensáveis pelo usuário.
  const avisosOnboarding = construirAvisos(status);
  renderAvisos(avisosOnboarding);
  // Mensagens/anúncios publicados pelo admin da Kyvvo (Produtos > Studio >
  // Mensagens, ou "Kyvvo inteira") — busca à parte, sem travar o resto do
  // carregamento se falhar (fail-open, mesmo raciocínio do resto do
  // arquivo). Chega depois do primeiro renderAvisos() acima, então
  // re-renderiza com a lista completa quando (se) responder.
  carregarMensagensAdmin(avisosOnboarding);

  // US62 — itens de menu restritos ao administrador (Equipe, Minha Empresa,
  // Cobrança, Preferências) somem pro operador. É só a camada de UX — quem
  // de fato bloqueia a ação é o backend (fastify.requireAdmin), então um
  // operador que force a navegação (ou um payload antigo sem `role`) ainda
  // recebe 403 real das rotas, nunca só "esconder e confiar".
  document.querySelectorAll('[data-somente-admin]').forEach((el) => {
    el.hidden = status.role === 'operador';
  });

  // Alguns itens só aparecem pra planos específicos — lista de chaves da
  // tabela `planos` (ver server/db/045_planos_2x2.sql + 047, que troca só o
  // nome/slug pra Smart/Smart Plus, a `chave` continua professional/
  // enterprise) separada por vírgula em data-planos. Aba Equipe: liberada
  // pra Smart/Smart Plus (pedido do Bruno, 2026-10-14) + 'custom' (não
  // existe como plano de verdade ainda, mas não custa deixar pronta pra
  // quando existir). Também é somente-admin — `el.hidden ||` acumula em vez
  // de sobrescrever, senão um admin via esse segundo loop reapareceria
  // escondido pelo primeiro (dois gates independentes têm que combinar com
  // E, nunca um substituir o outro).
  document.querySelectorAll('[data-planos]').forEach((el) => {
    const permitidos = el.dataset.planos.split(',');
    el.hidden = el.hidden || !permitidos.includes(status.plano);
  });

  renderOutrosProdutos(status.outros_produtos);
}

// "Trocar de produto" no menu de perfil (logo abaixo de "Meu Perfil") — só
// aparece pra quem o mesmo tenant também tem ativo (ex.: salão que também
// usa o CRM). São <a href> de verdade pro outro subdomínio, não itens de
// navegação interna do SPA — por isso ficam fora do loop de .user-menu-item
// que chama selecionarMenu().
// Clicar num item de "trocar de produto" tenta primeiro o login automático
// (handoff via kyvvo-platform) — só cai no link puro (abre a landing pública
// pra logar de novo) se o handoff falhar por qualquer motivo. `href` já
// aponta pro link puro de propósito: usuário com JS desabilitado, ou clique
// com botão do meio/Ctrl (abrir em nova aba) continuam funcionando normal.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-produto-chave]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const destinoDireto = link.href;
  api('/api/meus-produtos/handoff', { method: 'POST', body: JSON.stringify({ produto: link.dataset.produtoChave }) })
    .then((resultado) => { window.location.href = (resultado && resultado.url) || destinoDireto; })
    .catch(() => { window.location.href = destinoDireto; });
});

// Aviso fixo de conta bloqueada (acesso limitado — trial vencido/
// inadimplente/suspenso/cancelado): substitui a antiga tela cheia de
// bloqueio. Cópia curta por motivo, mesmo texto-base de BLOQUEIO_MENSAGENS
// (server/panel/lib/trial-conta.js) — duplicado aqui de propósito, mesmo
// padrão já usado em bloqueio.html (BLOQUEIO_COPY), pra não precisar de mais
// uma chamada de API só pra montar o texto do aviso.
document.getElementById('cobranca-banner').addEventListener('click', (e) => {
  if (e.target.closest('#cobranca-banner-fechar')) {
    e.stopPropagation();
    dispensarAvisoCobranca();
    return;
  }
  selecionarMenu('pagamentos');
});

document.getElementById('avisos-painel').addEventListener('click', (e) => {
  const dispensarBtn = e.target.closest('[data-acao-dispensar-aviso]');
  if (dispensarBtn) {
    dispensarAviso(dispensarBtn.dataset.acaoDispensarAviso);
    return;
  }
  const acaoBtn = e.target.closest('[data-acao-aviso-menu]');
  if (acaoBtn) selecionarMenu(acaoBtn.dataset.acaoAvisoMenu);
});

// US52 — funil de conversão pós-trial: dispara em "melhor esforço", sem
// travar a UI nem exigir tratamento de erro (perder uma métrica de
// analytics não pode quebrar a experiência do tenant).
function registrarEventoAnalytics(tipo) {
  api('/api/eventos', { method: 'POST', body: JSON.stringify({ tipo }) });
}
verificarStatusConta();

let menuAtual = 'inicio';
let abaAtual = 'dia';
// Aba ativa da tela Cadastro (menuAtual === 'cadastro'). Serviços,
// Profissionais e Bloqueio de agenda eram itens de menu soltos e viraram
// abas desta tela; os caminhos /servicos, /profissionais e /bloqueios
// continuam valendo (viram deep link pra aba correspondente).
let abaCadastro = 'servicos';

// Intervalo da linha de "agora" do Quadro — precisa ser limpo toda vez que
// sai da tela (senão fica um setInterval fantasma rodando pra sempre depois
// de trocar de menu) e recriado toda vez que entra nela de novo.
let quadroLinhaAgoraIntervalo = null;

// Serviço de notificações — balão do topo (painel.html, sino ao lado do
// avatar). Polling simples (setInterval no boot, ver fim do arquivo), mesmo
// endpoint alimenta a contagem do balão e a lista do dropdown de uma vez só.
// Destino do clique em cada item do dropdown — por tipo, porque
// whatsapp_aguardando_humano é uma página separada da SPA (atendimento.html)
// e disparos_acabando é uma aba dentro da própria SPA (Automações >
// Disparos, sem URL própria pra linkar direto).
// dataHoraISO (bug real: clicar numa notificação de agendamento sempre abria
// a Agenda no dia de HOJE, nunca no dia do atendimento em si) — vem do
// data-data-hora do item (dataAgendamento da API, ver carregarNotificacoes).
// Força a visão Dia (a mais direta pra ver o atendimento específico) e passa
// a data pra selecionarMenu em vez de deixar cair no "hoje" padrão.
function abrirNotificacaoItem(tipo, id, dataHoraISO) {
  if (tipo === 'whatsapp_aguardando_humano') {
    window.location.href = `/atendimento.html?clienteId=${id}`;
  } else if (tipo === 'disparos_acabando') {
    definirAutomacoesAbaAtiva('disparos');
    selecionarMenu('automacoes');
  } else if (tipo === 'agenda_criada' || tipo === 'agenda_confirmada' || tipo === 'agenda_remarcada') {
    if (dataHoraISO) {
      abaAtual = 'dia';
      tabs.forEach((t) => t.classList.toggle('agenda-visao-ativa', t.dataset.tab === 'dia'));
      selecionarMenu('agendamento', { dataAlvo: new Date(dataHoraISO) });
    } else {
      selecionarMenu('agendamento');
    }
  }
}

document.addEventListener('click', (e) => {
  // Botão "marcar como lida" fica DENTRO do <a> do item (pra ficar junto do
  // título/detalhe sem precisar de outra linha) — precisa vir antes do
  // closest('.ds-notificacoes-item') abaixo e nunca deixar o clique também
  // navegar (senão marcaria como lida E abriria o item ao mesmo tempo).
  const btnLida = e.target.closest('.ds-notificacoes-item-marcar-lida');
  if (btnLida) {
    e.preventDefault();
    e.stopPropagation();
    marcarNotificacaoLida(btnLida.dataset.id);
    return;
  }
  const item = e.target.closest('.ds-notificacoes-item');
  if (item) { e.preventDefault(); abrirNotificacaoItem(item.dataset.tipo, item.dataset.id, item.dataset.dataHora); }
});

// Cabeçalhos de grupo expansível da sidebar (Agenda, Configurações) —
// genérico via data-submenu em vez de um par de consts fixo por grupo, pra
// suportar quantos grupos a sidebar precisar sem repetir a mesma lógica.
const gruposMenu = Array.from(document.querySelectorAll('.ds-menu-grupo-botao[data-submenu]')).map((toggle) => ({
  toggle,
  submenu: document.getElementById(toggle.dataset.submenu),
}));

injetarIconesMenu();

const btnTemaToggle = document.getElementById('btn-tema-toggle');
if (btnTemaToggle) {
  btnTemaToggle.addEventListener('click', () => definirTema(temaAtual() === 'dark' ? 'light' : 'dark'));
}
sincronizarTema();

// URL própria por seção do menu (favoritar/compartilhar/recarregar direto
// numa seção, botão voltar funcionando entre elas — antes só /painel
// existia, trocar de menu nunca mudava a URL). Cada rota aqui tem um
// fastify.get(...) correspondente no backend (index.js) servindo o mesmo
// painel.html — é só o app.js que decide o que renderizar a partir do path.
const ROTAS_MENU = {
  inicio: '/painel',
  quadro: '/quadro',
  agendamento: '/agenda',
  cadastro: '/cadastro',
  clientes: '/clientes',
  whatsapp: '/whatsapp',
  automacoes: '/automacoes',
  pagamentos: '/cobranca',
  perfil: '/perfil',
  empresa: '/empresa',
  configuracao: '/preferencias',
  ajuda: '/ajuda',
};
const CAMINHO_PARA_MENU = Object.fromEntries(Object.entries(ROTAS_MENU).map(([menu, caminho]) => [caminho, menu]));

// Abas da tela Cadastro. Cada uma mantém o caminho curto que já existia
// quando eram itens de menu soltos, pra não quebrar links/bookmarks — o
// caminho vira deep link pra aba (menuAtual = 'cadastro' + abaCadastro).
const ABAS_CADASTRO = ['servicos', 'profissionais', 'bloqueios', 'equipe'];
const CAMINHO_ABA_CADASTRO = { servicos: '/servicos', profissionais: '/profissionais', bloqueios: '/bloqueios', equipe: '/equipe' };

// Módulos (menuAtual = 'modulo:chave', ver render()) não entram no mapa
// fixo acima — a chave é dinâmica (tenant_modulos), por isso uma regra à
// parte em vez de mais entradas fixas.
function caminhoDoMenu(menu) {
  if (menu.startsWith('modulo:')) return '/modulo/' + menu.slice('modulo:'.length);
  // A URL de Cadastro reflete a aba ativa (/servicos, /profissionais,
  // /bloqueios) — mantém as URLs idênticas às de antes de virarem abas.
  if (menu === 'cadastro') return CAMINHO_ABA_CADASTRO[abaCadastro] || '/cadastro';
  return ROTAS_MENU[menu] || null;
}
function menuDoCaminho(caminho) {
  if (CAMINHO_PARA_MENU[caminho]) return CAMINHO_PARA_MENU[caminho];
  // /servicos, /profissionais, /bloqueios → tela Cadastro na aba certa.
  // (Efeito colateral em abaCadastro de propósito: a URL é a fonte da
  // verdade no load inicial e no popstate.)
  const abaAlvo = Object.keys(CAMINHO_ABA_CADASTRO).find((aba) => CAMINHO_ABA_CADASTRO[aba] === caminho);
  if (abaAlvo) { abaCadastro = abaAlvo; return 'cadastro'; }
  const moduloMatch = caminho.match(/^\/modulo\/([a-z0-9_-]+)$/);
  return moduloMatch ? 'modulo:' + moduloMatch[1] : null;
}

// Reaproveitada tanto pelos itens da sidebar quanto pelos itens do user
// menu (dropdown do avatar, ST-user-menu) — os dois só precisam de um jeito
// de trocar `menuAtual` e re-renderizar; a diferença é só onde o clique
// aconteceu.
// `atualizarUrl: false` é usado só pelo listener de popstate e pela leitura
// inicial da URL no carregamento (abaixo) — nesses dois casos a URL já é a
// fonte da verdade, empurrar de novo criaria uma entrada redundante no
// histórico (ou um loop, no caso do popstate).
function selecionarMenu(novoMenu, { atualizarUrl = true, dataAlvo = null } = {}) {
  // Sai da tela Quadro (ou troca de dia dentro dela, que re-renderiza do
  // zero) — limpa o intervalo da linha de "agora" antes de decidir a
  // próxima tela; renderQuadro cria um novo se for o caso.
  clearInterval(quadroLinhaAgoraIntervalo);
  // Serviços / Profissionais / Bloqueio de agenda viraram abas da tela
  // Cadastro — aceitar os nomes antigos (avisos, passos de onboarding,
  // chamadas diretas) e redirecionar pra aba certa.
  if (ABAS_CADASTRO.includes(novoMenu)) {
    abaCadastro = novoMenu;
    novoMenu = 'cadastro';
  }
  // "active" ao lado de ds-menu-*-ativo é compatibilidade com os specs do
  // Playwright (.menu-item[data-menu=...] + toHaveClass(/active/)), escritos
  // antes da padronização pro componente do DS — não vale reescrever ~19
  // arquivos de teste só por causa do nome da classe.
  menuEl.querySelectorAll('.ds-menu-link, .ds-menu-sublink').forEach((i) => {
    i.classList.remove('ds-menu-link-ativo', 'ds-menu-sublink-ativo', 'active');
    i.removeAttribute('aria-current');
  });
  const itemSidebar = menuEl.querySelector(`.ds-menu-link[data-menu="${novoMenu}"], .ds-menu-sublink[data-menu="${novoMenu}"]`);
  if (itemSidebar) {
    itemSidebar.classList.add(itemSidebar.classList.contains('ds-menu-sublink') ? 'ds-menu-sublink-ativo' : 'ds-menu-link-ativo', 'active');
    itemSidebar.setAttribute('aria-current', 'page');
  }
  // Destaca o cabeçalho do grupo (hoje só Configurações — Agenda foi
  // promovida de submenu a item fixo) quando um item de dentro do submenu
  // fica ativo — senão nada na sidebar aparece realçado enquanto uma dessas
  // telas está aberta. Itens que vieram do user menu
  // (perfil/equipe/ajuda) não têm item correspondente na sidebar, então
  // itemSidebar é null e isso vira um no-op — correto, nenhum item da
  // sidebar deve ficar "active" nessas telas.
  gruposMenu.forEach(({ toggle, submenu }) => {
    const dentroDoGrupo = itemSidebar != null && submenu.contains(itemSidebar);
    toggle.classList.toggle('tem-filho-ativo', dentroDoGrupo);
    // Navegação direta por URL (ex.: carregar /bloqueios) pula o clique no
    // cabeçalho do grupo que normalmente abre o submenu — sem isso, o item
    // ficava "active" escondido dentro de um submenu ainda fechado.
    if (dentroDoGrupo) toggle.setAttribute('aria-expanded', 'true');
  });
  menuAtual = novoMenu;
  subtabsEl.style.display = menuAtual === 'agendamento' ? 'flex' : 'none';
  subtabsCadastroEl.style.display = menuAtual === 'cadastro' ? 'flex' : 'none';
  if (menuAtual === 'cadastro') sincronizarAbasCadastro();
  // dataAlvo (bug real: clicar numa notificação de agendamento sempre abria
  // a Agenda no dia de HOJE, nunca no dia do atendimento) — usado só pelo
  // clique em item do balão de notificações (ver abrirNotificacaoItem);
  // qualquer outra navegação continua caindo em "hoje" como sempre foi.
  definirDataRef(dataAlvo || new Date());
  if (atualizarUrl) {
    const caminho = caminhoDoMenu(novoMenu);
    if (caminho && window.location.pathname !== caminho) {
      history.pushState({ menu: novoMenu }, '', caminho);
    }
  }
  render();
}

// Botão voltar/avançar do navegador — reflete a URL sem empurrar de novo
// (atualizarUrl: false). Cai em 'inicio' se o path não bater com nenhuma
// rota conhecida (nunca deveria acontecer vindo de dentro do próprio app,
// mas cobre alguém editando a URL à mão).
window.addEventListener('popstate', () => {
  selecionarMenu(menuDoCaminho(window.location.pathname) || 'inicio', { atualizarUrl: false });
});

// Telas já modularizadas (ex.: Automações) não importam o roteador — pedem
// navegação por evento customizado em vez de chamar selecionarMenu direto,
// pra não criar uma dependência de um módulo de tela pro orquestrador que o
// importa (mesmo motivo do 'kyvvo:bloqueio' em core/shell.js).
document.addEventListener('kyvvo:navegar', (e) => selecionarMenu(e.detail));

// Mesmo motivo acima: app/modulos/clientes.js precisa abrir o modal "Novo
// agendamento" (agora em app/modulos/agenda.js, fase 6a) a partir do perfil
// do cliente sem importar um módulo de tela do outro.
document.addEventListener('kyvvo:abrir-novo-agendamento', (e) => abrirModalNovoAgendamento(e.detail));

// Os 6 modais de ação de app/modulos/agenda.js (concluir, falta, cancelar,
// reagendar, encaixe, novo agendamento com recorrência) são abertos a partir
// de QUALQUER visão da Agenda — não dá pra chamar um renderX() fixo depois
// de confirmar a ação. Em vez disso, o módulo dispara este evento e quem
// decide o que re-renderizar é o dispatcher genérico, que só existe aqui.
document.addEventListener('kyvvo:atualizar', () => render());

function ativarMenuItem(item) {
  selecionarMenu(item.dataset.menu);
}

// :not(.ds-menu-grupo-botao) — bug real (sempre existiu, não é desta fase):
// o cabeçalho de grupo também carrega a classe .ds-menu-link (pro estilo
// compartilhado), então o seletor sem essa exclusão também o pegava; clicar
// nele chamava ativarMenuItem sem data-menu, e caminhoDoMenu(undefined)
// explodia em menu.startsWith(...). O comentário abaixo já dizia que esse
// clique "é tratado pelo próprio components.js" — a exclusão só faltava no
// seletor.
menuEl.querySelectorAll('.ds-menu-link:not(.ds-menu-grupo-botao), .ds-menu-sublink').forEach((item) => {
  item.addEventListener('click', () => ativarMenuItem(item));
});

// Cabeçalhos de grupo (hoje só Configurações) não têm tela própria — só
// expandem/recolhem o submenu. O clique em si (toggle de aria-expanded, e
// reabrir o menu recolhido pra caber o submenu) já é tratado pelo próprio
// components.js do DS (listener delegado em .ds-menu-grupo-botao); não
// precisa de handler aqui.

// Logo no cabeçalho (saiu da sidebar) — sempre volta pro Início, sem reload
// de página, reaproveitando o mesmo caminho de navegação dos itens de menu.
const topbarLogo = document.getElementById('topbar-logo');
if (topbarLogo) topbarLogo.addEventListener('click', () => selecionarMenu('inicio'));

// Recolher/expandir a sidebar (só ícones ↔ 248px) — componente data-ds-menu
// do @kyvvohq/design-system (v2.6.0) cuida do clique/estado visual; aqui só
// aplicamos o estado salvo antes do DS hidratar (evita flash) e persistimos
// a escolha em localStorage via o evento que ele dispara.
if (localStorage.getItem('kyvvo_sidebar_oculta') === '1') {
  menuNav.setAttribute('data-ds-menu-recolhido', '');
}
menuNav.addEventListener('ds-menu-alternar', (e) => {
  localStorage.setItem('kyvvo_sidebar_oculta', e.detail.recolhido ? '1' : '0');
});

userMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const vaiAbrir = userMenuDropdown.hidden;
  fecharUserMenu();
  if (vaiAbrir) {
    userMenuDropdown.hidden = false;
    userMenuToggle.classList.add('aberto');
  }
});

// Fecha ao clicar fora — mesmo espírito do fechamento de .menu-acoes.aberto
// já usado nos itens de agendamento/serviço/profissional.
document.addEventListener('click', (e) => {
  if (!document.getElementById('user-menu').contains(e.target)) fecharUserMenu();
});

document.querySelectorAll('.user-menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    selecionarMenu(item.dataset.menu);
    fecharUserMenu();
  });
});


// ---------- Menu dinâmico por módulo (ST10.3) ----------
// Os itens fixos (Agendamento/Perfil/Configuração) continuam sempre visíveis
// (CA05). Aqui só acrescentamos um item de menu por módulo INTERNO do Studio
// ativo do tenant (financeiro, dashboards etc.), além do "agenda_inteligente"
// (já coberto pelo item fixo "Agendamento"). As telas de cada módulo são
// escopo de USs futuras — o clique mostra só um aviso de "em breve".
// "crm"/"people" ficam de fora de propósito: são OUTROS PRODUTOS Kyvvo, não
// módulos internos do Studio — esses vivem no menu de perfil (ver
// renderOutrosProdutos), nunca na sidebar.
const MODULOS_OUTROS_PRODUTOS = ['agenda_inteligente', 'crm', 'people'];
async function carregarModulosNoMenu() {
  const resultado = await api('/api/tenant/modulos');
  if (!resultado || !Array.isArray(resultado.modulos)) return;

  // Inserido antes da âncora (entre Clientes e Configurações), não no fim
  // da sidebar — senão módulos como Financeiro/Relatórios apareceriam depois
  // de Configurações. GET /api/tenant/modulos já ordena por nome, então
  // Financeiro cai antes de Relatórios sozinho (F < R).
  const ancora = document.getElementById('menu-modulos-anchor');
  const ICONE_MODULO = { financeiro: 'wallet', dashboards: 'chart-column', relatorios: 'chart-column' };
  resultado.modulos
    .filter((m) => !MODULOS_OUTROS_PRODUTOS.includes(m.key))
    .forEach((m) => {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ds-menu-link menu-item';
      item.dataset.menu = `modulo:${m.key}`;
      item.dataset.icon = ICONE_MODULO[m.key] || 'layout-dashboard';
      item.innerHTML = '<span class="ds-menu-icone"></span><span class="ds-menu-rotulo"></span>';
      item.querySelector('.ds-menu-rotulo').textContent = m.nome;
      item.addEventListener('click', () => ativarMenuItem(item));
      li.appendChild(item);
      ancora.parentNode.insertBefore(li, ancora);
    });
  injetarIconesMenu();
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('agenda-visao-ativa'));
    tab.classList.add('agenda-visao-ativa');
    abaAtual = tab.dataset.tab;
    definirDataRef(new Date());
    render();
  });
});

// Marca só a aba ativa da tela Cadastro (as abas escondidas por
// data-somente-admin/data-planos continuam escondidas — só nunca ficam "active").
function sincronizarAbasCadastro() {
  subtabsCadastroEl.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.abaCadastro === abaCadastro);
  });
}

subtabsCadastroEl.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    abaCadastro = tab.dataset.abaCadastro;
    sincronizarAbasCadastro();
    const caminho = caminhoDoMenu('cadastro');
    if (caminho && window.location.pathname !== caminho) {
      history.pushState({ menu: 'cadastro' }, '', caminho);
    }
    render();
  });
});

document.getElementById('btn-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());

conteudo.addEventListener('change', (e) => {
  const checkbox = e.target.closest('[data-cliente-selecionar]');
  if (!checkbox) return;
  const id = checkbox.dataset.clienteSelecionar;
  if (checkbox.checked) {
    clientesSelecionados.add(id);
    const c = clientesAtuais.find((x) => x.id === id);
    if (c) clientesSelecionadosInfo.set(id, { nome: c.nome || 'Sem nome', telefone: c.telefone });
  } else {
    clientesSelecionados.delete(id);
    clientesSelecionadosInfo.delete(id);
  }
  atualizarBarraSelecaoClientes();
});

// Menu "⋯" por cliente (componente .ds-acoes do DS) — disparo individual
// pula direto pro passo 2 (escolher modelo), sem passar pela revisão de
// seleção (não há nada a revisar com 1 cliente só).
document.addEventListener('ds-acoes-escolher', (e) => {
  const caixa = e.target.closest ? e.target : null;
  if (!caixa || !caixa.classList || !caixa.classList.contains('ds-acoes')) return;
  const acao = e.detail && e.detail.acao;

  // Cards compactos da Agenda (visões Semana e Mês, componente .agenda-card-s
  // do DS — Dia continua com o menu local .menu-acoes/data-acoes-toggle, não
  // faz parte desta migração).
  // Menu "⋯" dos Próximos atendimentos do Início (Ver cliente / Conversa).
  if (caixa.dataset.inicioAgendamentoId) {
    const ag = inicioProximosAtuais.find((x) => x.id === caixa.dataset.inicioAgendamentoId);
    if (!ag) return;
    if (acao === 'perfil') abrirModalClienteDetalhe(ag.cliente_id);
    // Telefone já normalizado com DDI 55, formato que o wa.me espera.
    else if (acao === 'conversa' && ag.cliente_telefone) window.open(`https://wa.me/${ag.cliente_telefone}`, '_blank');
    return;
  }

  // Menu ⋯ das linhas de Automações (Editar / Duplicar / Excluir).
  if (caixa.dataset.automacaoId) {
    const automacao = automacoesAtuais.find((x) => x.id === caixa.dataset.automacaoId);
    if (!automacao) return;
    if (acao === 'editar') abrirModalAutomacao(automacao);
    else if (acao === 'duplicar') duplicarAutomacao(automacao.id);
    else if (acao === 'excluir') abrirModalExcluirAutomacao(automacao);
    return;
  }

  if (caixa.dataset.agendamentoId) {
    const ag = agendamentosAtuais.find((a) => a.id === caixa.dataset.agendamentoId);
    if (!ag) return;
    if (acao === 'concluir') abrirModalConcluir(ag);
    else if (acao === 'reagendar') abrirModalReagendar(ag);
    else if (acao === 'encaixar') abrirModalEncaixe(ag);
    else if (acao === 'falta') abrirModalMarcarFalta(ag);
    else if (acao === 'cancelar') abrirModalCancelar(ag);
    return;
  }

  // Serviços (US17/ST17.3, redesenho do menu Serviços pro CRUD padrão).
  if (caixa.dataset.servicoId) {
    const servico = servicosAtuais.find((s) => s.id === caixa.dataset.servicoId);
    if (!servico) return;
    if (acao === 'editar') abrirModalServico(servico);
    else if (acao === 'excluir') abrirModalExcluirServico(servico);
    else if (acao === 'desabilitar' || acao === 'habilitar') alternarAtivoServico(servico);
    return;
  }

  // Profissionais (US17, redesenho pro CRUD padrão).
  if (caixa.dataset.profissionalId) {
    const profissional = profissionaisAtuais.find((p) => p.id === caixa.dataset.profissionalId);
    if (!profissional) return;
    if (acao === 'editar') abrirModalProfissional(profissional);
    else if (acao === 'excluir') abrirModalExcluirProfissional(profissional);
    else if (acao === 'desabilitar' || acao === 'habilitar') alternarAtivoProfissional(profissional);
    return;
  }

  // Bloqueio de agenda (redesenho pro CRUD padrão).
  if (caixa.dataset.bloqueioId) {
    const bloqueio = bloqueiosAtuais.find((b) => b.id === caixa.dataset.bloqueioId);
    if (!bloqueio) return;
    if (acao === 'editar') abrirModalBloqueio(bloqueio);
    else if (acao === 'excluir') abrirModalExcluirBloqueio(bloqueio);
    else if (acao === 'desabilitar' || acao === 'habilitar') alternarAtivoBloqueio(bloqueio);
    return;
  }

  const clienteId = caixa.dataset.clienteId;
  const cliente = clientesAtuais.find((x) => x.id === clienteId);
  if (!cliente) return;
  if (acao === 'disparo') abrirModalDisparoTemplate([clienteId], { voltarParaSelecao: false });
  else if (acao === 'agendamento') abrirModalNovoAgendamento({ telefone: (cliente.telefone || '').replace(/^55/, ''), nome: cliente.nome });
  else if (acao === 'editar') abrirModalClienteDetalhe(clienteId);
});

conteudo.addEventListener('click', (e) => {
  // "Cliente" nos Próximos atendimentos do Início, e qualquer linha da
  // tabela do menu Clientes — abrem o mesmo modal de perfil
  // (abrirModalClienteDetalhe).
  const clienteItemEl = e.target.closest('[data-cliente-id]');
  if (clienteItemEl) {
    abrirModalClienteDetalhe(clienteItemEl.dataset.clienteId);
    return;
  }
  // Checkbox de seleção (disparo em lote) — fica dentro da mesma <tr
  // data-cliente-abrir>; sem este corte, clicar nele também abriria o
  // perfil do cliente. A mudança de estado em si é tratada no listener de
  // 'change' abaixo (o valor de .checked já reflete o clique quando o
  // 'click' dispara).
  if (e.target.closest('[data-cliente-selecionar]')) return;
  const linhaClienteEl = e.target.closest('[data-cliente-abrir]');
  if (linhaClienteEl) {
    abrirModalClienteDetalhe(linhaClienteEl.dataset.clienteAbrir);
    return;
  }

  // Menu Clientes — pills de filtro por status (Todos/Ativos/Novos/Inativos).
  const statusClienteBtn = e.target.closest('[data-clientes-status]');
  if (statusClienteBtn) {
    clientesFiltro.status = statusClienteBtn.dataset.clientesStatus;
    clientesFiltro.pagina = 1;
    definirClientesCampoFocado(null);
    renderClientes();
    return;
  }
  const paginaClientesBtn = e.target.closest('[data-clientes-pagina]');
  if (paginaClientesBtn) {
    if (paginaClientesBtn.dataset.clientesPagina === 'anterior') clientesFiltro.pagina--;
    else clientesFiltro.pagina++;
    definirClientesCampoFocado(null);
    renderClientes();
    return;
  }
  // Barra de seleção (disparo em lote) — "Limpar seleção" zera os dois
  // Sets/Maps (a seleção atravessa página/filtro, então não basta re-render);
  // "Novo disparo" abre o passo 1 (revisão da seleção).
  if (e.target.closest('#btn-limpar-selecao')) {
    clientesSelecionados.clear();
    clientesSelecionadosInfo.clear();
    atualizarBarraSelecaoClientes();
    renderClientes();
    return;
  }
  if (e.target.closest('#btn-novo-disparo')) {
    abrirModalDisparoSelecao();
    return;
  }

  // US63 — atalhos e ações de pendência do dashboard (Início) navegam
  // direto pro menu de destino.
  const atalhoInicioBtn = e.target.closest('[data-acao-atalho-inicio]');
  if (atalhoInicioBtn) {
    selecionarMenu(atalhoInicioBtn.dataset.acaoAtalhoInicio);
    return;
  }

  // US71 — abas Mês/Semana/Dia do Financeiro.
  const tabFinanceiro = e.target.closest('[data-financeiro-aba]');
  if (tabFinanceiro) {
    definirAbaFinanceiroAtiva(tabFinanceiro.dataset.financeiroAba);
    renderFinanceiro();
    return;
  }

  // Pills de filtro por tipo (Todas/Receitas/Despesas) nas Movimentações.
  const tipoLancamentoBtn = e.target.closest('[data-financeiro-filtro-tipo]');
  if (tipoLancamentoBtn) {
    definirFinanceiroFiltroTipo(tipoLancamentoBtn.dataset.financeiroFiltroTipo);
    definirFinanceiroCampoFocado(null);
    renderFinanceiro();
    return;
  }

  // US70/CA03+US71/CA05 — cards do resumo financeiro na tela inicial abrem
  // o Financeiro já na aba/referência do card clicado (hoje → aba Dia, mês → aba Mês).
  const cardFinanceiroBtn = e.target.closest('[data-card-financeiro-nav]');
  if (cardFinanceiroBtn) {
    abrirFinanceiroComFiltro(cardFinanceiroBtn.dataset.financeiroPeriodo, cardFinanceiroBtn.dataset.financeiroReferencia);
    return;
  }

  // "+" ao passar o mouse numa linha de horário (Dia/Semana) ou numa
  // célula de dia (Semana/Mês) — abre Novo agendamento pré-preenchido.
  const addHorarioBtn = e.target.closest('[data-add-horario]');
  if (addHorarioBtn) {
    abrirModalNovoAgendamento({ data: addHorarioBtn.dataset.data, hora: addHorarioBtn.dataset.addHorario });
    return;
  }
  const addDiaBtn = e.target.closest('[data-add-dia]');
  if (addDiaBtn) {
    abrirModalNovoAgendamento({ data: addDiaBtn.dataset.addDia });
    return;
  }

  // "+N mais" (.agenda-mais do DS, células da Semana/Mês com mais
  // agendamentos do que cabe no card compacto) — leva pra visão Dia daquele
  // dia, que já mostra todos com detalhe completo.
  const verDiaBtn = e.target.closest('[data-ver-dia]');
  if (verDiaBtn) {
    const [ano, mes, dia] = verDiaBtn.dataset.verDia.split('-').map(Number);
    definirDataRef(new Date(ano, mes - 1, dia, 12));
    abaAtual = 'dia';
    tabs.forEach((t) => t.classList.toggle('agenda-visao-ativa', t.dataset.tab === 'dia'));
    render();
    return;
  }

  const toggleEl = e.target.closest('[data-acoes-toggle]');
  if (toggleEl) {
    const id = toggleEl.dataset.acoesToggle;
    const menu = document.getElementById(`menu-acoes-${id}`);
    const jaAberto = menu.classList.contains('aberto');
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    if (!jaAberto) menu.classList.add('aberto');
    return;
  }

  const acaoBtn = e.target.closest('[data-acao]');
  if (acaoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const ag = agendamentosAtuais.find((a) => a.id === acaoBtn.dataset.id);
    if (!ag) return;
    if (acaoBtn.dataset.acao === 'concluir') abrirModalConcluir(ag);
    if (acaoBtn.dataset.acao === 'cancelar') abrirModalCancelar(ag);
    if (acaoBtn.dataset.acao === 'reagendar') abrirModalReagendar(ag);
    if (acaoBtn.dataset.acao === 'encaixar') abrirModalEncaixe(ag);
    if (acaoBtn.dataset.acao === 'falta') abrirModalMarcarFalta(ag);
  }

  // Menu de ações por linha de lançamento no Financeiro — todo lançamento
  // não-cancelado tem menu agora (ver menuAcoesLancamento/renderLancamentoItem):
  // Confirmar/Cancelar pagamento/Reagendar só em agendamento ainda previsto;
  // Editar em qualquer um; Cancelar despesa só em saída manual.
  const acaoLancamentoBtn = e.target.closest('[data-acao-lancamento]');
  if (acaoLancamentoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const l = lancamentosAtuais.find((x) => x.id === acaoLancamentoBtn.dataset.id);
    if (!l) return;
    const acao = acaoLancamentoBtn.dataset.acaoLancamento;
    if (acao === 'confirmar') confirmarPagamentoLancamento(l);
    if (acao === 'cancelar') abrirModalCancelarPagamentoLancamento(l);
    if (acao === 'editar') abrirModalEditarLancamento(l);
    if (acao === 'cancelar-despesa') abrirModalCancelarDespesaLancamento(l);
    if (acao === 'reagendar') {
      abrirModalReagendar({ id: l.agendamento_id, data_hora: l.data, profissional_id: l.profissional_id, servico_id: l.servico_id });
    }
  }

  // Serviços (US17/ST17.3) — clicar na linha abre a edição, mesmo padrão
  // data-servico-abrir/linha-clicavel usado em Clientes (data-cliente-abrir).
  const linhaServicoEl = e.target.closest('[data-servico-abrir]');
  if (linhaServicoEl) {
    const servico = servicosAtuais.find((s) => s.id === linhaServicoEl.dataset.servicoAbrir);
    if (servico) abrirModalServico(servico);
    return;
  }

  // Profissionais (US17) — clicar na linha abre a edição, mesmo padrão
  // data-servico-abrir/linha-clicavel usado em Serviços.
  const linhaProfissionalEl = e.target.closest('[data-profissional-abrir]');
  if (linhaProfissionalEl) {
    const profissional = profissionaisAtuais.find((p) => p.id === linhaProfissionalEl.dataset.profissionalAbrir);
    if (profissional) abrirModalProfissional(profissional);
    return;
  }

  // Bloqueio de agenda — clicar na linha abre a edição.
  const linhaBloqueioEl = e.target.closest('[data-bloqueio-abrir]');
  if (linhaBloqueioEl) {
    const bloqueio = bloqueiosAtuais.find((b) => b.id === linhaBloqueioEl.dataset.bloqueioAbrir);
    if (bloqueio) abrirModalBloqueio(bloqueio);
    return;
  }
});

// BUG (achado testando a US64) — só checava '.agendamento-item' (usado em
// Início/Clientes/Financeiro), nunca '.grade-ag-card' (usado nas views
// Dia/Semana, o card de agendamento mais comum do painel). Resultado: o
// clique que abre o menu de ações (Reagendar/Encaixar/Cancelar/Concluir)
// também "clica fora" na visão desse listener, fechando o menu no mesmo
// evento em que acabou de abrir — o menu de ações nunca funcionava de fato
// nas views Dia/Semana, só em Início/Clientes (onde o card usa a outra
// classe). Ninguém tinha pego porque nenhum teste clicava nesse menu antes.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item, .grade-ag-card')) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
  }
});

async function render() {
  // Telas de agenda (Início/Dia/Semana/Mês) precisam de mais largura pra
  // grade de horários e, principalmente, pras colunas da Semana caberem sem
  // scroll horizontal — as demais telas (Perfil, Fatura...) continuam nos
  // 720px padrão, estreitos de propósito pra formulário. Preferências e Meu
  // negócio entraram aqui também (achado 2026-09-29): grids de dias/horário/
  // formas de pagamento ficavam espremidos nos 720px, "ocupando só parte da
  // tela" com bastante espaço vazio ao redor.
  conteudo.classList.toggle('conteudo-largo', menuAtual === 'inicio' || menuAtual === 'quadro' || menuAtual === 'agendamento' || menuAtual === 'clientes' || menuAtual === 'modulo:dashboards' || menuAtual === 'automacoes' || menuAtual === 'whatsapp' || menuAtual === 'configuracao' || menuAtual === 'empresa' || menuAtual === 'notificacoes');

  if (menuAtual === 'inicio') return renderInicio();
  if (menuAtual === 'quadro') return renderQuadro();
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'notificacoes') return renderNotificacoes();
  if (menuAtual === 'perfil') return renderPerfil();
  if (menuAtual === 'empresa') return renderMinhaEmpresa();
  if (menuAtual === 'whatsapp') return renderWhatsapp();
  if (menuAtual === 'automacoes') return renderAutomacoes();
  // "Ajuda" (user menu, PR11) reaproveita o mesmo placeholder "em breve" já
  // usado pros módulos ainda não desenvolvidos.
  if (menuAtual === 'ajuda') return renderModuloEmBreve();
  if (menuAtual === 'pagamentos') return renderPagamentos();
  if (menuAtual === 'cadastro') return renderCadastro();
  if (menuAtual === 'clientes') return renderClientes();
  if (menuAtual === 'modulo:financeiro') return renderFinanceiro();
  if (menuAtual === 'modulo:dashboards') return renderRelatorios();
  if (menuAtual.startsWith('modulo:')) return renderModuloEmBreve();

  if (abaAtual === 'dia') return renderDia();
  if (abaAtual === 'semana') return renderSemana();
  if (abaAtual === 'mes') return renderMes();
}

// ---------- Cadastro (Config > Cadastro) ----------
// Casca das abas Serviços / Profissionais / Bloqueio de agenda / Equipe. A
// barra de abas (#subtabs-cadastro) é fixa no painel.html, como a da
// Agenda; aqui só delega pro render da aba ativa, que escreve em #conteudo
// como antes.
async function renderCadastro() {
  const abaEl = subtabsCadastroEl.querySelector(`.tab[data-aba-cadastro="${abaCadastro}"]`);
  // Aba escondida (ex.: Equipe fora de operador/fora de Smart-Smart Plus)
  // ou valor inválido → cai em Serviços, que está sempre visível.
  if (!abaEl || abaEl.hidden) {
    abaCadastro = 'servicos';
    sincronizarAbasCadastro();
  }
  if (abaCadastro === 'profissionais') return renderProfissionais();
  if (abaCadastro === 'bloqueios') return renderBloqueios();
  if (abaCadastro === 'equipe') return renderEquipe();
  return renderServicos();
}

function renderModuloEmBreve() {
  conteudo.innerHTML = '<div class="vazio">🚧 Em breve — este módulo ainda está em desenvolvimento.</div>';
}


// Card de um agendamento dentro de uma linha da grade de horários (Dia e,
// no PR3, Semana) — mesmo conteúdo/ações de renderAgendamentoItem (kebab
// com Reagendar/Encaixar/Cancelar), só que compacto o bastante pra caber
// dividido em sub-colunas quando há mais de um profissional no mesmo
// horário (CA da grade: "dividir a coluna ou dois componentes").
function renderAgendamentoGradeCard(ag, opts) {
  const cancelado = ag.status === 'cancelado';
  const concluido = ag.status === 'concluido';
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  // Com mais de um profissional cadastrado, "quem atende" é a primeira
  // informação do card — avatar + nome do profissional (cor fixa por
  // profissional_id, corProfissional), antes do serviço/cliente. Com um só
  // profissional isso é óbvio, então o avatar volta a identificar o
  // cliente (mais útil pra reconhecer clientes recorrentes de relance).
  // ocultarProfissional (Quadro): a coluna já É o profissional, repetir o
  // nome em todo card seria redundante — mas cor/avatar continuam.
  const multiProfissional = !(opts && opts.ocultarProfissional) && !!(contaStatus && contaStatus.mostrar_profissional);
  const avatarIniciais = multiProfissional ? iniciaisNome(ag.profissional || '') : iniciaisNome(ag.cliente || '');
  const avatarEstilo = multiProfissional ? ` style="background:${corProfissional(ag.profissional_id)};color:#fff"` : '';
  return `
    <div class="grade-ag-card${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="grade-ag-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="grade-ag-avatar" aria-hidden="true"${avatarEstilo}>${avatarIniciais}</span>
        <div class="grade-ag-textos">
          ${multiProfissional ? `<div class="grade-ag-profissional">${ag.profissional}</div>` : ''}
          <div class="grade-ag-servico">${ag.servico}</div>
          <div class="grade-ag-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="grade-ag-meta">
            ${formatarHora(ag.data_hora)} · ${ag.duracao_minutos}min · ${formatarPreco(ag.preco)}
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
            ${concluido ? '<span class="badge badge-concluido">Concluído</span>' : ''}
            ${falta ? '<span class="badge badge-falta">Falta</span>' : ''}
          </div>
        </div>
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="concluir" data-id="${ag.id}">Concluir</button>
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="falta" data-id="${ag.id}">Marcar falta</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}

// Grade de horários (abertura→fechamento, menos almoço) de um único dia —
// reaproveitada pela view Dia aqui e pela view Semana (PR3), uma coluna por
// dia. `agendamentos` já deve vir filtrado pro dia em questão.
function renderGradeHorariosDoDia(dataISO, agendamentos) {
  const porHorario = {};
  for (const ag of agendamentos) {
    const chave = horaChaveGradeBucket(ag.data_hora);
    if (!porHorario[chave]) porHorario[chave] = [];
    porHorario[chave].push(ag);
  }

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  // Destaque de "agora" (PR2) — só quando o dia da grade é hoje, marca a
  // linha cujo bucket de hora contém o horário atual em Brasília.
  const ehHoje = dataISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;

  return `
    <div class="grade-horarios">
      ${horarios
        .map((hora) => {
          const agsDoHorario = porHorario[hora] || [];
          const conteudoLinha = agsDoHorario.length
            ? `<div class="grade-ag-grupo" style="grid-template-columns:repeat(${agsDoHorario.length},1fr)">${agsDoHorario.map(renderAgendamentoGradeCard).join('')}</div>`
            : '<div class="grade-linha-vazia">Disponível</div>';
          const horaAtual = hora === horaAtualBucket;
          return `
            <div class="grade-linha${horaAtual ? ' grade-linha-hora-atual' : ''}">
              <div class="grade-linha-hora">${hora}</div>
              <div class="grade-linha-conteudo">${conteudoLinha}</div>
              <button class="grade-linha-add" data-add-horario="${hora}" data-data="${dataISO}" aria-label="Novo agendamento às ${hora}">+</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

// Card compacto de agendamento — visões Semana e Mês (componente
// .agenda-card-s/.agenda-ag do DS, README "Card compacto para semana e
// mês"). Diferente do card da Dia (menu local .menu-acoes/data-acoes-toggle):
// aqui o menu "..." é o .ds-acoes do DS, já ligado globalmente pelo
// components.js e tratado no listener `ds-acoes-escolher` acima. Sem slot
// próprio de hora no grid do DS — na Semana a linha já é a hora; no Mês
// (`comHora`) prefixamos no texto do serviço, já que a célula é o dia
// inteiro, não uma hora só.
function renderAgendaCardCompacto(ag, opts) {
  const comHora = !!(opts && opts.comHora);
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  const multiProfissional = !!(contaStatus && contaStatus.mostrar_profissional);
  const iniciais = iniciaisNome(multiProfissional ? (ag.profissional || '') : (ag.cliente || ag.cliente_telefone || ''));
  const cor = multiProfissional ? corProfissional(ag.profissional_id) : 'var(--accent)';
  const servicoTexto = comHora ? `${formatarHora(ag.data_hora)} · ${ag.servico}` : ag.servico;
  return `
    <div class="agenda-card agenda-card-s ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-ag">
        <span class="agenda-avatar" aria-hidden="true" style="--agenda-avatar-bg:${cor};--agenda-avatar-fg:#fff">${iniciais}</span>
        <span class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</span>
        ${semAcoes ? '' : `
          <span class="ds-acoes" data-agendamento-id="${ag.id}">
            <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações">⋯</button>
            <div class="ds-acoes-menu" role="menu" hidden>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="concluir">Concluir</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="reagendar">Reagendar</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="encaixar">Encaixar</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="falta">Marcar falta</button>
              <button type="button" role="menuitem" class="ds-acoes-item ds-acoes-item-perigo" data-acao="cancelar">Cancelar</button>
            </div>
          </span>
        `}
        <span class="agenda-card-servico">${servicoTexto}</span>
      </div>
    </div>
  `;
}

async function renderSemana() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=semana&data=${iso}`);
  if (!data) return;

  definirAgendamentosAtuais(data.agendamentos);

  // Bug real em produção (2026-09-27): `ag.data_hora` vem em UTC — um recorte
  // ingênuo dos 10 primeiros caracteres pega o dia UTC, não o de Brasília.
  // Perto da virada (ex.: 23h+ de Brasília = já é o dia seguinte em UTC, ou
  // de madrugada em UTC = ainda o dia anterior em Brasília) o agendamento
  // caía na coluna errada da semana. formatarDataISO já resolve isso em
  // todo o resto do arquivo — só faltava aqui.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = formatarDataISO(new Date(ag.data_hora));
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  // Uma coluna por dia da semana (segunda→domingo) que o negócio funciona —
  // dias fechados nem aparecem (diferente do Mês, que mostra desabilitado).
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const segunda = inicioDaSemana(dataRef);
  const diasAbertos = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    if (diasFuncionamento.includes(d.getDay())) diasAbertos.push(d);
  }
  const domingo = new Date(segunda);
  domingo.setDate(domingo.getDate() + 6);
  const labelIntervalo = `${segunda.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })} – ${domingo.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' })}`;
  const validos = data.agendamentos.filter((ag) => ag.status !== 'cancelado');

  // Topo comum das 3 visões (componente .agenda-topo do DS, igual à Dia) —
  // o seletor Dia/Semana/Mês em si fica na barra fixa acima (#subtabs,
  // .agenda-visoes), não duplicado aqui.
  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-7" aria-label="Semana anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="7" aria-label="Próxima semana">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${labelIntervalo}</strong>
        <span>${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} na semana</span>
      </div>
    </div>
  `;

  html += diasAbertos.length === 0
    ? '<div class="vazio">Nenhum dia de funcionamento configurado nessa semana.</div>'
    : renderSemanaGrade(diasAbertos, porDia);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') definirDataRef(new Date());
      else dataRef.setDate(dataRef.getDate() + Number(nav));
      renderSemana();
    });
  });
}

// Grid único: UMA régua de hora compartilhada (não uma por coluna — era o
// que desalinhava a hora com o texto da coluna seguinte na versão antiga de
// N grades independentes lado a lado) + uma coluna por dia aberto — direto
// no componente `.agenda-semana` do DS (README "Agenda — Dia, Semana e
// Mês"): sem accordion próprio do Studio, a coluna de hoje já alarga
// sozinha via CSS (v2.10.0, lê `.agenda-semana-cab-hoje`). `--agenda-dias`
// informa quantas colunas o CSS deve desenhar.
//
// PR (bug real em produção, achado 2026-09-30): mesmo bug da view Dia antes
// do PR #75 — cada agendamento só ocupava a célula do horário em que
// COMEÇA. Agora todas as células (cabeçalho, régua, fundo dia×hora) usam
// posição EXPLÍCITA (grid-column/grid-row inline) em vez de depender da
// ordem de inserção no DOM — isso libera uma camada de blocos por dia
// (.grade-bloco-camada, mesma técnica calcularBlocosDia/minutoAjustadoDia da
// view Dia) que pode ocupar várias linhas (grid-row em span) sem brigar com
// o posicionamento automático das outras células. Precisa da altura de
// linha FIXA (.agenda-semana-celula a 60px, ver style.css/
// .agenda-semana-blocos) pra bater com a régua — por isso a linha da hora
// atual não ganha mais `.agenda-linha-alta` (só a cor de destaque
// `.agenda-rail-agora` continua).
function renderSemanaGrade(diasAbertos, porDia) {
  const hojeISO = formatarDataISO(new Date());
  const isoAbertos = diasAbertos.map(formatarDataISO);
  const horaAtualBucket = isoAbertos.includes(hojeISO) ? horaChaveGradeBucket(new Date().toISOString()) : null;

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;

  let html = `<div class="agenda-semana agenda-semana-blocos" style="--agenda-dias:${diasAbertos.length}">`;
  html += '<div class="agenda-semana-canto" style="grid-column:1;grid-row:1"></div>';
  diasAbertos.forEach((d, i) => {
    const diaISO = isoAbertos[i];
    const hoje = diaISO === hojeISO;
    const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    html += `
      <div class="agenda-semana-cab${hoje ? ' agenda-semana-cab-hoje' : ''}" style="grid-column:${i + 2};grid-row:1">
        <span class="agenda-dia-num${hoje ? ' agenda-dia-num-hoje' : ''}">${d.getDate()}</span>
        <span>${nomeDiaSemana(d).slice(0, 3)} ${dataLabel}</span>
      </div>
    `;
  });

  horarios.forEach((hora, linha) => {
    const horaAtual = hora === horaAtualBucket;
    html += `<div class="agenda-rail${horaAtual ? ' agenda-rail-agora' : ''}" style="grid-column:1;grid-row:${linha + 2}"><span class="agenda-rail-hora">${hora}</span></div>`;
  });

  diasAbertos.forEach((d, i) => {
    const diaISO = isoAbertos[i];
    const hoje = diaISO === hojeISO;
    const blocos = calcularBlocosDia(porDia[diaISO] || []);
    horarios.forEach((hora, linha) => {
      const horaMin = horarioParaMinutosFrontend(hora);
      const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
      const ocupada = blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
      html += `
        <div class="agenda-semana-celula${hoje ? ' agenda-semana-celula-hoje' : ''}" style="grid-column:${i + 2};grid-row:${linha + 2}">
          ${ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora} em ${diaISO}">+</button>`}
        </div>
      `;
    });
    const camada = blocos.map(({ ag, coluna, totalColunas }) => {
      const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
      const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${renderAgendaCardCompacto(ag)}</div>`;
    }).join('');
    html += `<div class="grade-bloco-camada" style="grid-column:${i + 2};grid-row:2 / span ${horarios.length}">${camada}</div>`;
  });

  html += '</div>';
  return html;
}

// ---------- Quadro (kanban: colunas = profissionais, raias = horários) ----------
// Só visualização por ora (clique no card abre o mesmo menu de ações do
// resto da agenda — concluir/reagendar/encaixar/falta/cancelar); arrastar
// pra reagendar fica pra uma leva futura. Um dia por vez, mesma navegação
// ←/→ e mesmos horários de Preferências que a view Dia (gerarHorariosGrade
// já lê configuracao.horario_abertura/fechamento/almoço).
async function renderQuadro() {
  definirDataRef(proximoDiaAberto(dataRef, 1));
  clearInterval(quadroLinhaAgoraIntervalo);

  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [data, profs] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/profissionais'),
  ]);
  if (!data || !profs) return;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Anterior</button>
      <div class="nav-periodo-data">
        <strong>${dataLabel}</strong>
        <div class="nav-periodo-dia-semana">${nomeDiaSemana(dataRef)}</div>
      </div>
      <button data-nav="1">Próximo →</button>
    </div>
  `;

  // agendamentosAtuais fica com a lista INTEIRA — é o que os menus de ação
  // dos cards (concluir/reagendar/etc.) usam pra achar o agendamento pelo
  // id. Sem filtro de profissional/serviço (removido — pedido explícito):
  // o Quadro sempre mostra todos os profissionais e todos os agendamentos.
  definirAgendamentosAtuais(data.agendamentos);
  html += renderQuadroGrade(iso, profs.profissionais, data.agendamentos);

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 1);
    definirDataRef(proximoDiaAberto(dataRef, -1));
    renderQuadro();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 1);
    definirDataRef(proximoDiaAberto(dataRef, 1));
    renderQuadro();
  });

  // Linha vermelha de "agora" — só faz sentido no dia de hoje. Recalcula na
  // hora (posição inicial) e a cada 30s depois (vai "correndo" ao longo do
  // dia sem precisar de nenhuma ação do usuário).
  if (iso === formatarDataISO(new Date())) {
    atualizarLinhaAgoraQuadro();
    quadroLinhaAgoraIntervalo = setInterval(atualizarLinhaAgoraQuadro, 30000);
  }
}

// A régua de hora não tem altura fixa (cada linha cresce conforme quantos
// agendamentos cabem nela), então a posição da linha não dá pra calcular só
// com CSS/porcentagem — mede a altura REAL da célula da hora atual
// (.quadro-hora-atual, já calculada por renderQuadroGrade) e posiciona a
// linha proporcional aos minutos decorridos dela. Fora do horário comercial
// (ou durante o almoço) a hora atual não tem linha na grade — sem
// .quadro-hora-atual, a função só encerra o intervalo e não desenha nada.
function atualizarLinhaAgoraQuadro() {
  const grade = conteudo.querySelector('.quadro-grade');
  const horaCel = grade && grade.querySelector('.quadro-hora-atual');
  if (!grade || !horaCel) { clearInterval(quadroLinhaAgoraIntervalo); return; }
  let linha = grade.querySelector('.quadro-linha-agora');
  if (!linha) {
    linha = document.createElement('div');
    linha.className = 'quadro-linha-agora';
    grade.appendChild(linha);
  }
  const agora = new Date();
  const proporcaoHora = (agora.getMinutes() + agora.getSeconds() / 60) / 60;
  linha.style.top = `${horaCel.offsetTop + proporcaoHora * horaCel.offsetHeight}px`;
}

// Mesma técnica de grid da Semana (renderSemanaGrade) — régua de hora
// compartilhada (classes .semana-grade/.semana-grade-hora reaproveitadas,
// não é conceito exclusivo de "semana") — só que aqui as colunas são
// profissionais, fixas (não têm accordion: já é o recorte de um dia só,
// não precisa recolher nada pra caber).
//
// PR (bug real em produção, achado 2026-09-30): a correção de duração da
// view Dia (PR #75, 2026-09-27) nunca foi replicada aqui — cada agendamento
// só ocupava a célula do horário em que COMEÇA, então um atendimento de
// 240min continuava "contabilizando" só 1h: as horas seguintes apareciam
// como "Disponível" (permitindo agendar por cima) e o card não mostrava a
// duração real. Agora cada coluna de profissional usa a MESMA
// calcularBlocosDia/minutoAjustadoDia da view Dia — células de fundo (que
// só indicam "Disponível"/"+") viram uma camada, e os cards de agendamento
// (posicionados por cima, altura/posição em px pela duração real) viram
// outra, uma por profissional (.grade-bloco-camada, grid-row em span
// cobrindo todas as linhas de hora). Precisa da altura de linha FIXA
// (.semana-grade-hora/.semana-grade-cel a 60px, ver style.css) pra bater
// com a régua.
function renderQuadroGrade(diaISO, profissionais, agendamentos) {
  if (!profissionais.length) {
    return '<div class="vazio">Nenhum profissional encontrado — cadastre (ou ajuste o filtro) em Configurações → Cadastro → Profissionais.</div>';
  }

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  const porProfissional = {};
  for (const ag of agendamentos) {
    if (!porProfissional[ag.profissional_id]) porProfissional[ag.profissional_id] = [];
    porProfissional[ag.profissional_id].push(ag);
  }

  const colunas = profissionais.map(() => 'minmax(160px,1fr)').join(' ');
  const ehHoje = diaISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;
  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;

  let html = `<div class="semana-grade quadro-grade" style="grid-template-columns:62px ${colunas}">`;
  html += '<div class="semana-grade-canto" style="grid-column:1;grid-row:1"></div>';
  profissionais.forEach((p, i) => {
    html += `
      <div class="quadro-cab" style="grid-column:${i + 2};grid-row:1">
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(p.id)};color:#fff">${iniciaisNome(p.nome)}</span>
        <strong>${p.nome}</strong>
      </div>
    `;
  });

  horarios.forEach((hora, linha) => {
    html += `<div class="semana-grade-hora${hora === horaAtualBucket ? ' quadro-hora-atual' : ''}" style="grid-column:1;grid-row:${linha + 2}">${hora}</div>`;
  });

  profissionais.forEach((p, i) => {
    const blocos = calcularBlocosDia(porProfissional[p.id] || []);
    horarios.forEach((hora, linha) => {
      const horaMin = horarioParaMinutosFrontend(hora);
      const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
      const ocupada = blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
      html += `
        <div class="semana-grade-cel" style="grid-column:${i + 2};grid-row:${linha + 2}">
          ${ocupada ? '' : '<span class="grade-linha-vazia">Disponível</span>'}
          ${ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora}">+</button>`}
        </div>
      `;
    });
    const camada = blocos.map(({ ag, coluna, totalColunas }) => {
      const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
      const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${renderAgendamentoGradeCard(ag, { ocultarProfissional: true })}</div>`;
    }).join('');
    html += `<div class="grade-bloco-camada" style="grid-column:${i + 2};grid-row:2 / span ${horarios.length}">${camada}</div>`;
  });

  html += '</div>';
  return html;
}

async function renderMes() {
  const mesISO = formatarDataISO(dataRef).slice(0, 7);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=mes&data=${mesISO}`);
  if (!data) return;

  definirAgendamentosAtuais(data.agendamentos);

  // Mesmo bug de fuso da Semana (ver comentário lá) — recorte ingênuo da
  // string UTC em vez de converter pra Brasília.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = formatarDataISO(new Date(ag.data_hora));
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  const ano = dataRef.getFullYear();
  const mes = dataRef.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const mesLabel = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const validos = data.agendamentos.filter((ag) => ag.status !== 'cancelado');

  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-1" aria-label="Mês anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${mesLabel}</strong>
        <span>${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} no mês</span>
      </div>
    </div>
  `;

  // Dia da semana sem funcionamento (Configuração > Dias de funcionamento)
  // nem vira coluna (README do DS: "Mês — também só com dias de trabalho") —
  // diferente da versão anterior, que mostrava uma coluna estreita e
  // desabilitada. diaSemana index bate com NOMES_DIAS/getDay() (0 = domingo).
  const diasFuncionamentoMes = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  html += diasFuncionamentoMes.length === 0
    ? '<div class="vazio">Nenhum dia de funcionamento configurado (confira Preferências).</div>'
    : renderMesGrade(ano, mes, primeiroDia, ultimoDia, diasFuncionamentoMes, porDia);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') definirDataRef(new Date());
      else dataRef.setMonth(dataRef.getMonth() + Number(nav));
      renderMes();
    });
  });
}

// Grade do componente `.agenda-mes` do DS — só colunas de dia de semana
// aberto; `.agenda-mes-fora` completa a 1ª/última linha com dias do mês
// anterior/seguinte (cosmético, só numeração sequencial). Até 3 cards por
// célula (`.agenda-mais` pro resto, leva pra visão Dia daquele dia).
function renderMesGrade(ano, mes, primeiroDia, ultimoDia, diasFuncionamentoMes, porDia) {
  const colunas = [0, 1, 2, 3, 4, 5, 6].filter((ds) => diasFuncionamentoMes.includes(ds));
  let offset = 0;
  for (let ds = 0; ds < primeiroDia.getDay(); ds++) {
    if (colunas.includes(ds)) offset++;
  }

  const hojeISO = formatarDataISO(new Date());
  const MAX_VISIVEIS = 3;
  const celulasDias = [];
  for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
    const diaSemana = new Date(ano, mes, dia).getDay();
    if (!diasFuncionamentoMes.includes(diaSemana)) continue;
    const diaISO = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const agsDoDia = porDia[diaISO] || [];
    const hoje = diaISO === hojeISO;
    const visiveis = agsDoDia.slice(0, MAX_VISIVEIS);
    const extra = agsDoDia.length - visiveis.length;
    celulasDias.push(`
      <div class="agenda-mes-celula${hoje ? ' agenda-mes-celula-hoje' : ''}">
        <span class="agenda-dia-num${hoje ? ' agenda-dia-num-hoje' : ''}">${dia}</span>
        ${visiveis.map((ag) => renderAgendaCardCompacto(ag, { comHora: true })).join('')}
        ${extra > 0 ? `<span class="agenda-mais" data-ver-dia="${diaISO}">+${extra} mais</span>` : ''}
        <button class="agenda-mes-celula-add" data-add-dia="${diaISO}" aria-label="Novo agendamento em ${dia}">+</button>
      </div>
    `);
  }

  const mesAnteriorUltimoDia = new Date(ano, mes, 0).getDate();
  const celulasAntes = Array.from({ length: offset }, (_, i) =>
    `<div class="agenda-mes-celula agenda-mes-fora"><span class="agenda-dia-num">${mesAnteriorUltimoDia - offset + 1 + i}</span></div>`
  );

  const restante = (offset + celulasDias.length) % colunas.length;
  const totalDepois = restante === 0 ? 0 : colunas.length - restante;
  const celulasDepois = Array.from({ length: totalDepois }, (_, i) =>
    `<div class="agenda-mes-celula agenda-mes-fora"><span class="agenda-dia-num">${i + 1}</span></div>`
  );

  return `
    <div class="agenda-mes" style="--agenda-dias:${colunas.length}">
      ${colunas.map((ds) => `<div class="agenda-mes-cab">${NOMES_DIAS[ds].slice(0, 3)}</div>`).join('')}
      ${celulasAntes.join('')}
      ${celulasDias.join('')}
      ${celulasDepois.join('')}
    </div>
  `;
}


// Lê a seção a partir da URL de carregamento (ex.: /agenda) em vez de sempre
// abrir em Início — selecionarMenu (não só render()) porque também precisa
// corrigir o "active" da sidebar, que o HTML estático sempre marca em
// Início. atualizarUrl:false porque a URL já É a fonte — não tem o que
// empurrar de novo.
carregarConfiguracao().then(() => {
  selecionarMenu(menuDoCaminho(window.location.pathname) || 'inicio', { atualizarUrl: false });
});
carregarModulosNoMenu();
carregarUserMenu();
// Balão de notificações (header, persistente entre trocas de menu — não
// precisa de clearInterval como o do Quadro, que é escopado a uma view só).
carregarNotificacoes();
setInterval(carregarNotificacoes, 60000);
