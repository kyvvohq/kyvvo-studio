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
  formatarDataISO, formatarHora, nomeDiaSemana, validarObrigatorios, iconeSvgHtml, NOMES_DIAS,
  FORMAS_PAGAMENTO_ORDEM, FORMAS_PAGAMENTO_LABEL, formatarDataHoraDisparo, contaStatus, definirContaStatus,
  formatarDataCurta, formatarDataHoraCurta,
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

// US56 — checklist mínimo de onboarding: serviços, horário de funcionamento
// e WhatsApp, nessa ordem (ordem natural de configuração — não faz sentido
// revisar horário ou conectar WhatsApp antes de ter serviço nenhum pra
// oferecer). Mesma fonte de dados que os avisos (US59) e as pendências do
// Início (US63), só reorganizada em passos sequenciais com "próximo passo
// recomendado" em vez de uma lista plana.
function construirPassosOnboarding(status) {
  const configuracao = (status && status.configuracao) || {};
  return [
    {
      id: 'servicos',
      titulo: 'Cadastre seus serviços',
      descricao: 'Defina os serviços que seu negócio oferece, com duração e preço.',
      feito: !configuracao.sem_servicos,
      acaoMenu: 'servicos',
      acaoLabel: 'Cadastrar serviços',
    },
    {
      id: 'horario',
      titulo: 'Confirme seu horário de funcionamento',
      descricao: 'Revise os dias e horários em que seu negócio atende (já vem com um padrão sugerido).',
      feito: !configuracao.horario_nao_confirmado,
      acaoMenu: 'configuracao',
      acaoLabel: 'Revisar horário',
    },
    {
      id: 'whatsapp',
      titulo: 'Conecte seu WhatsApp',
      descricao: 'Conecte o número do seu negócio para receber agendamentos automaticamente pelo bot.',
      feito: !configuracao.whatsapp_desconectado,
      acaoMenu: 'whatsapp',
      acaoLabel: 'Conectar WhatsApp',
    },
  ];
}

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
let dataRef = new Date();

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
  dataRef = dataAlvo || new Date();
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

// Mesmo motivo acima: o modal "Novo agendamento" é da Agenda (ainda em
// app.js, fase 7), e app/modulos/clientes.js precisa abri-lo a partir do
// perfil do cliente sem importar de volta pra app.js.
document.addEventListener('kyvvo:abrir-novo-agendamento', (e) => abrirModalNovoAgendamento(e.detail));

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

// Cor por profissional na agenda (avatar/borda de acento) — determinística
// por profissional_id, pra cada um manter sempre a mesma cor em qualquer
// tela/sessão sem precisar guardar nada no backend. 6 tons distintos entre
// si e sobre --card/--sunken nos dois temas (não são os tokens semânticos
// --success/--danger/etc, pra não confundir cor-de-profissional com
// cor-de-status).
const PALETA_PROFISSIONAL = ['#7C5CFC', '#22C7F2', '#12B76A', '#F79009', '#F04438', '#9578FF'];
function corProfissional(profissionalId) {
  if (!profissionalId) return PALETA_PROFISSIONAL[0];
  let hash = 0;
  const chave = String(profissionalId);
  for (let i = 0; i < chave.length; i++) hash = (hash * 31 + chave.charCodeAt(i)) >>> 0;
  return PALETA_PROFISSIONAL[hash % PALETA_PROFISSIONAL.length];
}

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
    dataRef = new Date();
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

