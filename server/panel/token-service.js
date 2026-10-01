// US21 — serviço centralizado de tokens de validação por e-mail e WhatsApp
// (E5 — Onboarding e self-service). Generaliza o serviço criado na US20 (que
// só cobria a verificação de e-mail do cadastro) pra ser reutilizado por
// qualquer fluxo que precise de um código de 6 dígitos: verificação de
// e-mail, recuperação de senha, alteração de e-mail e alteração de WhatsApp —
// cada um identificado pelo `tipo` (CA01).
//
// `criarToken`/`enviarPorCanais` são as duas metades de `send` expostas em
// separado pro cadastro (US20): ele gera e persiste o token dentro da mesma
// transação da criação do usuário, mas só dispara o e-mail/WhatsApp (chamada
// de rede) depois do COMMIT e sem aguardar, pra uma rede lenta não segurar
// conexão do pool nem atrasar a resposta. `send` é o atalho que faz as duas
// coisas de uma vez (CA06), pra fluxos mais simples.
//
// Ambos os provedores (Resend/Meta WhatsApp Cloud API) são opcionais: sem as
// variáveis de ambiente configuradas, o envio cai num modo de log (imprime o
// token no console), pra que qualquer fluxo funcione em dev/homologação sem
// depender de serviço externo. `enviarPorCanais` nunca lança — falha de um
// canal é logada e engolida, o outro canal ainda é tentado (CA04).

const crypto = require('crypto');
const { enviarEmail } = require('./lib/email');

const TOKEN_EXPIRACAO_MINUTOS = 30;
const MAX_TENTATIVAS = 5;
const TIPOS_VALIDOS = ['email_verificacao', 'recuperacao_senha', 'alteracao_email', 'alteracao_whatsapp'];

// `send`/`validate` usam o pool compartilhado do index.js (injetado via
// `init`) em vez de abrir uma conexão própria — evita duplicar o pool de
// conexões com o Postgres dentro do mesmo processo.
let pool = null;
function init(sharedPool) {
  pool = sharedPool;
}

function validarTipo(tipo) {
  if (!TIPOS_VALIDOS.includes(tipo)) {
    throw new Error(`token-service: tipo inválido "${tipo}"`);
  }
}

// Gera um token numérico de 6 dígitos (com zeros à esquerda). crypto.randomInt
// evita o viés de Math.random e é suficiente aqui.
function gerarToken() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Mascara o e-mail pra exibição na tela de validação: "jo***@dominio.com".
function mascararEmail(email) {
  const [usuario, dominio] = String(email).split('@');
  if (!dominio) return email;
  const visivel = usuario.slice(0, 2);
  return `${visivel}${'*'.repeat(Math.max(usuario.length - 2, 1))}@${dominio}`;
}

// Envia o token por e-mail pelo serviço de e-mail da plataforma (lib/email.js)
// (CA02). Retorna true se realmente despachou pra um provedor, false se caiu
// no modo de log.
async function enviarTokenEmail(email, token, nome) {
  const ok = await enviarEmail({
    to: email,
    subject: `Seu código de verificação Kyvvo — ${token}`,
    html: emailHtml(token, nome),
    tag: 'token_verificacao',
  });
  if (!ok && !process.env.PLATFORM_EMAIL_TOKEN && !process.env.RESEND_API_KEY) {
    console.log(`[token-service] (dev) e-mail para ${email} — código: ${token}`);
  }
  return ok;
}

// Envia o token por WhatsApp via API oficial da Meta (Cloud API), se
// configurada. Espera o número nacional em dígitos e prefixa o DDI 55.
async function enviarTokenWhatsappMeta(whatsappNacional, token) {
  const apiToken = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const texto = `Seu código de verificação Kyvvo é: ${token}. Válido por ${TOKEN_EXPIRACAO_MINUTOS} minutos. Não compartilhe este código.`;

  try {
    const res = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `55${whatsappNacional}`,
        type: 'text',
        text: { body: texto },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.error(`[token-service] Meta WhatsApp API respondeu ${res.status} ao enviar para 55${whatsappNacional}: ${corpo}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[token-service] Falha ao enviar WhatsApp (Meta) para 55${whatsappNacional}: ${err.message}`);
    return false;
  }
}

// Escolhe o provedor: API oficial da Meta se configurada (CA03), senão cai
// no modo de log (dev/homolog).
async function enviarTokenWhatsapp(whatsappNacional, token) {
  // Tenant sem WhatsApp cadastrado (ex: criado pela área admin, US16) — não
  // há número nenhum pra tentar enviar.
  if (!whatsappNacional) {
    return false;
  }

  if (process.env.META_WHATSAPP_TOKEN && process.env.META_PHONE_NUMBER_ID) {
    return enviarTokenWhatsappMeta(whatsappNacional, token);
  }

  console.log(`[token-service] (dev) WhatsApp para 55${whatsappNacional} — código: ${token}`);
  return false;
}

