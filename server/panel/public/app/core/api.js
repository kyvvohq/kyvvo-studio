// Núcleo de autenticação/chamada à API — extraído de app.js (fase 1 da
// modularização, 2026-10-15). Única dependência verdadeiramente usada por
// toda tela do painel; por isso fica isolado numa folha sem nenhum import
// de volta pro resto do app.
export const token = localStorage.getItem('kyvvo_token');

export async function api(path, options = {}) {
  // Content-Type: application/json só entra quando existe body de verdade —
  // Fastify rejeita (400 FST_ERR_CTP_EMPTY_JSON_BODY) um POST sem corpo que
  // declara esse content-type, mesmo sem nenhum dado pra mandar (achado
  // testando /assumir e /liberar, que são POST só pelo efeito colateral,
  // sem payload — o mesmo bug já existia em /api/onboarding/dispensar).
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('kyvvo_token');
    window.location.href = '/login';
    return null;
  }
  const dados = await res.json();
  // Acesso limitado (US52) — qualquer escrita bloqueada por conta vencida/
  // inadimplente/suspensa/cancelada cai aqui, em qualquer página do app
  // (único ponto de passagem de toda chamada de API) — reforça o aviso
  // mesmo que o usuário já tivesse dispensado nesta sessão, já que ele
  // acabou de tentar editar algo de verdade.
  // Evento em vez de chamar renderBannerCobranca direto: api.js não importa
  // nada de core/shell.js (ficaria circular, shell.js importa api.js pro
  // próprio api() que usa). shell.js escuta 'kyvvo:bloqueio' e repassa pro
  // banner.
  if (res.status === 403 && dados && dados.bloqueio) {
    document.dispatchEvent(new CustomEvent('kyvvo:bloqueio', { detail: dados.bloqueio }));
  }
  return dados;
}