// "HH:MM" em 24h de um data_hora ISO, sempre nesse formato independente da
// preferência de exibição (formatarHora abaixo) — usado só internamente,
// nunca pra exibir na tela.
function horaChave24h(dataHoraISO) {
  return new Date(dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
}

function horarioParaMinutosFrontend(horario) {
  const [h, m] = horario.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// "HH:MM" do início do bucket de SLOT_INTERVALO_MINUTOS em que o horário de
// um agendamento cai — usado pra bater um agendamento com a linha certa da
// grade (Dia/Semana). Com a grade de hora em hora (PR8), um agendamento às
// 14:30 precisa cair na linha "14:00" (não existe linha "14:30"); igualdade
// exata de horaChave24h deixaria esse agendamento sem nenhuma linha pra
// entrar e ele sumiria da grade — a criação de agendamento continua em
// blocos de 30min no backend, só a granularidade de EXIBIÇÃO da grade mudou.
function horaChaveGradeBucket(dataHoraISO) {
  const minutosNoDia = horarioParaMinutosFrontend(horaChave24h(dataHoraISO));
  const bucketMin = Math.floor(minutosNoDia / SLOT_INTERVALO_MINUTOS) * SLOT_INTERVALO_MINUTOS;
  return `${String(Math.floor(bucketMin / 60)).padStart(2, '0')}:${String(bucketMin % 60).padStart(2, '0')}`;
}

// Granularidade da grade de horários (Dia e Semana, PR8) — gera só os
// RÓTULOS "HH:MM" do intervalo abertura→fechamento configurado, excluindo o
// horário de almoço se ativo. Não depende de serviço/profissional (ao
// contrário da disponibilidade real de criação, que continua em blocos de
// 30min no backend), então dá pra montar a grade inteira só com o que já
// está em `configuracao`.
const SLOT_INTERVALO_MINUTOS = 60;
function gerarHorariosGrade() {
  const aberturaMin = horarioParaMinutosFrontend(configuracao.horario_abertura || '08:00');
  const fechamentoMin = horarioParaMinutosFrontend(configuracao.horario_fechamento || '20:00');
  const almocoAtivo = configuracao.horario_almoco_ativo;
  const almocoInicioMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_inicio) : null;
  const almocoFimMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_fim) : null;

  const horarios = [];
  for (let m = aberturaMin; m < fechamentoMin; m += SLOT_INTERVALO_MINUTOS) {
    if (almocoAtivo && m >= almocoInicioMin && m < almocoFimMin) continue;
    horarios.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return horarios;
}

// Resumo do rodapé da grade Dia — livres/agendados/previsto, calculado no
// cliente a partir dos mesmos horários e agendamentos que a grade já usa
// (mesmo bucket de horaChaveGradeBucket), sem pedir nada novo ao backend.
function resumoGradeDia(agendamentos) {
  const horarios = gerarHorariosGrade();
  const bucketsComItem = new Set(agendamentos.map((ag) => horaChaveGradeBucket(ag.data_hora)));
  const livres = horarios.filter((h) => !bucketsComItem.has(h)).length;
  const validos = agendamentos.filter((ag) => ag.status !== 'cancelado');
  const previsto = validos.reduce((soma, ag) => soma + Number(ag.preco || 0), 0);
  return { livres, agendados: validos.length, previsto };
}

// Anterior/Próximo na view Dia nunca param num dia fora de
// configuracao.dias_funcionamento — pula direto pro próximo dia aberto na
// direção da navegação (+1/-1). Limite de 14 tentativas é só uma trava de
// segurança contra loop infinito se dias_funcionamento vier vazio.
function proximoDiaAberto(base, direcao) {
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const d = new Date(base);
  let tentativas = 0;
  while (!diasFuncionamento.includes(d.getDay()) && tentativas < 14) {
    d.setDate(d.getDate() + direcao);
    tentativas++;
  }
  return d;
}

// "DD/MM/YYYY" a partir de uma data pura "YYYY-MM-DD" (sem hora), ex.: as
// datas puladas de uma recorrência (POST /api/agendamentos). Não usa
// formatarDataCurta/Date aqui de propósito: `new Date('YYYY-MM-DD')` é
// interpretado como meia-noite UTC, e convertida de volta pra
// America/Sao_Paulo (-03:00) viraria o dia anterior — bug sutil de fuso que
// esse formatador evita simplesmente reordenando os componentes do texto.
function formatarDataSimples(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ---------- Modal: novo agendamento (ST09.1 a ST09.5) ----------
// Ponto de entrada do fluxo de cadastro manual (US09). A ST09.1 entregou o
// botão em destaque na agenda e a abertura do modal; a ST09.2 montou o
// formulário com todos os campos e a validação de obrigatórios com destaque
// visual em vermelho; a ST09.3 integra o dropdown de horário com
// GET /agendamentos/disponibilidade — slots ocupados desabilitados, skeleton
// loader durante a carga e aviso quando não há horário livre na data; a
// ST09.5 (submit) salva via POST /api/agendamentos (origem "portal", que a
// ST09.4 já faz upsert de cliente por telefone), fecha o modal, atualiza a
// agenda e exibe o toast de sucesso.

function abrirModalNovoAgendamento(prefill) {
  const { data: dataPrefill, hora: horaPrefill, telefone: telefonePrefill, nome: nomePrefill } = prefill || {};
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo agendamento</h3>',
    `
      <form id="form-novo-agendamento" novalidate>
        <div class="modal-erro" id="novo-ag-erro"></div>

        <label for="novo-ag-telefone">Telefone *</label>
        <input type="tel" id="novo-ag-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off" value="${telefonePrefill || ''}">
        <div class="campo-aviso" id="novo-ag-cliente-aviso"></div>

        <label for="novo-ag-nome">Nome do cliente *</label>
        <input type="text" id="novo-ag-nome" data-obrigatorio autocomplete="off" value="${nomePrefill || ''}">

        <label for="novo-ag-servico">Serviço *</label>
        <select id="novo-ag-servico" data-obrigatorio><option value="">Carregando serviços...</option></select>

        <label for="novo-ag-profissional">Profissional *</label>
        <select id="novo-ag-profissional" data-obrigatorio><option value="">Carregando profissionais...</option></select>

        <label for="novo-ag-data">Data *</label>
        <input type="date" id="novo-ag-data" min="${hoje}" value="${dataPrefill || ''}" data-obrigatorio>

        <label for="novo-ag-horario">Horário *</label>
        <select id="novo-ag-horario" data-obrigatorio><option value="">Selecione serviço, profissional e data</option></select>
        <div class="skeleton-horario" id="novo-ag-horario-skeleton" hidden aria-hidden="true"></div>
        <div class="campo-aviso" id="novo-ag-horario-aviso"></div>

        <label for="novo-ag-observacoes">Observações</label>
        <textarea id="novo-ag-observacoes" rows="3" placeholder="Anotações internas sobre o agendamento"></textarea>

        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="novo-ag-recorrencia-switch">
            <span class="toggle-switch-trilho"></span>
          </span>
          Recorrência
        </label>

        <div id="novo-ag-recorrencia-campos" style="display:none">
          <label for="novo-ag-recorrencia-tipo">Repetir</label>
          <select id="novo-ag-recorrencia-tipo">
            <option value="">Selecione...</option>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="mensal">Mensal</option>
          </select>

          <div id="novo-ag-recorrencia-ate-wrapper" style="display:none">
            <label for="novo-ag-recorrencia-ate">Repetir até *</label>
            <input type="date" id="novo-ag-recorrencia-ate" min="${hoje}">
          </div>
        </div>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-ag">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-ag">Salvar agendamento</button>
        </div>
      </form>
    `
  );

  const form = document.getElementById('form-novo-agendamento');
  const erroEl = document.getElementById('novo-ag-erro');

  document.getElementById('btn-cancelar-novo-ag').addEventListener('click', fecharModal);

  // Recorrência: o switch revela "Repetir" (tipo); só depois de escolher um
  // tipo é que "Repetir até" aparece — mesma progressão descrita pelo Bruno
  // (habilitar > escolher frequência > só então informar o limite).
  document.getElementById('novo-ag-recorrencia-switch').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-campos').style.display = e.target.checked ? 'block' : 'none';
    if (!e.target.checked) {
      document.getElementById('novo-ag-recorrencia-tipo').value = '';
      document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = 'none';
      document.getElementById('novo-ag-recorrencia-ate').value = '';
    }
  });
  document.getElementById('novo-ag-recorrencia-tipo').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = e.target.value ? 'block' : 'none';
    if (!e.target.value) document.getElementById('novo-ag-recorrencia-ate').value = '';
  });

  // Ao corrigir um campo, remove o destaque vermelho imediatamente.
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const limpar = () => campo.classList.remove('campo-invalido');
    campo.addEventListener('input', limpar);
    campo.addEventListener('change', limpar);
  });

  // Telefone já é chave única por tenant na tabela clientes (001_init.sql) —
  // ao digitar um telefone já cadastrado, carrega o nome existente
  // automaticamente. Evita redigitar o nome de um cliente recorrente e evita
  // que um nome digitado errado sobrescreva o nome já salvo (POST
  // /api/agendamentos faz ON CONFLICT DO UPDATE do nome pelo telefone).
  const nomeInput = document.getElementById('novo-ag-nome');
  const telefoneInput = document.getElementById('novo-ag-telefone');
  const clienteAvisoEl = document.getElementById('novo-ag-cliente-aviso');
  let buscaClienteTimeout;
  let ultimoTelefoneBuscado = '';
  telefoneInput.addEventListener('input', () => {
    clearTimeout(buscaClienteTimeout);
    const digitos = telefoneInput.value.replace(/\D/g, '');
    if (digitos === ultimoTelefoneBuscado) return;
    clienteAvisoEl.textContent = '';
    if (digitos.length < 10) return;
    buscaClienteTimeout = setTimeout(async () => {
      ultimoTelefoneBuscado = digitos;
      const resultado = await api(`/api/clientes/buscar-por-telefone?telefone=${digitos}`);
      if (resultado && resultado.cliente) {
        nomeInput.value = resultado.cliente.nome || '';
        clienteAvisoEl.textContent = 'Cliente já cadastrado — nome carregado automaticamente.';
      }
    }, 400);
  });

  // Popula serviços (reutiliza GET /api/servicos, como no encaixe da ST08.6).
  // Serviços desabilitados (PR4/US17) continuam existindo mas não são
  // oferecidos pra novos agendamentos.
  let servicosCarregados = [];
  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('novo-ag-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    servicosCarregados = resultado.servicos;
    const disponiveis = servicosCarregados.filter((s) => s.ativo !== false);
    select.innerHTML = '<option value="">Selecione...</option>' +
      disponiveis.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  // Popula profissionais (GET /api/profissionais). Fora do plano Custom o
  // tenant tem 1 único profissional (garantido pelo backend) — nesse caso o
  // campo some do formulário: escolher entre uma única opção não é uma
  // decisão real do usuário. Só reaparece quando há 2+ (plano Custom).
  const labelProfissional = document.querySelector('label[for="novo-ag-profissional"]');
  const selectProfissional = document.getElementById('novo-ag-profissional');
  let profissionaisCarregados = [];

  // Profissional exclusivo (substituiu profissional_preferencial_id): quando
  // o serviço escolhido tem `profissionais_exclusivos` não-vazio, o campo
  // Profissional só oferece essas opções — servico "sem exclusividade"
  // (array vazio) continua mostrando todos, sem restringir.
  function popularSelectProfissional(idsPermitidos) {
    const valorAtual = selectProfissional.value;
    const lista = idsPermitidos && idsPermitidos.length
      ? profissionaisCarregados.filter((p) => idsPermitidos.includes(p.id))
      : profissionaisCarregados;
    selectProfissional.innerHTML = '<option value="">Selecione...</option>' +
      lista.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
    if (lista.some((p) => p.id === valorAtual)) selectProfissional.value = valorAtual;
  }

  api('/api/profissionais').then((resultado) => {
    if (!resultado || !resultado.profissionais) {
      selectProfissional.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    profissionaisCarregados = resultado.profissionais;
    popularSelectProfissional(null);
    if (profissionaisCarregados.length <= 1) {
      // `label { display: block }` (style.css) é regra de autor e vence o
      // `[hidden]` do user-agent stylesheet independente de especificidade
      // (mesma pegadinha já documentada em .cadastro-plano[hidden]) — por
      // isso o display:none precisa ser explícito aqui, não só o atributo.
      labelProfissional.hidden = true;
      labelProfissional.style.display = 'none';
      selectProfissional.hidden = true;
      selectProfissional.style.display = 'none';
      selectProfissional.removeAttribute('data-obrigatorio');
      if (profissionaisCarregados.length === 1) {
        selectProfissional.value = profissionaisCarregados[0].id;
        selectProfissional.dispatchEvent(new Event('change'));
      }
    }
  });

  // Registrado antes do listener de carregarSlotsNovoAgendamento (abaixo)
  // pra já valer na mesma mudança.
  document.getElementById('novo-ag-servico').addEventListener('change', () => {
    const servico = servicosCarregados.find((s) => s.id === document.getElementById('novo-ag-servico').value);
    popularSelectProfissional(servico ? servico.profissionais_exclusivos : null);
  });

  // ST09.3 — Carrega os slots reais de GET /agendamentos/disponibilidade sempre
  // que serviço, profissional e data estiverem selecionados (os três parâmetros
  // exigidos pelo endpoint; o serviço define a duração usada para montar os
  // slots). Reutiliza o mesmo endpoint da ST08.2 e o helper popularSelectHorarios
  // do reagendamento/encaixe. Slots ocupados ficam desabilitados com "(ocupado)".
  async function carregarSlotsNovoAgendamento() {
    const servicoId = document.getElementById('novo-ag-servico').value;
    const profissionalId = document.getElementById('novo-ag-profissional').value;
    const data = document.getElementById('novo-ag-data').value;
    const select = document.getElementById('novo-ag-horario');
    const skeleton = document.getElementById('novo-ag-horario-skeleton');
    const aviso = document.getElementById('novo-ag-horario-aviso');

    aviso.textContent = '';

    if (!servicoId || !profissionalId || !data) {
      select.hidden = false;
      skeleton.hidden = true;
      select.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    // Skeleton loader (CA08): esconde o select e mostra a barra de carregamento.
    select.hidden = true;
    select.innerHTML = '<option value="">Carregando horários...</option>';
    skeleton.hidden = false;

    // O select e o skeleton precisam voltar ao estado visível mesmo se a
    // chamada falhar (erro de rede, backend fora do ar etc.) — sem o
    // try/finally, uma falha aqui deixava o dropdown escondido pra sempre e o
    // formulário ficava impossível de preencher/salvar.
    let disponibilidade;
    try {
      disponibilidade = await api(
        `/api/agendamentos/disponibilidade?data=${data}&profissional=${profissionalId}&servico=${servicoId}`
      );
    } catch (erro) {
      disponibilidade = null;
    } finally {
      skeleton.hidden = true;
      select.hidden = false;
    }

    if (!disponibilidade || disponibilidade.error || !Array.isArray(disponibilidade.slots)) {
      select.innerHTML = '<option value="">Erro ao carregar horários</option>';
      aviso.textContent = (disponibilidade && disponibilidade.error) || 'Não foi possível carregar os horários. Tente novamente.';
      return;
    }

    // CA03: sem nenhum horário livre na data selecionada.
    if (!disponibilidade.slots.some((s) => s.disponivel)) {
      select.innerHTML = '<option value="">Nenhum horário disponível</option>';
      aviso.textContent = 'Nenhum horário disponível nesta data. Tente outra data.';
      return;
    }

    popularSelectHorarios(select, disponibilidade.slots);
    // Hover "+" na grade de Dia/Semana (PR2/PR3) pode pré-preencher um
    // horário específico — prefere esse horário se ele seguir disponível,
    // em vez do primeiro disponível que popularSelectHorarios já selecionou.
    if (horaPrefill) {
      const alvo = disponibilidade.slots.find((s) => s.disponivel && horaChave24h(s.hora) === horaPrefill);
      if (alvo) select.value = alvo.hora;
    }
    // O valor é definido programaticamente (não dispara "change"), então limpa
    // o destaque de erro manualmente caso a validação já o tivesse marcado.
    select.classList.remove('campo-invalido');
  }

  ['novo-ag-servico', 'novo-ag-profissional', 'novo-ag-data'].forEach((id) => {
    document.getElementById(id).addEventListener('change', carregarSlotsNovoAgendamento);
  });
  // O calendário nativo já dispara "change" ao escolher uma data. Para quem
  // prefere digitar a data direto no campo, o "input" garante que os horários
  // recarreguem assim que a data digitada ficar completa/válida, sem precisar
  // esperar o campo perder o foco.
  document.getElementById('novo-ag-data').addEventListener('input', carregarSlotsNovoAgendamento);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    // Recorrência: só entra no payload se o switch estiver ligado E um tipo
    // tiver sido escolhido — "Repetir até" é obrigatório nesse caso (CA do
    // Bruno), validado aqui porque não tem data-obrigatorio (só existe/é
    // exigido condicionalmente, ao contrário dos campos sempre obrigatórios
    // de cima que validarObrigatorios já cobre).
    let recorrencia;
    if (document.getElementById('novo-ag-recorrencia-switch').checked) {
      const tipo = document.getElementById('novo-ag-recorrencia-tipo').value;
      if (!tipo) {
        erroEl.textContent = 'Selecione a frequência da recorrência.';
        document.getElementById('novo-ag-recorrencia-tipo').focus();
        return;
      }
      const ateInput = document.getElementById('novo-ag-recorrencia-ate');
      const dataAgendamento = document.getElementById('novo-ag-data').value;
      if (!ateInput.value) {
        erroEl.textContent = 'Informe até quando a recorrência deve se repetir.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      if (ateInput.value <= dataAgendamento) {
        erroEl.textContent = 'A data de "Repetir até" deve ser depois da data do agendamento.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      recorrencia = { tipo, ate: ateInput.value };
    }

    const btn = document.getElementById('btn-salvar-novo-ag');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('novo-ag-nome').value.trim(),
        cliente_telefone: document.getElementById('novo-ag-telefone').value.trim(),
        servico_id: document.getElementById('novo-ag-servico').value,
        profissional_id: document.getElementById('novo-ag-profissional').value,
        data_hora: document.getElementById('novo-ag-horario').value,
        observacoes: document.getElementById('novo-ag-observacoes').value.trim() || null,
        recorrencia,
        origem: 'portal',
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      // Recorrência (US: switch "Recorrência") — a resposta já vem com quantas
      // ocorrências extras foram criadas e quais foram puladas por conflito;
      // um segundo toast avisa isso separado do toast de sucesso, sem travar
      // o fluxo (as demais ocorrências já foram criadas normalmente).
      if (resultado.recorrencia) {
        const { criados, pulados, limite_atingido: limiteAtingido } = resultado.recorrencia;
        const repeticoesCriadas = criados === 1 ? '1 repetição criada' : `${criados} repetições criadas`;
        mostrarToast(`Agendamento cadastrado — ${repeticoesCriadas}.`, 'sucesso');
        if (pulados && pulados.length) {
          const datas = pulados.map((p) => formatarDataSimples(p.data)).join(', ');
          const repeticoesPuladas = pulados.length === 1 ? '1 repetição pulada' : `${pulados.length} repetições puladas`;
          mostrarToast(`${repeticoesPuladas} por conflito: ${datas}.`, 'erro');
        }
        if (limiteAtingido) {
          mostrarToast('Limite de repetições atingido — ajuste a data "Repetir até" se precisar de mais datas.', 'erro');
        }
      } else {
        mostrarToast('Agendamento cadastrado com sucesso.', 'sucesso');
      }
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar agendamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar agendamento';
    }
  });
}

