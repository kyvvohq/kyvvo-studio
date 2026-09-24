// Injeta o header e o rodapé padrão da Kyvvo (partials/header.html e
// partials/footer.html) nos placeholders #site-header / #site-footer —
// fonte única pra não duplicar essa marcação em cada página HTML da landing.
// Também concentra a lógica do modal de login, usada pelo botão "Entrar"
// injetado no header.

const PANEL_ORIGIN = 'https://studio.kyvvo.com.br';

async function injectPartial(url, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const res = await fetch(url);
  target.outerHTML = await res.text();
}

function openLoginModal() {
  const overlay = document.getElementById('loginModalOverlay');
  const iframe = document.getElementById('loginIframe');
  iframe.src = PANEL_ORIGIN + '/login';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Leitor de tela/teclado: move o foco pro diálogo assim que ele abre (o
  // conteúdo do login em si é um iframe de outra origem, então não dá pra
  // focar direto nele — o botão de fechar é o primeiro elemento focável do
  // diálogo no mesmo documento).
  document.getElementById('btnCloseLogin').focus();
}

function closeLoginModal() {
  const overlay = document.getElementById('loginModalOverlay');
  const iframe = document.getElementById('loginIframe');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  iframe.src = 'about:blank';
  // Devolve o foco pro botão que abriu o diálogo.
  document.getElementById('btnLogin').focus();
}

window.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('loginModalOverlay');
  if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
    closeLoginModal();
  }
});

window.addEventListener('message', (e) => {
  if (e.origin !== PANEL_ORIGIN) return;
  if (e.data && e.data.source === 'kyvvo-login' && e.data.status === 'success') {
    // Login sem e-mail validado (US20/CA10) vai pra tela de validação do token.
    const destino = e.data.admin
      ? '/admin/painel.html'
      : e.data.verificar
        ? '/verificar'
        : '/painel';
    window.top.location.href = PANEL_ORIGIN + destino;
  }
});

// Resolve links que apontam pro portal (ex: "Criar conta" → cadastro), já que
// o portal roda em outra origem (PANEL_ORIGIN). Qualquer elemento com
// data-panel-path recebe o href absoluto após a injeção do header.
function resolverLinksDoPortal() {
  document.querySelectorAll('[data-panel-path]').forEach((el) => {
    el.setAttribute('href', PANEL_ORIGIN + el.getAttribute('data-panel-path'));
  });
}

Promise.all([
  injectPartial('/partials/header.html', 'site-header'),
  injectPartial('/partials/footer.html', 'site-footer'),
]).then(() => {
  resolverLinksDoPortal();
  // O rodapé só existe no DOM depois da injeção acima — o carrossel do DS
  // (components.js) hidrata sozinho no clique (delegado), mas os pontos
  // (.ds-carrossel-ponto) só aparecem depois de preparado uma vez;
  // carrosselIndice() já chama prepararCarrossel() internamente.
  const carrossel = document.querySelector('.ds-carrossel');
  if (carrossel && window.KyvvoDS) window.KyvvoDS.carrosselIndice(carrossel);
  if (typeof onSharedReady === 'function') onSharedReady();
});
