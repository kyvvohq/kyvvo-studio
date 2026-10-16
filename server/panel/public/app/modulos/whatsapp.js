// Tela WhatsApp (Configurações > WhatsApp) — extraído de app.js (fase 4d da
// modularização, 2026-10-16). Conexão self-service (Embedded Signup da Meta)
// + lista/histórico de conversas do atendimento por IA.
import { api } from '../core/api.js';
import {
  escapeHtml, mostrarToast, abrirModal, fecharModal, conteudo,
  formatarTelefoneWhatsapp, formatarDataHoraCurta, formatarDataHoraDisparo,
} from '../core/shell.js';

let fbSdkPromise = null;
function carregarFacebookSdk(appId) {
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve) => {
    window.fbAsyncInit = function () {
      FB.init({ appId, cookie: true, xfbml: false, version: 'v26.0' });
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
  return fbSdkPromise;
}

// Self-service de conexão do WhatsApp (Embedded Signup da Meta) — mostra o
// status atual (GET /api/whatsapp/status, mesma lógica do card de status já
// usado em Fatura/Admin) e, se ainda não conectado, um botão que abre o
// popup de login do Facebook pra o tenant escolher/criar a WhatsApp Business
// Account dele. Ver plano em .claude/plans — nenhum token de tenant é salvo
// aqui, só waba_id/phone_number_id (POST /api/whatsapp/conectar).
// Status/atendimento de cada conversa (submenu Configurações > WhatsApp) —
// só 2 estados possíveis hoje (migration 052): 'ativo' (a IA está
// conduzindo) e 'aguardando_humano' (handoff pedido, ver US68.6).
const CONVERSA_STATUS_LABEL = { ativo: 'Em atendimento', aguardando_humano: 'Aguardando atendente' };
const CONVERSA_STATUS_BADGE = { ativo: 'badge-status-ativo', aguardando_humano: 'badge-status-suspenso' };

const ICONE_LUPA_CONVERSAS = '<svg class="ds-pesquisa-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICONE_SETA_CONVERSAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ICONE_BOT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13v1M15 13v1"/></svg>';
const ICONE_PESSOA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';

let conversasLista = [];
let conversasTenantNome = '';
const estadoConversas = { pagina: 1, tamanho: 10 };

function conversasFiltradas() {
  const busca = (document.getElementById('conv-busca').value || '').trim().toLowerCase();
  const status = document.getElementById('conv-status').value;
  return conversasLista.filter((c) => {
    if (status && c.status_conversa !== status) return false;
    if (busca && !`${c.cliente_nome || ''} ${c.telefone || ''}`.toLowerCase().includes(busca)) return false;
    return true;
  });
}

function renderLinhaConversa(c) {
  const humano = c.status_conversa !== 'ativo';
  const quando = c.ultima_mensagem_em
    ? (window.KyvvoDS ? KyvvoDS.dataRelativa(c.ultima_mensagem_em) : formatarDataHoraCurta(c.ultima_mensagem_em))
    : '—';
  return `
    <div class="ds-conversas-linha" role="row" tabindex="0" data-conversa-cliente="${c.cliente_id}">
      <span role="cell" class="ds-conversas-nome">${escapeHtml(c.cliente_nome || '—')}</span>
      <span role="cell" class="ds-conversas-whatsapp">${escapeHtml(formatarTelefoneWhatsapp(c.telefone || ''))}</span>
      <span role="cell"><span class="ds-badge ${humano ? 'ds-badge-aviso' : 'ds-badge-info'}">${escapeHtml(CONVERSA_STATUS_LABEL[c.status_conversa] || c.status_conversa)}</span></span>
      <span role="cell"><span class="ds-conversas-atendimento${humano ? ' ds-conversas-atendimento-humano' : ''}"><span class="ds-conversas-atendimento-icone">${humano ? ICONE_PESSOA : ICONE_BOT}</span>${humano ? escapeHtml(conversasTenantNome || 'Salão') : 'Kyvvo'}</span></span>
      <span role="cell" class="ds-conversas-data"${c.ultima_mensagem_em ? ` title="${escapeHtml(formatarDataHoraDisparo(c.ultima_mensagem_em))}"` : ''}>${escapeHtml(quando)}</span>
    </div>`;
}

function desenharConversas() {
  const lista = conversasFiltradas();
  const inicio = (estadoConversas.pagina - 1) * estadoConversas.tamanho;
  const fatia = lista.slice(inicio, inicio + estadoConversas.tamanho);
  const usaFiltro = document.getElementById('conv-busca').value || document.getElementById('conv-status').value;
  document.getElementById('conv-limpar').hidden = !usaFiltro;
  document.getElementById('conv-linhas').innerHTML = fatia.length
    ? fatia.map(renderLinhaConversa).join('')
    : `<div class="ds-vazio"><p class="ds-vazio-titulo">${conversasLista.length ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa registrada ainda'}</p><p class="ds-vazio-texto">${conversasLista.length ? 'Ajuste a busca ou o status.' : 'As conversas do atendimento por WhatsApp aparecem aqui.'}</p></div>`;
  if (window.KyvvoDS) KyvvoDS.paginacaoAtualizar(document.getElementById('conv-paginacao'), { total: lista.length, pagina: estadoConversas.pagina, tamanho: estadoConversas.tamanho });
}

function ligarListaConversas(dados) {
  conversasLista = dados.conversas || [];
  conversasTenantNome = dados.tenant_nome || '';
  estadoConversas.pagina = 1;
  document.getElementById('conv-paginacao').addEventListener('ds-paginacao-alterar', (e) => {
    estadoConversas.pagina = e.detail.pagina; estadoConversas.tamanho = e.detail.tamanho; desenharConversas();
  });
  document.getElementById('conv-busca').addEventListener('input', () => { estadoConversas.pagina = 1; desenharConversas(); });
  document.getElementById('conv-status').addEventListener('change', () => { estadoConversas.pagina = 1; desenharConversas(); });
  document.getElementById('conv-limpar').addEventListener('click', () => {
    document.getElementById('conv-busca').value = ''; document.getElementById('conv-status').value = '';
    estadoConversas.pagina = 1; desenharConversas();
  });
  const linhas = document.getElementById('conv-linhas');
  linhas.addEventListener('click', (e) => {
    const linha = e.target.closest('[data-conversa-cliente]');
    if (linha) abrirModalConversa(linha.dataset.conversaCliente);
  });
  // A linha não é um <button>: Enter/Espaço precisam de tratamento próprio.
  linhas.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const linha = e.target.closest('[data-conversa-cliente]');
    if (!linha) return;
    e.preventDefault();
    abrirModalConversa(linha.dataset.conversaCliente);
  });
  desenharConversas();
}