document.getElementById('btn-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());

// ---------- Modal: concluir atendimento (US64) ----------
// Marca o agendamento como concluído — converte a receita prevista do
// lançamento financeiro vinculado em realizada (CA "Cenário 5"), feito no
// backend por sincronizarLancamentoFinanceiro dentro do mesmo PATCH.
function abrirModalConcluir(ag) {
  abrirModal(
    '<h3>Concluir atendimento</h3>',
    `
      <p class="modal-texto">Confirmar que o atendimento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)} foi concluído?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-concluir">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-concluir">Confirmar conclusão</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-concluir').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-concluir').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-concluir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'concluido' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao concluir agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar conclusão';
    }
  });
}

// ---------- Modal: marcar falta (no-show) ----------
// Distinto de cancelar: falta é quando o cliente simplesmente não apareceu,
// não uma decisão avisada com antecedência — sincronizarLancamentoFinanceiro
// (backend) trata os dois igual pro financeiro (a receita prevista não
// acontece de qualquer jeito), mas o status do agendamento fica separado
// pra medir taxa de comparecimento e faturamento perdido por no-show no
// menu Relatórios.
function abrirModalMarcarFalta(ag) {
  abrirModal(
    '<h3>Marcar falta</h3>',
    `
      <p class="modal-texto">Confirmar que <strong>${ag.cliente || ag.cliente_telefone}</strong> não compareceu ao atendimento de ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-falta">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-falta">Confirmar falta</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-falta').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-falta').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-falta');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'falta' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Falta registrada.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao registrar falta.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar falta';
    }
  });
}