function emailHtml(token, nome) {
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#080b14;padding:32px;color:#f2f2f7">
    <div style="max-width:420px;margin:0 auto;background:#12162a;border:1px solid #232847;border-radius:16px;padding:32px">
      <div style="font-size:22px;font-weight:800;letter-spacing:-.03em;margin-bottom:24px">
        ky<span style="color:#a688ff">vv</span>o
      </div>
      <h1 style="font-size:18px;margin:0 0 12px">${saudacao} Aqui está seu código de verificação</h1>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;color:#a688ff;margin:0 0 24px">
        ${token}
      </div>
      <p style="color:#a1a5c4;font-size:12px;line-height:1.6;margin:0">
        O código expira em ${TOKEN_EXPIRACAO_MINUTOS} minutos. Se não foi você quem solicitou, ignore este
        e-mail e não compartilhe este código com ninguém.
      </p>
    </div>
  </div>`;
}

// Gera o token e persiste em `tokens_validacao` (CA01), invalidando qualquer
// token pendente anterior do mesmo (userId, tipo) (CA05). `client` pode ser o
// pool do módulo (uso simples) ou um client de transação já aberto pelo
// chamador (ex: cadastro, que precisa do INSERT atômico com a criação do
// usuário).
async function criarToken(client, { userId, tipo }) {
  validarTipo(tipo);
  const token = gerarToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRACAO_MINUTOS * 60000);

  await client.query(
    'UPDATE tokens_validacao SET usado = true WHERE user_id = $1 AND tipo = $2 AND NOT usado',
    [userId, tipo]
  );
  await client.query(
    'INSERT INTO tokens_validacao (user_id, tipo, token, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, tipo, token, expiresAt.toISOString()]
  );
  return token;
}

// Dispara o envio nos canais pedidos, em paralelo e best-effort (CA02/CA03/
// CA04): a falha de um canal não afeta o outro nem lança erro.
async function enviarPorCanais({ token, canais, email, whatsapp, nome }) {
  const lista = canais && canais.length ? canais : ['email', 'whatsapp'];
  const envios = [];
  if (lista.includes('email') && email) envios.push(enviarTokenEmail(email, token, nome));
  if (lista.includes('whatsapp') && whatsapp) envios.push(enviarTokenWhatsapp(whatsapp, token));
  await Promise.allSettled(envios);
}

// Gera, persiste e envia o token de uma vez (CA06) — atalho pra fluxos que
// não precisam do controle fino de `criarToken`/`enviarPorCanais` em
// separado (ex: recuperação de senha, alteração de e-mail/WhatsApp).
async function send({ userId, tipo, canais, email, whatsapp, nome }) {
  const token = await criarToken(pool, { userId, tipo });
  await enviarPorCanais({ token, canais, email, whatsapp, nome });
  return token;
}

// Valida um token pendente do (userId, tipo) (CA05/CA06): código incorreto
// soma uma tentativa; 5 tentativas erradas bloqueia o token mesmo sem acerto;
// expirado ou já bloqueado nunca valida, mesmo com o código certo.
async function validate({ userId, tipo, token }) {
  validarTipo(tipo);
  const { rows } = await pool.query(
    `SELECT id, token, expires_at, tentativas
     FROM tokens_validacao
     WHERE user_id = $1 AND tipo = $2 AND NOT usado
     ORDER BY criado_em DESC
     LIMIT 1`,
    [userId, tipo]
  );
  const pendente = rows[0];
  if (!pendente) {
    return { valido: false, motivo: 'nao_encontrado' };
  }
  if (new Date(pendente.expires_at).getTime() < Date.now()) {
    return { valido: false, motivo: 'expirado' };
  }
  if (pendente.tentativas >= MAX_TENTATIVAS) {
    return { valido: false, motivo: 'bloqueado' };
  }
  if (pendente.token !== String(token)) {
    const { rows: attRows } = await pool.query(
      'UPDATE tokens_validacao SET tentativas = tentativas + 1 WHERE id = $1 RETURNING tentativas',
      [pendente.id]
    );
    if (attRows[0].tentativas >= MAX_TENTATIVAS) {
      await pool.query('UPDATE tokens_validacao SET usado = true WHERE id = $1', [pendente.id]);
      return { valido: false, motivo: 'bloqueado' };
    }
    return { valido: false, motivo: 'incorreto' };
  }

  await pool.query('UPDATE tokens_validacao SET usado = true WHERE id = $1', [pendente.id]);
  return { valido: true };
}

module.exports = {
  TOKEN_EXPIRACAO_MINUTOS,
  MAX_TENTATIVAS,
  init,
  gerarToken,
  mascararEmail,
  criarToken,
  enviarPorCanais,
  send,
  validate,
};
