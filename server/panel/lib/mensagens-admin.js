// Mensagens/avisos que um admin da Kyvvo publica (kyvvo-admin, Produtos >
// Studio > Mensagens, ou "Kyvvo inteira") — buscadas aqui server-to-server e
// reexpostas em GET /api/mensagens-ativas pro painel. O browser não fala
// direto com admin.kyvvo.com.br (evita CORS, não configurado lá) — mesmo
// padrão de lib/horario-comercial.js: cache curto + fail-open silencioso
// (sem conseguir falar com o admin, não mostra mensagem nenhuma em vez de
// quebrar o carregamento do painel).
const ADMIN_URL = process.env.ADMIN_URL || 'https://admin.kyvvo.com.br';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — anúncio não precisa ser em tempo real

let cache = [];
let cacheEm = 0;

async function buscarMensagensAtivas() {
  const agora = Date.now();
  if (agora - cacheEm < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch(`${ADMIN_URL}/api/mensagens/ativas?produto=studio`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const dados = await res.json();
    cache = dados.mensagens || [];
    cacheEm = agora;
  } catch (err) {
    console.error(`[mensagens-admin] Falha ao buscar do admin: ${err.message}`);
    // Mantém o cache anterior (pode ser [] na primeira falha) — não derruba
    // o carregamento do painel por causa de um anúncio.
  }
  return cache;
}

module.exports = { buscarMensagensAtivas };