// ---------- Modal: cancelamento (ST08.4) ----------
function abrirModalCancelar(ag) {
  abrirModal(
    '<h3>Cancelar agendamento</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja cancelar o agendamento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-cancelar">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-cancelar').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// ---------- Modal: reagendamento (ST08.5) ----------
function popularSelectHorarios(select, slots, bloquearOcupado = true) {
  select.innerHTML = slots
    .map((s) => `<option value="${s.hora}" ${!s.disponivel && bloquearOcupado ? 'disabled' : ''}>${formatarHora(s.hora)}${!s.disponivel ? ' (ocupado)' : ''}</option>`)
    .join('');
  const primeiraSelecionavel = bloquearOcupado ? slots.find((s) => s.disponivel) : slots[0];
  if (primeiraSelecionavel) select.value = primeiraSelecionavel.hora;
  return !!primeiraSelecionavel;
}

function abrirModalReagendar(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Reagendar</h3>',
    `
      <div class="modal-erro" id="reagendar-erro"></div>
      <label for="reagendar-data">Nova data</label>
      <input type="date" id="reagendar-data" min="${hoje}" value="${formatarDataISO(new Date(ag.data_hora))}">
      <label for="reagendar-horario">Novo horário</label>
      <select id="reagendar-horario"><option>Carregando horários...</option></select>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-reagendar">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-reagendar" disabled>Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-reagendar').addEventListener('click', fecharModal);

  async function carregarSlots() {
    const data = document.getElementById('reagendar-data').value;
    const select = document.getElementById('reagendar-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-reagendar');
    select.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${ag.servico_id}`);
    if (!disponibilidade || disponibilidade.error) {
      select.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(select, disponibilidade.slots);
  }

  document.getElementById('reagendar-data').addEventListener('change', carregarSlots);
  document.getElementById('reagendar-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-reagendar').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-reagendar').addEventListener('click', async () => {
    const erroEl = document.getElementById('reagendar-erro');
    erroEl.textContent = '';
    const btn = document.getElementById('btn-confirmar-reagendar');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data_hora: document.getElementById('reagendar-horario').value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao reagendar.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });

  carregarSlots();
}

// ---------- Modal: encaixe (ST08.6) ----------
function abrirModalEncaixe(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    `<h3>Encaixe${contaStatus && contaStatus.mostrar_profissional ? ` — ${ag.profissional}` : ''}</h3>`,
    `
      <div class="modal-erro" id="encaixe-erro"></div>
      <label for="encaixe-nome">Nome do cliente (opcional)</label>
      <input type="text" id="encaixe-nome">
      <label for="encaixe-whatsapp">WhatsApp</label>
      <input type="tel" id="encaixe-whatsapp" placeholder="11999999999">
      <label for="encaixe-servico">Serviço</label>
      <select id="encaixe-servico"><option value="">Carregando serviços...</option></select>
      <label for="encaixe-data">Data</label>
      <input type="date" id="encaixe-data" min="${hoje}" value="${formatarDataISO(new Date(ag.data_hora))}">
      <label for="encaixe-horario">Horário</label>
      <select id="encaixe-horario"><option>Selecione um serviço primeiro</option></select>
      <p class="modal-texto">Encaixe pode sobrepor um horário já ocupado — os marcados "(ocupado)" continuam selecionáveis de propósito.</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-encaixe">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-encaixe" disabled>Confirmar encaixe</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-encaixe').addEventListener('click', fecharModal);

  async function carregarSlotsEncaixe() {
    const servicoId = document.getElementById('encaixe-servico').value;
    const data = document.getElementById('encaixe-data').value;
    const selectHorario = document.getElementById('encaixe-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-encaixe');
    if (!servicoId) {
      selectHorario.innerHTML = '<option>Selecione um serviço primeiro</option>';
      btnConfirmar.disabled = true;
      return;
    }
    selectHorario.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${servicoId}`);
    if (!disponibilidade || disponibilidade.error) {
      selectHorario.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(selectHorario, disponibilidade.slots, false);
  }

  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('encaixe-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.servicos.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  document.getElementById('encaixe-servico').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-data').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-encaixe').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-encaixe').addEventListener('click', async () => {
    const erroEl = document.getElementById('encaixe-erro');
    erroEl.textContent = '';
    const whatsapp = document.getElementById('encaixe-whatsapp').value.trim();
    if (!whatsapp) {
      erroEl.textContent = 'Informe o WhatsApp do cliente.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-encaixe');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('encaixe-nome').value.trim() || null,
        cliente_telefone: whatsapp,
        profissional_id: ag.profissional_id,
        servico_id: document.getElementById('encaixe-servico').value,
        data_hora: document.getElementById('encaixe-horario').value,
        encaixe: true,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao criar encaixe.';
      btn.disabled = false;
      btn.textContent = 'Confirmar encaixe';
    }
  });

  carregarSlotsEncaixe();
}

// ---------- Menu de ações inline (ST08.3) ----------
let agendamentosAtuais = [];

