// Service worker do canal "Push" (Configurações > Notificações > Regras).
// Fica na raiz de propósito — escopo padrão de um SW é o diretório onde ele
// está, e precisa cobrir o /painel.html inteiro. Registrado em
// app/modulos/notificacoes.js, sem nenhum papel de cache/offline (não
// intercepta fetch) — só os dois eventos de push abaixo.
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { titulo: event.data ? event.data.text() : 'Kyvvo Studio' };
  }
  const titulo = dados.titulo || 'Kyvvo Studio';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.corpo || '',
      icon: '/ds/favicon.svg',
      data: { url: dados.url || '/painel.html' },
    })
  );
});

// Foca uma aba já aberta no painel em vez de abrir outra sempre que possível.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/painel.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((janelas) => {
      for (const janela of janelas) {
        if (janela.url.includes('/painel.html') && 'focus' in janela) return janela.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    })
  );
});
