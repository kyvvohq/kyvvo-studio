// Configurações do sistema editáveis pelo admin sem deploy (US38) —
// extraído de index.js (fase 1 da modularização).
//
// `config` é um objeto mutável único (não `let`s soltos): outros módulos
// fazem `const configSistema = require('./configuracoes-sistema')` e leem
// `configSistema.config.trialDias` — como é sempre a MESMA referência de
// objeto, atualizações feitas por `carregar()` (chamado no boot e de novo
// depois de um PATCH admin) ficam visíveis pra quem já importou o módulo,
// sem precisar de getter function. Nunca reatribuir `module.exports.config`
// inteiro — só mutar as propriedades dele.
const config = {
  trialDias: 14,
  maxReenviosHora: 5,
  carenciaDiasInadimplencia: 3,
  emailSuporte: 'suporte@kyvvo.com.br',
  whatsappSuporte: '553484285182',
  // Horas em 'aguardando_humano' sem o salão retomar antes do worker
  // (lib/worker-handoff.js) devolver a conversa ao atendimento por IA.
  handoffRetornoHoras: 2,
};

let pool;
function init(poolInstance) {
  pool = poolInstance;
}

// CA06/CA09 (US38) — carrega `configuracoes_sistema` do banco pra dentro de
// `config`, tanto no boot quanto logo após um PATCH do admin — assim a
// mudança vale pro processo já rodando, sem precisar de deploy/restart.
// Chaves ausentes na tabela (banco vazio/erro de leitura) mantêm o valor
// atual em memória.
async function carregar() {
  const { rows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
  const valores = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));

  if (valores.trial_dias != null) config.trialDias = parseInt(valores.trial_dias, 10);
  if (valores.max_tentativas_reenvio_token != null) config.maxReenviosHora = parseInt(valores.max_tentativas_reenvio_token, 10);
  if (valores.carencia_dias_inadimplencia != null) config.carenciaDiasInadimplencia = parseInt(valores.carencia_dias_inadimplencia, 10);
  if (valores.email_suporte != null) config.emailSuporte = valores.email_suporte;
  if (valores.whatsapp_suporte != null) config.whatsappSuporte = valores.whatsapp_suporte;
  if (valores.whatsapp_handoff_retorno_horas != null) config.handoffRetornoHoras = parseInt(valores.whatsapp_handoff_retorno_horas, 10);
}

module.exports = { config, init, carregar };