function renderAgendamentoItem(ag) {
  const cancelado = ag.status === 'cancelado';
  // US64 — concluído também não tem mais o que fazer (mesmo raciocínio do
  // cancelado): sem menu de ações, só o badge indicando o estado final.
  const concluido = ag.status === 'concluido';
  // Falta (no-show, migration 060) é estado final igual concluído/cancelado
  // — nada mais a fazer com um agendamento já marcado como falta.
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  return `
    <div class="agendamento-item${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agendamento-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">
            ${ag.cliente || ag.cliente_telefone}${contaStatus && contaStatus.mostrar_profissional ? ` · ${ag.profissional}` : ''} · ${ag.duracao_minutos}min
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
    abaFinanceiroAtiva = tabFinanceiro.dataset.financeiroAba;
    renderFinanceiro();
    return;
  }

  // Pills de filtro por tipo (Todas/Receitas/Despesas) nas Movimentações.
  const tipoLancamentoBtn = e.target.closest('[data-financeiro-filtro-tipo]');
  if (tipoLancamentoBtn) {
    financeiroFiltroTipo = tipoLancamentoBtn.dataset.financeiroFiltroTipo;
    financeiroCampoFocado = null;
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
    dataRef = new Date(ano, mes - 1, dia, 12);
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

// ---------- Financeiro (US18/US71) ----------
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
let lancamentosAtuais = [];
// Movimentações: filtro por tipo (pills Todas/Receitas/Despesas) + busca
// livre (descrição/serviço/cliente), sempre client-side em cima da lista já
// carregada pro período ativo — sem endpoint próprio, a lista de um
// dia/semana/mês nunca é grande o bastante pra justificar paginação server-side.
let financeiroFiltroTipo = 'todas';
let financeiroFiltroBusca = '';
let financeiroFiltroDebounce;
let financeiroCampoFocado = null;

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
function abrirFinanceiroComFiltro(periodo, referencia) {
  abaFinanceiroAtiva = periodo === 'dia' ? 'dia' : 'mes';
  if (abaFinanceiroAtiva === 'dia' && referencia) {
    diaFinanceiroRef = new Date(`${referencia}T12:00:00`);
  } else if (abaFinanceiroAtiva === 'mes' && referencia) {
    mesFinanceiroRef = new Date(`${referencia}-01T12:00:00`);
  }
  selecionarMenu('modulo:financeiro');
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

function renderLancamentoItem(l) {
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

function confirmarPagamentoLancamento(l) {
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
      render();
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
function abrirModalCancelarPagamentoLancamento(l) {
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
      render();
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
function abrirModalEditarLancamento(l) {
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
function abrirModalCancelarDespesaLancamento(l) {
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
async function renderFinanceiro() {
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

// ---------- Pagamentos / Asaas (US32) ----------
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

async function renderPagamentos() {
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

function renderListaPlanosDisponiveis(planos, planoSlugAtual) {
  if (!planos || !planos.length) return '';
  const cards = planos.map((p, i) => {
    const atual = p.slug === planoSlugAtual;
    return `
      <div class="plano-opcao${atual ? ' plano-opcao-atual' : ''}">
        <span class="plano-opcao-icone plano-opcao-icone-${i % PLANO_TROCA_ICONES.length}" aria-hidden="true">${PLANO_TROCA_ICONES[i % PLANO_TROCA_ICONES.length]}</span>
        <span class="plano-opcao-corpo">
          <span class="plano-opcao-nome">${p.nome}${atual ? ' <span class="badge badge-status-ativo">Seu plano</span>' : ''}</span>
          ${p.frase_beneficio ? `<span class="plano-opcao-desc">${p.frase_beneficio}</span>` : ''}
          <span class="plano-opcao-badges">${badgesLimitesPlano(p.limites)}</span>
        </span>
        <span class="plano-opcao-preco">
          <span class="plano-opcao-preco-valor">${formatarPreco(Number(p.preco_mensal))}<small>/mês</small></span>
          <span class="plano-opcao-preco-nota">Cobrados mensalmente</span>
        </span>
      </div>
    `;
  }).join('');
  return `
    <div class="pagamento-secao-divisor"></div>
    <h3 class="inicio-secao-titulo">Planos disponíveis</h3>
    <div class="plano-opcoes">${cards}</div>
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

// ---------- Onboarding (US56/US66) ----------
// Modal de "primeiros passos", separado do painel de avisos (US59) e das
// pendências do Início (US63): aqueles são nudges passivos que convivem com
// o resto do painel, este é um modal com progresso e "próximo passo
// recomendado" — pensado pra guiar o primeiro acesso sem virar tela nem item
// fixo de menu (US66 substitui a tela dedicada + item fixo da US56).
function onboardingElegivel(status) {
  return construirPassosOnboarding(status).some((p) => !p.feito) && !status.onboarding_dispensado;
}

function mostrarModalOnboarding(status) {
  const passos = construirPassosOnboarding(status);
  const concluidos = passos.filter((p) => p.feito).length;
  const proximoPasso = passos.find((p) => !p.feito);
  const percentual = Math.round((concluidos / passos.length) * 100);

  const conteudoHtml = `
    <div class="onboarding-cabecalho">
      <h2>Primeiros passos</h2>
      <p>Complete esses passos para deixar o Kyvvo pronto pra receber agendamentos.</p>
      <div class="onboarding-progresso">
        <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${percentual}%"></div></div>
        <span>${concluidos} de ${passos.length} concluídos</span>
      </div>
    </div>
    <ul class="onboarding-lista">
      ${passos.map((p) => {
        const recomendado = !p.feito && proximoPasso && p.id === proximoPasso.id;
        return `
        <li class="onboarding-passo ${p.feito ? 'onboarding-passo-feito' : ''} ${recomendado ? 'onboarding-passo-recomendado' : ''}">
          <div class="onboarding-passo-check" aria-hidden="true">${p.feito ? '✓' : ''}</div>
          <div class="onboarding-passo-texto">
            <strong>${p.titulo}</strong>
            <p>${p.descricao}</p>
            ${recomendado ? '<span class="onboarding-passo-tag">Próximo passo recomendado</span>' : ''}
          </div>
          ${p.feito ? '' : `<button class="btn-secundario" data-acao-onboarding-passo="${p.acaoMenu}">${p.acaoLabel}</button>`}
        </li>
      `;
      }).join('')}
    </ul>
    <button class="link-pular-onboarding" id="btn-pular-onboarding">Pular por agora</button>
  `;

  const overlay = abrirModal('', conteudoHtml, 'modal-card-onboarding');
  overlay.querySelectorAll('[data-acao-onboarding-passo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fecharModal();
      selecionarMenu(btn.dataset.acaoOnboardingPasso);
    });
  });
  const btnPular = document.getElementById('btn-pular-onboarding');
  if (btnPular) {
    btnPular.addEventListener('click', async () => {
      // Persiste a dispensa pro modal não reaparecer em novos acessos
      // (US66/Cenário 3) — diferente de fechar pelo X/clique fora/Esc sem
      // decidir, que não persiste nada e deixa o modal elegível de novo no
      // próximo carregamento (US66/Cenário 5).
      await api('/api/onboarding/dispensar', { method: 'POST' });
      if (contaStatus) contaStatus.onboarding_dispensado = true;
      fecharModal();
    });
  }
}

// ---------- Início (dashboard, 5 seções) ----------
// Pendências de configuração (sem serviço, sem WhatsApp etc.) e o aviso de
// trial já aparecem globalmente (#avisos-painel/#trial-banner, US59,
// disparados em verificarStatusConta() pra toda tela) — não duplica mais
// isso aqui dentro do conteúdo do Início.
let inicioProximosAtuais = [];