export async function renderWhatsapp() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [status, conversas] = await Promise.all([
    api('/api/whatsapp/status'),
    api('/api/whatsapp/conversas'),
  ]);
  if (!status || !conversas) return;

  // Redesenho: as 3 linhas de antes (label/número/detalhe) viram uma linha
  // única de texto — pedido explícito do Bruno pra reduzir a altura do
  // card, já que a WhatsApp é a primeira coisa da tela.
  // Bolinha de status (.status-dot, ver style.css) no lugar do emoji
  // 🟢/🟡/⚪ solto no texto — mesma paleta de cor já usada pelos badges de
  // status do resto do app (verde/amarelo/cinza).
  let statusTexto;
  let statusDotClasse;
  if (status.conectado) {
    statusDotClasse = 'status-dot-verde';
    statusTexto = `WhatsApp conectado — ${status.numeroExibido ? formatarTelefoneWhatsapp(status.numeroExibido) : 'número não informado'}${[status.nomeVerificado, status.qualidade ? `Qualidade: ${status.qualidade}` : null].filter(Boolean).length ? ` · ${[status.nomeVerificado, status.qualidade ? `Qualidade: ${status.qualidade}` : null].filter(Boolean).join(' · ')}` : ''}`;
  } else if (status.erro) {
    statusDotClasse = 'status-dot-amarelo';
    statusTexto = `Erro de conexão — ${status.erro}`;
  } else {
    statusDotClasse = 'status-dot-cinza';
    statusTexto = 'WhatsApp não conectado — conecte pra ativar o agendamento automático pelo bot.';
  }

  // US46.1 — antes de mostrar o botão de self-service, explica que ele é uma
  // das duas formas de conectar o WhatsApp. US39.1 trocou o antigo link "fale
  // com o suporte" pro caminho "Número pronto" por um pedido de verdade
  // (POST /api/whatsapp/solicitar-numero-novo), registrado no tenant pra a
  // operação (Bruno) ver quem está esperando — ver checklist da jornada na
  // task US39.1 do Notion. Continua sem prometer prazo fechado.
  const pedido = status.pedidoNumeroNovo;
  const planosInfo = status.conectado ? '' : `
    <div class="whatsapp-planos-info">
      <p><strong>Traga seu número</strong> — disponível agora: conecte o WhatsApp Business que sua empresa já usa clicando no botão abaixo, pelo Embedded Signup oficial da Meta. A ativação depende só da verificação da Meta ser concluída.</p>
      ${pedido
        ? `<p><strong>Número pronto</strong> — pedido recebido em ${formatarDataHoraCurta(pedido.solicitadoEm)}. Nossa equipe vai configurar um número novo pra você e avisar assim que estiver pronto (ainda não temos um prazo fechado pra isso).</p>`
        : `<p><strong>Número pronto</strong> — prefere que a Kyvvo configure um número novo pra você, sem esforço técnico? O time confirma disponibilidade e ativa o número; hoje esse caminho ainda depende de configuração manual, não é automático.</p>
           <button type="button" class="btn-secundario btn-tabela" id="btn-pedir-numero-novo" style="margin-top:4px">Pedir número novo</button>`}
    </div>
  `;

  // Dois blocos na mesma página, sem abas (pedido do Bruno, 2026-10-06, igual
  // ao CRM): Conectar em cima e Conversas embaixo. Status e conversas já vêm
  // carregados ANTES deste innerHTML (Promise.all acima).
  conteudo.innerHTML = `
    <h2 class="titulo-detalhe">WhatsApp</h2>
    <section class="whatsapp-bloco" id="bloco-whatsapp-conectar">
      <h3 class="whatsapp-bloco-titulo">Conectar</h3>
      <div class="pagamento-plano-card">
        <div class="pagamento-plano-linha">
          <span><span class="status-dot ${statusDotClasse}"></span>${escapeHtml(statusTexto)}</span>
        </div>
      </div>
      ${planosInfo}
      ${status.conectado ? '' : `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px">
        <button class="btn-primario" id="btn-conectar-whatsapp" disabled>Carregando conexão...</button>
        <button type="button" class="btn-secundario" id="btn-ver-manual">Ver manual</button>
      </div>`}
    </section>
    <section class="whatsapp-bloco" id="bloco-whatsapp-conversas">
      <h3 class="whatsapp-bloco-titulo">Conversas</h3>
      <div class="ds-pilha-conversas">
        <div class="ds-filtros">
          <div class="ds-pesquisa">${ICONE_LUPA_CONVERSAS}<input class="ds-pesquisa-input" type="search" id="conv-busca" placeholder="Buscar cliente ou telefone" aria-label="Buscar cliente ou telefone"></div>
          <div class="ds-select"><select id="conv-status" aria-label="Status"><option value="">Todos os status</option><option value="ativo">Em atendimento</option><option value="aguardando_humano">Aguardando atendente</option></select>${ICONE_SETA_CONVERSAS}</div>
          <div class="ds-filtros-fim"><button type="button" class="ds-btn ds-btn-ghost ds-btn-sm" id="conv-limpar" hidden>Limpar filtros</button></div>
        </div>
        <div class="ds-conversas" role="table" aria-label="Conversas">
          <div class="ds-conversas-cabecalho" role="row">
            <span role="columnheader">Conversa</span><span role="columnheader">Whatsapp</span><span role="columnheader">Status</span><span role="columnheader">Atendimento</span><span role="columnheader">Última conversa</span>
          </div>
          <div id="conv-linhas"></div>
        </div>
        <nav class="ds-paginacao" data-ds-paginacao id="conv-paginacao" data-ds-total="0" data-ds-tamanho="10" data-ds-tamanhos="10,25,50"></nav>
      </div>
    </section>
  `;

  if (!status.conectado) {
    document.getElementById('btn-ver-manual').addEventListener('click', abrirManualWaba);
    iniciarConexaoWhatsapp();
    const btnPedirNumeroNovo = document.getElementById('btn-pedir-numero-novo');
    if (btnPedirNumeroNovo) btnPedirNumeroNovo.addEventListener('click', abrirModalPedirNumeroNovo);
  }

  // Popup com o histórico completo ao clicar numa conversa. Atributo
  // "data-conversa-cliente" (não "data-cliente-id") de propósito — esse
  // último já é usado por um listener delegado global em #conteudo (linha
  // ~1479) que abre o modal de perfil do cliente; reaproveitar o mesmo nome
  // fazia os dois listeners disparar no mesmo clique e o modal de perfil
  // fechava/substituía este logo em seguida.
  ligarListaConversas(conversas);
}

