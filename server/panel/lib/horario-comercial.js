// Horário comercial de disparo de WhatsApp das automações — cópia verbatim de
// kyvvo-people/lib/horario-comercial.js (o mecanismo é product-agnostic). No
// v1 o Studio compartilha a MESMA config do People (chaves
// whatsapp_horario_* em configuracoes_sistema do kyvvo-admin, lidas via
// GET /api/configuracoes/whatsapp-horario, rota pública). Se um dia o horário
// do salão precisar divergir do recrutador, criar chaves _studio no admin.
// Fallback seguro: sem falar com o admin, assume sempre dentro do horário —
// a trava fica inofensiva em vez de travar todo disparo.
const ADMIN_URL = process.env.ADMIN_URL || 'https://admin.kyvvo.com.br';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — não precisa ser em tempo real

let cache = null; // { inicio, fim, dias_uteis } | null (nunca respondeu ainda)
let cacheEm = 0;

async function buscarConfig() {
  const agora = Date.now();
  if (cache && (agora - cacheEm) < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch(`${ADMIN_URL}/api/configuracoes/whatsapp-horario`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cache = await res.json();
    cacheEm = agora;
  } catch (err) {
    console.error(`[horario-comercial] Falha ao buscar config do admin: ${err.message}`);
    // Mantém o cache anterior (pode ser null na primeira falha) — não
    // derruba a checagem, só não atualiza dessa vez.
  }
  return cache;
}

const DIA_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Pura — separada da busca de config pra dar pra testar sem rede/mock de
// fetch. Sem config (admin nunca respondeu) -> sempre true (fallback seguro).
function dentroDoHorario(data, config) {
  if (!config) return true;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(data);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const diaIso = DIA_ISO[mapa.weekday];
  if (!config.dias_uteis.includes(diaIso)) return false;
  const horaAtual = `${mapa.hour}:${mapa.minute}`;
  return horaAtual >= config.inicio && horaAtual < config.fim;
}

async function estaNoHorarioComercial(data = new Date()) {
  const config = await buscarConfig();
  return dentroDoHorario(data, config);
}

module.exports = { estaNoHorarioComercial, dentroDoHorario, buscarConfig };