function textoDataHoje() {
  const t = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Status do atendimento no Início: verde = confirmado/concluído, amarelo = a
// confirmar, vermelho = faltou/cancelou (a cor sozinha não basta — o rótulo
// vai escrito dentro da pílula).
const STATUS_INICIO = {
  confirmado: { rotulo: 'Confirmado', classe: 'inicio-status-ok' },
  concluido: { rotulo: 'Concluído', classe: 'inicio-status-ok' },
  a_confirmar: { rotulo: 'A confirmar', classe: 'inicio-status-aviso' },
  falta: { rotulo: 'Faltou', classe: 'inicio-status-erro' },
  cancelado: { rotulo: 'Cancelado', classe: 'inicio-status-erro' },
  reagendado: { rotulo: 'Reagendado', classe: 'inicio-status-neutro' },
};

// Menu "⋯" do atendimento (componente .ds-acoes do DS) — "Ver cliente" abre o
// cadastro, "Conversa" abre o WhatsApp. Tratado em ds-acoes-escolher
// (data-inicio-agendamento-id).
function renderInicioAtendimentoItem(ag) {
  const status = STATUS_INICIO[ag.status] || { rotulo: ag.status || '—', classe: 'inicio-status-neutro' };
  const nome = ag.cliente || ag.cliente_telefone || '';
  return `
    <div class="inicio-atendimento-item" data-id="${ag.id}">
      <div class="inicio-atendimento-topo">
        <strong class="inicio-atendimento-hora">${formatarHora(ag.data_hora)}</strong>
        <span class="inicio-status ${status.classe}">${status.rotulo}</span>
        <span class="ds-acoes" data-inicio-agendamento-id="${ag.id}">
          <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações do atendimento">⋯</button>
          <div class="ds-acoes-menu" role="menu" hidden>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="perfil">${iconeSvgHtml('users')} Ver cliente</button>
            ${ag.cliente_telefone ? `<button type="button" role="menuitem" class="ds-acoes-item" data-acao="conversa">${iconeSvgHtml('message-circle')} Conversa no WhatsApp</button>` : ''}
          </div>
        </span>
      </div>
      <div class="inicio-atendimento-cliente" title="${escapeHtml(nome)}">${escapeHtml(nome)}</div>
      <div class="inicio-atendimento-servico" title="${escapeHtml(ag.servico || '')}">${escapeHtml(ag.servico || '')}</div>
    </div>
  `;
}

// Próximos 3 atendimentos POR PROFISSIONAL, em colunas lado a lado (pedido
// explícito 2026-09-17 — antes era uma lista única paginada, sem separar
// por quem vai atender). `inicioProximosAtuais` já vem ordenado por
// data_hora (mesma ordem da API de agendamentos), então só agrupar e cortar
// nos 3 primeiros de cada profissional preserva "os PRÓXIMOS 3". Até 5
// colunas por linha (a largura mínima de cada uma é 1/5 do espaço — ver
// .inicio-proximos-colunas no CSS); a partir do 6º profissional quebra linha.
function renderInicioProximosCorpo() {
  if (!inicioProximosAtuais.length) {
    return `<div class="vazio"><span class="vazio-icone">${iconeSvgHtml('calendar-days')}</span><span>Nenhum agendamento para o restante de hoje.</span></div>`;
  }

  const colunasPorProfissional = new Map();
  for (const ag of inicioProximosAtuais) {
    const chave = ag.profissional_id || 'sem-profissional';
    if (!colunasPorProfissional.has(chave)) {
      colunasPorProfissional.set(chave, { nome: ag.profissional || 'Sem profissional', itens: [] });
    }
    const coluna = colunasPorProfissional.get(chave);
    if (coluna.itens.length < 3) coluna.itens.push(ag);
  }
  const colunas = [...colunasPorProfissional.values()];

  return `
    <div class="inicio-proximos-colunas">
      ${colunas.map((coluna) => `
        <div class="inicio-proximos-coluna">
          <div class="inicio-proximos-coluna-titulo">${escapeHtml(coluna.nome)}</div>
          <div class="inicio-atendimentos-lista">
            ${coluna.itens.map(renderInicioAtendimentoItem).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Cartão de número do Início — ícone opcional à esquerda, rótulo em caixa
// alta e o valor grande. (Antes reaproveitava .financeiro-resumo-card, que é
// centralizado e compartilhado com o Financeiro; agora é próprio do Início.)
function inicioCard(label, valorHtml, icone) {
  return `
    <div class="inicio-kpi${icone ? '' : ' inicio-kpi-sem-icone'}">
      ${icone ? `<span class="inicio-kpi-icone">${iconeSvgHtml(icone)}</span>` : ''}
      <div class="inicio-kpi-textos">
        <div class="inicio-kpi-rotulo">${label}</div>
        <div class="inicio-kpi-valor">${valorHtml}</div>
      </div>
    </div>
  `;
}

// Olho "ocultar valores" do Início — esconde tudo que é dinheiro (Previsto,
// Financeiro e a variação). Preferência por navegador (localStorage, com
// try/catch: modo privado/bloqueado cai pra "visível"). Os valores reais
// ficam em data-valor; só o texto é trocado, sem refazer as chamadas à API.
const CHAVE_INICIO_VALORES_OCULTOS = 'kyvvo_inicio_valores_ocultos';
const TEXTO_VALOR_OCULTO = 'R$ ••••';

function inicioValoresOcultos() {
  try { return localStorage.getItem(CHAVE_INICIO_VALORES_OCULTOS) === '1'; } catch (_) { return false; }
}

function inicioValorHtml(texto, classeExtra = '') {
  return `<span class="inicio-valor ${classeExtra}" data-valor="${escapeHtml(texto)}">${escapeHtml(texto)}</span>`;
}

function aplicarInicioValoresOcultos(raiz) {
  const ocultos = inicioValoresOcultos();
  raiz.classList.toggle('valores-ocultos', ocultos);
  raiz.querySelectorAll('.inicio-valor').forEach((el) => {
    el.textContent = ocultos ? TEXTO_VALOR_OCULTO : el.dataset.valor;
  });
  raiz.querySelectorAll('[data-inicio-oculta-com-valores]').forEach((el) => { el.hidden = ocultos; });
  const btn = raiz.querySelector('#btn-inicio-olho');
  if (btn) {
    btn.setAttribute('aria-pressed', ocultos ? 'true' : 'false');
    btn.setAttribute('aria-label', ocultos ? 'Mostrar valores' : 'Ocultar valores');
    btn.title = ocultos ? 'Mostrar valores' : 'Ocultar valores';
    btn.innerHTML = iconeSvgHtml(ocultos ? 'eye-off' : 'eye');
  }
}

async function renderInicio() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const iso = formatarDataISO(new Date());
  const [data, resumo] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/inicio/resumo'),
  ]);
  if (!data || !resumo) return;

  const agora = Date.now();
  const proximos = data.agendamentos.filter((ag) => ag.status !== 'cancelado' && new Date(ag.data_hora).getTime() >= agora);
  agendamentosAtuais = proximos;
  inicioProximosAtuais = proximos;

  const textoProximo = proximos.length ? ` · Próximo atendimento às ${formatarHora(proximos[0].data_hora)}` : '';

  // Financeiro — só pra quem tem o módulo ativo e pode ver dinheiro (mesma
  // restrição do endpoint /api/inicio/resumo); o backend já devolve null
  // nesse caso, então o resto da tela funciona normalmente sem essa seção.
  let financeiroHtml = '';
  if (resumo.financeiro) {
    const variacao = resumo.financeiro.variacao_pct;
    financeiroHtml = `
      <section class="inicio-secao inicio-secao-financeiro">
        <h3 class="inicio-secao-titulo">Financeiro</h3>
        <div class="inicio-financeiro-mes">
          ${inicioValorHtml(formatarPreco(resumo.financeiro.faturado_mes), 'financeiro-entrada inicio-financeiro-mes-valor')}
          <div class="inicio-financeiro-mes-rodape">
            <span class="inicio-financeiro-mes-legenda">faturado este mês</span>
            ${variacao != null ? `<span data-inicio-oculta-com-valores class="badge ${variacao >= 0 ? 'badge-variacao-positiva' : 'badge-variacao-negativa'}">${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}%</span>` : ''}
          </div>
        </div>
      </section>
    `;
  }

  // Detalhe por profissional dos horários livres de amanhã (hora cheia) —
  // só mostra a lista quando há mais de 1 profissional (com 1 só, o total
  // já diz tudo).
  const porProfissionalAmanha = resumo.oportunidades.horarios_livres_amanha_por_profissional || [];
  const detalheHorariosAmanha = porProfissionalAmanha.length > 1
    ? `<div class="inicio-oportunidade-detalhe">${porProfissionalAmanha.map((p) => `${escapeHtml(p.profissional_nome)}: ${p.livres}`).join(' · ')}</div>`
    : '';

  const oportunidadesHtml = `
    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Oportunidades</h3>
      <div class="inicio-oportunidade-item">
        <span class="inicio-oportunidade-icone">${iconeSvgHtml('users')}</span>
        <div class="inicio-oportunidade-texto">
          <span>${resumo.oportunidades.clientes_sem_retorno} clientes sem retorno há mais de ${resumo.oportunidades.cliente_inativo_dias} dias</span>
        </div>
        <button class="btn-secundario btn-pequeno" data-acao-atalho-inicio="clientes">Ver clientes</button>
      </div>
      <div class="inicio-oportunidade-item">
        <span class="inicio-oportunidade-icone">${iconeSvgHtml('calendar-days')}</span>
        <div class="inicio-oportunidade-texto">
          <span>${resumo.oportunidades.horarios_livres_amanha} horários livres amanhã</span>
          ${detalheHorariosAmanha}
        </div>
        <button class="btn-secundario btn-pequeno" data-acao-atalho-inicio="agendamento">Preencher agenda</button>
      </div>
    </section>
  `;

  // Atendimento agente Kyvvo — só existe pra tecnologia='ia' (o bot de menu
  // no n8n não grava conversas_ia); o backend já devolve null nesse caso.
  const agenteHtml = resumo.atendimento_ia ? `
    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Atendimento agente Kyvvo</h3>
      <div class="inicio-cards inicio-cards-4">
        ${inicioCard('Conversas hoje', resumo.atendimento_ia.conversas_hoje)}
        ${inicioCard('Não concluíram', resumo.atendimento_ia.nao_concluiram_hoje)}
        ${inicioCard('Concluídos', resumo.atendimento_ia.concluidos_hoje)}
        ${inicioCard('Min. economizados', resumo.atendimento_ia.minutos_economizados_hoje)}
      </div>
    </section>
  ` : '';

  // Faixas da tela, de cima pra baixo: [Seu dia | Financeiro], os próximos
  // atendimentos em até 5 colunas e [Oportunidades | Agente Kyvvo].
  conteudo.innerHTML = `
    <div class="inicio-pagina">
      <div class="inicio-cabecalho">
        <div class="inicio-cabecalho-textos">
          <h2 id="inicio-saudacao">${textoSaudacao()}</h2>
          <p class="inicio-data">${textoDataHoje()}${textoProximo}</p>
        </div>
        <div class="inicio-cabecalho-acoes">
          <button type="button" class="inicio-olho" id="btn-inicio-olho"></button>
          <button class="btn-novo-agendamento" id="btn-inicio-novo-agendamento">+ Novo agendamento</button>
        </div>
      </div>

      <div class="inicio-faixa inicio-faixa-topo${financeiroHtml ? ' com-financeiro' : ''}">
        <section class="inicio-secao">
          <h3 class="inicio-secao-titulo">Seu dia</h3>
          <div class="inicio-cards inicio-cards-3">
            ${inicioCard('Atendimentos', resumo.atendimentos_hoje, 'calendar-days')}
            ${inicioCard('Horários livres', resumo.horarios_livres_hoje, 'clock')}
            ${inicioCard('Previsto', inicioValorHtml(formatarPreco(resumo.previsto_hoje), 'inicio-kpi-previsto'), 'wallet')}
          </div>
        </section>
        ${financeiroHtml}
      </div>

      <section class="inicio-secao">
        <h3 class="inicio-secao-titulo">Próximos atendimentos</h3>
        <div id="inicio-secao-proximos-corpo">${renderInicioProximosCorpo()}</div>
      </section>

      <div class="inicio-faixa inicio-faixa-base">
        ${oportunidadesHtml}
        ${agenteHtml}
      </div>
    </div>
  `;
  document.getElementById('btn-inicio-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());
  const paginaInicio = conteudo.querySelector('.inicio-pagina');
  aplicarInicioValoresOcultos(paginaInicio);
  document.getElementById('btn-inicio-olho').addEventListener('click', () => {
    try { localStorage.setItem(CHAVE_INICIO_VALORES_OCULTOS, inicioValoresOcultos() ? '0' : '1'); } catch (_) { /* sem storage: vale só até recarregar */ }
    aplicarInicioValoresOcultos(paginaInicio);
  });
}

// Filtro de coluna/profissional da view Dia — null = "Todos". Client-side:
// renderDia já busca o dia inteiro, o chip só filtra o que desenha.
let filtroProfissionalDia = null;

// Tom de cor por status do agendamento (borda esquerda + fundo sutil +
// pílula). Enum real: a_confirmar/confirmado/concluido/falta/cancelado/
// reagendado (migrations 001/042/060/086) — o mock do canvas tinha
// "aguardando"/"em atendimento" que não existem no nosso modelo.
// a_confirmar (migration 086) — estágio inicial, amarelo, até o cliente
// confirmar pelo botão do WhatsApp (ver lib/automacoes.js); ao confirmar
// vira 'confirmado', verde — pedido explícito (antes 'confirmado' não tinha
// cor/pílula própria, ficava neutro).
const TOM_STATUS_AGENDA = {
  a_confirmar: { classe: 'agenda-tom-warn', pill: 'A confirmar', pillClasse: 'badge-a-confirmar' },
  confirmado: { classe: 'agenda-tom-ok', pill: 'Confirmado', pillClasse: 'badge-confirmado' },
  concluido: { classe: 'agenda-tom-ok', pill: 'Concluído', pillClasse: 'badge-concluido' },
  falta: { classe: 'agenda-tom-warn', pill: 'Falta', pillClasse: 'badge-falta' },
  cancelado: { classe: 'agenda-tom-bad', pill: 'Cancelado', pillClasse: 'badge-cancelado' },
  reagendado: { classe: 'agenda-tom-neutro', pill: 'Reagendado', pillClasse: 'badge-status-inativo' },
};
const AG_STATUS_SEM_ACOES = ['cancelado', 'concluido', 'falta'];

function menuAcoesAgendamentoHtml(id) {
  return `
    <div class="menu-acoes" id="menu-acoes-${id}">
      <button data-acao="concluir" data-id="${id}">Concluir</button>
      <button data-acao="reagendar" data-id="${id}">Reagendar</button>
      <button data-acao="encaixar" data-id="${id}">Encaixar</button>
      <button data-acao="falta" data-id="${id}">Marcar falta</button>
      <button data-acao="cancelar" data-id="${id}" class="acao-perigo">Cancelar</button>
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

// Horários da grade Dia — pedido explícito: horário de intervalo não aparece
// em NENHUMA view da agenda (antes essa função mantinha o slot do almoço e a
// grade desenhava uma linha "Intervalo"; agora só reaproveita
// gerarHorariosGrade, que já pula o almoço, igual Semana/Mês).
function gerarHorariosGradeDia() {
  return gerarHorariosGrade().map((hora) => ({ hora, intervalo: false }));
}
function minutosIntervaloAlmoco() {
  if (!configuracao.horario_almoco_ativo) return 0;
  return horarioParaMinutosFrontend(configuracao.horario_almoco_fim) - horarioParaMinutosFrontend(configuracao.horario_almoco_inicio);
}

// Card horizontal da view Dia (1 agendamento no horário) — hora · avatar do
// profissional · cliente · serviço … meta · pílula de status. Reaproveita
// data-acoes-toggle / .menu-acoes / data-id do resto da agenda (o handler
// delegado em #conteudo já cobre).
function renderDiaCardHorizontal(ag) {
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  return `
    <div class="agenda-card agenda-card-h ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-card-h-linha" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="agenda-card-hora">${formatarHora(ag.data_hora)}</span>
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(ag.profissional_id)};color:#fff">${iniciaisNome(ag.profissional || '')}</span>
        <span class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</span>
        <span class="agenda-card-servico">${ag.servico}</span>
        <span class="agenda-card-meta">${ag.duracao_minutos}min · ${formatarPreco(ag.preco)} · ${ag.profissional}</span>
        ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
        ${tom.pill ? `<span class="badge ${tom.pillClasse}">${tom.pill}</span>` : ''}
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : menuAcoesAgendamentoHtml(ag.id)}
    </div>
  `;
}

// Card compacto lado a lado (2+ no mesmo horário). Sem kebab (não cabe) — o
// clique abre o mesmo .menu-acoes, posicionado por baixo via CSS.
function renderDiaCardCompacto(ag) {
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  return `
    <div class="agenda-card agenda-card-c ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-card-c-linha" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(ag.profissional_id)};color:#fff">${iniciaisNome(ag.profissional || '')}</span>
        <div class="agenda-card-c-txt">
          <div class="agenda-card-hora">${formatarHora(ag.data_hora)}</div>
          <div class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="agenda-card-servico">${ag.servico}</div>
        </div>
      </div>
      ${semAcoes ? '' : menuAcoesAgendamentoHtml(ag.id)}
    </div>
  `;
}

// PR (2026-09-27) — blocos espichados na view Dia: altura/posição em px a
// partir da duração real (`ag.duracao_minutos`), em vez de "o agendamento só
// ocupa a hora em que começa" (bug real em produção: uma Micro Pigmentação
// de 240min aparecia como se ocupasse só 1 hora, e as 3 horas seguintes
// ficavam mostrando "Livre"). ALTURA_LINHA_DIA_PX precisa bater com o CSS
// (.agenda-grade-blocos .agenda-linha { height: 60px }) — 60px pros 60min de
// SLOT_INTERVALO_MINUTOS, 1px por minuto, matemática simples de top/height.
const ALTURA_LINHA_DIA_PX = 60;

// Minutos desde a ABERTURA, já descontando o intervalo de almoço pra quem
// vem depois dele — o mesmo espaço "comprimido" que gerarHorariosGradeDia já
// usa pra decidir quais linhas existem (o almoço nunca vira linha, então o
// overlay de blocos não pode deixar um buraco ali também). Nunca precisa
// lidar com um bloco atravessando o almoço: dentroDoHorarioFuncionamento (a
// mesma validação do backend, lib/horario-funcionamento.js) já rejeita
// qualquer agendamento cujo horário+duração invada o intervalo.
function minutoAjustadoDia(dataHoraISO) {
  const minutoBruto = horarioParaMinutosFrontend(horaChave24h(dataHoraISO));
  const aberturaMin = horarioParaMinutosFrontend(configuracao.horario_abertura || '08:00');
  const almocoFimMin = configuracao.horario_almoco_ativo ? horarioParaMinutosFrontend(configuracao.horario_almoco_fim) : null;
  const descontoAlmoco = (almocoFimMin != null && minutoBruto >= almocoFimMin) ? minutosIntervaloAlmoco() : 0;
  return minutoBruto - aberturaMin - descontoAlmoco;
}

// Layout de colunas por sobreposição REAL de horário (não mais "mesma hora
// cheia") — algoritmo clássico de "salas de reunião": ordena por início,
// agrupa em clusters que se sobrepõem transitivamente entre si, e dentro de
// cada cluster distribui em colunas (greedy: reaproveita a primeira coluna já
// livre). totalColunas de cada item é o tamanho do cluster em que ele caiu,
// não o total do dia inteiro — dois agendamentos que nunca se cruzam no
// tempo continuam ocupando a largura inteira, cada um na sua vez.
function calcularBlocosDia(agendamentos) {
  const itens = agendamentos
    .map((ag) => {
      const inicio = horarioParaMinutosFrontend(horaChave24h(ag.data_hora));
      const fim = inicio + Number(ag.duracao_minutos || 0);
      return { ag, inicio, fim };
    })
    .sort((a, b) => a.inicio - b.inicio);

  const resultado = [];
  let grupo = [];
  let fimGrupo = -Infinity;
  const fecharGrupo = () => {
    if (!grupo.length) return;
    const colunas = [];
    for (const item of grupo) {
      let coluna = colunas.findIndex((fimColuna) => fimColuna <= item.inicio);
      if (coluna === -1) coluna = colunas.length;
      colunas[coluna] = item.fim;
      resultado.push({ ...item, coluna });
    }
    const totalColunas = colunas.length;
    for (let i = resultado.length - grupo.length; i < resultado.length; i++) resultado[i].totalColunas = totalColunas;
  };
  for (const item of itens) {
    if (grupo.length && item.inicio >= fimGrupo) { fecharGrupo(); grupo = []; fimGrupo = -Infinity; }
    grupo.push(item);
    fimGrupo = Math.max(fimGrupo, item.fim);
  }
  fecharGrupo();
  return resultado;
}

function renderDiaGrade(diaISO, agendamentos) {
  const linhas = gerarHorariosGradeDia();
  if (linhas.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  // Cancelado continua contando pra ocupação visual do bucket (mesma
  // paridade de antes — só ganhava o tom "agendamento-cancelado" no card,
  // nunca sumia da grade).
  const blocos = calcularBlocosDia(agendamentos);

  const ehHoje = diaISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;

  const corpo = linhas.map(({ hora, intervalo }) => {
    const horaMin = horarioParaMinutosFrontend(hora);
    const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
    // "Ocupada" agora é sobreposição real (início < fim do bucket E início do
    // bucket < fim do agendamento) — um serviço de 240min começando às 11h
    // ocupa 11h/12h/13h/14h inteiras, não só a linha das 11h.
    const ocupada = !intervalo && blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
    const conteudoLinha = intervalo
      ? '<span class="agenda-livre agenda-intervalo">Intervalo</span>'
      : (ocupada ? '' : '<span class="agenda-livre">Livre</span>');
    return `
      <div class="agenda-linha${hora === horaAtualBucket ? ' agenda-linha-agora' : ''}${intervalo ? ' agenda-linha-intervalo' : ''}">
        <div class="agenda-rail">
          <span class="agenda-rail-hora">${hora}</span>
        </div>
        <div class="agenda-conteudo">${conteudoLinha}</div>
        ${intervalo || ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora}">+</button>`}
      </div>
    `;
  }).join('');

  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;
  const alturaTotal = linhas.length * ALTURA_LINHA_DIA_PX;
  const camadaBlocos = blocos.map(({ ag, coluna, totalColunas }) => {
    const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
    const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
    const largura = 100 / totalColunas;
    const esquerda = largura * coluna;
    const card = totalColunas > 1 ? renderDiaCardCompacto(ag) : renderDiaCardHorizontal(ag);
    return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${card}</div>`;
  }).join('');

  return `
    <div class="agenda-grade agenda-grade-blocos" style="height:${alturaTotal}px">
      ${corpo}
      <div class="agenda-bloco-camada">${camadaBlocos}</div>
    </div>
  `;
}