// Popup com o histórico completo de uma conversa (US "clicar numa conversa
// abre a conversa realizada no atendimento"). Mensagens do cliente e da
// IA/atendente como bolhas de chat, mais recente embaixo.
async function abrirModalConversa(clienteId) {
  abrirModal('<h3>Conversa</h3>', '<div class="vazio">Carregando...</div>');
  const dados = await api(`/api/whatsapp/conversas/${clienteId}`);
  if (!dados) return;

  const mensagensHtml = dados.mensagens.length
    ? dados.mensagens.map((m) => `
        <div class="chat-bolha ${m.role === 'user' ? 'chat-bolha-cliente' : 'chat-bolha-atendente'}">
          <div class="chat-bolha-texto">${escapeHtml(m.texto || '')}</div>
          <div class="chat-bolha-hora">${formatarDataHoraCurta(m.criado_em)}</div>
        </div>
      `).join('')
    : '<div class="vazio">Nenhuma mensagem registrada.</div>';

  // "Continuar" em vez de "Assumir" quando já está em atendimento humano
  // (ex.: outro membro da equipe assumiu antes) — o clique tem o mesmo
  // efeito nos dois casos, só muda o rótulo.
  const jaAssumida = dados.cliente.status_conversa === 'aguardando_humano';

  // Aviso quando o worker devolveu a conversa ao bot sozinho por timeout
  // (handoff que ninguém retomou) — some assim que alguém assume de novo
  // (POST /liberar limpa handoff_devolvido_em).
  const notaHandoff = dados.cliente.handoff_devolvido_em && !jaAssumida
    ? `<p class="modal-subtitulo" style="color:var(--cor-alerta,#b45309)">🔄 Devolvida automaticamente ao atendimento por IA em ${formatarDataHoraCurta(dados.cliente.handoff_devolvido_em)} (sem retomada do salão a tempo).</p>`
    : '';

  abrirModal(
    `<h3>${escapeHtml(dados.cliente.nome || 'Conversa')}</h3>
     <p class="modal-subtitulo">${escapeHtml(formatarTelefoneWhatsapp(dados.cliente.telefone || ''))}</p>
     ${notaHandoff}
     <div class="modal-acoes">
       <button type="button" class="btn-secundario" id="btn-assumir-atendimento">${jaAssumida ? 'Continuar atendimento' : 'Assumir atendimento'}</button>
     </div>`,
    `<div class="chat-conversa">${mensagensHtml}</div>`
  );
  // Abre já rolado pra mensagem mais recente (mantém a ordem cronológica das
  // bolhas, igual WhatsApp de verdade — só evita ter que rolar manualmente).
  const chatConversa = document.querySelector('.chat-conversa');
  if (chatConversa) chatConversa.scrollTop = chatConversa.scrollHeight;

  // Abre a janela de atendimento ao vivo (atendimento.html, nova aba —
  // continua com o resto do painel disponível na aba original). window.open
  // vai primeiro e síncrono, sem nenhum await antes — um `await` antes dele
  // quebra o "gesto do usuário" que o navegador exige pra não bloquear o
  // popup silenciosamente (Chrome não lança erro, só bloqueia sem avisar).
  // Não precisa chamar /assumir aqui: atendimento.html já faz isso sozinha
  // ao carregar (idempotente).
  document.getElementById('btn-assumir-atendimento').addEventListener('click', () => {
    window.open(`/atendimento.html?clienteId=${clienteId}`, '_blank', 'width=440,height=680');
    fecharModal();
  });
}