async function renderDia() {
  // Anterior/Próximo (e a primeira carga da aba) nunca param num dia fora
  // do horário de funcionamento configurado — pula direto pro próximo dia
  // aberto. Sem direção explícita (primeira carga), pula pra frente.
  dataRef = proximoDiaAberto(dataRef, 1);

  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [data, profs] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/profissionais'),
  ]);
  if (!data || !profs) return;

  agendamentosAtuais = data.agendamentos;

  // Filtro de profissional é client-side (o dia inteiro já veio) — some se o
  // profissional filtrado não tem agendamento hoje? não: o chip continua,
  // mostra a coluna vazia. Só limpa se o profissional sumiu do cadastro.
  if (filtroProfissionalDia && !profs.profissionais.some((p) => p.id === filtroProfissionalDia)) {
    filtroProfissionalDia = null;
  }
  const agsVisiveis = filtroProfissionalDia
    ? data.agendamentos.filter((ag) => ag.profissional_id === filtroProfissionalDia)
    : data.agendamentos;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const validos = agsVisiveis.filter((ag) => ag.status !== 'cancelado');
  const totalDia = validos.reduce((soma, ag) => soma + Number(ag.preco || 0), 0);

  const chipsHtml = profs.profissionais.length > 1
    ? `
      <div class="agenda-filtros">
        ${profs.profissionais.map((p) => `
          <button class="agenda-chip${filtroProfissionalDia === p.id ? ' agenda-chip-ativo' : ''}" data-filtro-prof="${p.id}">
            <span class="agenda-chip-avatar" style="background:${corProfissional(p.id)};color:#fff">${iniciaisNome(p.nome)}</span>
            ${(p.nome || '').split(' ')[0]}
          </button>
        `).join('')}
        <button class="agenda-chip${!filtroProfissionalDia ? ' agenda-chip-ativo' : ''}" data-filtro-prof="">Todos</button>
      </div>
    `
    : '';

  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-1" aria-label="Dia anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="1" aria-label="Próximo dia">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${dataLabel}</strong>
        <span>${nomeDiaSemana(dataRef)} · ${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} · ${formatarPreco(totalDia)}</span>
      </div>
    </div>
    ${chipsHtml}
  `;

  html += renderDiaGrade(iso, agsVisiveis);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') {
        dataRef = new Date();
      } else {
        dataRef.setDate(dataRef.getDate() + Number(nav));
      }
      dataRef = proximoDiaAberto(dataRef, nav === '-1' ? -1 : 1);
      renderDia();
    });
  });
  conteudo.querySelectorAll('[data-filtro-prof]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filtroProfissionalDia = chip.dataset.filtroProf || null;
      renderDia();
    });
  });
}

// Segunda-feira (início da semana pro backend — GET /agendamentos?view=semana
// usa date_trunc('week', ...), que no Postgres começa na segunda) da semana
// que contém `dataRef`. Ancora ao meio-dia LOCAL da data já convertida pra
// Brasília via formatarDataISO — nunca usa a instância real de `dataRef`
// direto (mesmo bug do histórico de formatarDataISO: perto da virada do dia
// em UTC, dar setDate/getDay numa instância "de verdade" pode cair no dia
// errado dependendo do fuso do navegador). Meio-dia local nunca cruza a
// virada de dia ao formatar de volta pra Brasília (formatarDataISO/
// nomeDiaSemana), então é seguro reusar essas funções no resto da view.
function inicioDaSemana(dataRef) {
  const [ano, mes, dia] = formatarDataISO(dataRef).split('-').map(Number);
  const d = new Date(ano, mes - 1, dia, 12);
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  return d;
}

async function renderSemana() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=semana&data=${iso}`);
  if (!data) return;

  agendamentosAtuais = data.agendamentos;

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
      if (nav === 'hoje') dataRef = new Date();
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
  dataRef = proximoDiaAberto(dataRef, 1);
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
  agendamentosAtuais = data.agendamentos;
  html += renderQuadroGrade(iso, profs.profissionais, data.agendamentos);

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 1);
    dataRef = proximoDiaAberto(dataRef, -1);
    renderQuadro();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 1);
    dataRef = proximoDiaAberto(dataRef, 1);
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

  agendamentosAtuais = data.agendamentos;

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
      if (nav === 'hoje') dataRef = new Date();
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