// CA (US39.1) — passos 2/3 da jornada "Novo número": os outros dados mínimos
// (nome do negócio, telefone, segmento, horário) já foram coletados no
// cadastro, então o formulário só pede o que ainda falta (preferência de DDD)
// e a confirmação de que o tenant aceita usar um número novo fornecido pela
// Kyvvo. Depois de enviar, mostra a mensagem de expectativa (sem prometer
// prazo) no lugar do formulário.
function abrirModalPedirNumeroNovo() {
  abrirModal(
    '<h3>Pedir número novo</h3>',
    `
      <p class="modal-texto">A Kyvvo configura um número de WhatsApp novo pro seu negócio — você não precisa fazer nada técnico. Prazo é confirmado depois que a gente validar disponibilidade.</p>
      <label for="numero-novo-ddd">DDD de preferência (opcional)</label>
      <input type="text" id="numero-novo-ddd" placeholder="Ex.: 34" maxlength="3" inputmode="numeric">
      <label class="dia-checkbox" style="margin-top:12px">
        <input type="checkbox" id="numero-novo-aceite">
        Entendo que o número será fornecido pelo time Kyvvo e serei avisado quando estiver pronto.
      </label>
      <div class="modal-erro" id="numero-novo-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-numero-novo">Cancelar</button>
        <button class="btn-primario" id="btn-confirmar-numero-novo">Enviar pedido</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-numero-novo').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-numero-novo').addEventListener('click', async () => {
    const erroEl = document.getElementById('numero-novo-erro');
    erroEl.textContent = '';

    if (!document.getElementById('numero-novo-aceite').checked) {
      erroEl.textContent = 'Confirme que você entendeu como funciona antes de enviar.';
      return;
    }

    const btn = document.getElementById('btn-confirmar-numero-novo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const dddPreferencia = document.getElementById('numero-novo-ddd').value.trim();
    const resultado = await api('/api/whatsapp/solicitar-numero-novo', {
      method: 'POST',
      body: JSON.stringify({ ddd_preferencia: dddPreferencia || null }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pedido enviado! A gente avisa assim que o número estiver pronto.', 'sucesso');
      renderWhatsapp();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao enviar o pedido.';
      btn.disabled = false;
      btn.textContent = 'Enviar pedido';
    }
  });
}

// "Ver manual": abre o PDF de como conectar o WABA numa janela própria (não
// maximizada, centralizada sobre a atual) e a traz pra frente. Se o navegador
// bloquear o pop-up, avisa com um toast.
const URL_MANUAL_WABA = '/manual-whatsapp-waba.pdf';
function abrirManualWaba() {
  const largura = Math.min(980, window.screen.availWidth - 80);
  const altura = Math.min(860, window.screen.availHeight - 80);
  const esq = Math.max(0, Math.round((window.screenX || window.screenLeft || 0) + (window.outerWidth - largura) / 2));
  const topo = Math.max(0, Math.round((window.screenY || window.screenTop || 0) + (window.outerHeight - altura) / 2));
  const janela = window.open(
    URL_MANUAL_WABA, 'kyvvo-manual-waba',
    `popup=yes,width=${largura},height=${altura},left=${esq},top=${topo},resizable=yes,scrollbars=yes`
  );
  if (janela) { janela.focus(); return; }
  mostrarToast('O navegador bloqueou a janela do manual. Libere pop-ups para este site e tente de novo.', 'erro');
}

async function iniciarConexaoWhatsapp() {
  const btn = document.getElementById('btn-conectar-whatsapp');
  const config = await api('/api/whatsapp/config-publica');
  if (!btn) return; // usuário já navegou pra outra tela enquanto isso carregava

  if (!config || !config.appId || !config.configId) {
    btn.textContent = 'Conexão indisponível no momento';
    return;
  }

  await carregarFacebookSdk(config.appId);
  btn.textContent = 'Conectar WhatsApp';
  btn.disabled = false;

  let dadosSignup = null;
  function ouvirMensagem(event) {
    if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
    try {
      const dados = JSON.parse(event.data);
      if (dados.type === 'WA_EMBEDDED_SIGNUP' && dados.event === 'FINISH') {
        dadosSignup = dados.data;
      }
    } catch (erro) {
      // mensagem de outra origem/formato inesperado — ignora
    }
  }
  window.addEventListener('message', ouvirMensagem);

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    FB.login(
      (response) => {
        window.removeEventListener('message', ouvirMensagem);
        const code = response.authResponse && response.authResponse.code;
        if (!code || !dadosSignup) {
          mostrarToast('Conexão cancelada ou incompleta. Tente novamente.', 'erro');
          renderWhatsapp();
          return;
        }
        conectarWhatsapp(code, dadosSignup.waba_id, dadosSignup.phone_number_id);
      },
      { config_id: config.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {} } }
    );
  }, { once: true });
}

async function conectarWhatsapp(code, wabaId, phoneNumberId) {
  const resultado = await api('/api/whatsapp/conectar', {
    method: 'POST',
    body: JSON.stringify({ code, wabaId, phoneNumberId }),
  });
  if (resultado && !resultado.error) {
    mostrarToast('WhatsApp conectado com sucesso!', 'sucesso');
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao conectar o WhatsApp.', 'erro');
  }
  renderWhatsapp();
}
