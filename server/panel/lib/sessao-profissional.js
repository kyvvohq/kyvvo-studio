// Sessão de 90 dias do acesso de profissional (login sem senha) — mecanismo
// PARALELO ao RS256 do kyvvo-platform (lib/platform.js), só pra este papel.
// Token opaco (não-JWT): não precisa reintroduzir assinatura/segredo local
// nenhum, e esse papel nunca precisa de SSO com outros produtos Kyvvo. O
// token guardado é o hash (sha256) do que trafega como Bearer — vazar esta
// tabela não deve expor sessões ativas utilizáveis (ver
// server/db/094_usuarios_profissional.sql).
const crypto = require('crypto');

const SESSAO_PROFISSIONAL_DIAS = 90;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function criarSessaoProfissional(pool, { usuarioId, tenantId }) {
  const token = crypto.randomBytes(32).toString('hex'); // mesmo padrão de gerarTokenConvite (routes/equipe.js)
  const expiraEm = new Date(Date.now() + SESSAO_PROFISSIONAL_DIAS * 24 * 60 * 60000);
  await pool.query(
    'INSERT INTO sessoes_profissional (usuario_id, tenant_id, token_hash, expira_em) VALUES ($1, $2, $3, $4)',
    [usuarioId, tenantId, hashToken(token), expiraEm.toISOString()],
  );
  return token; // só o opaco sai daqui; o que fica no banco é o hash
}

async function resolverSessaoProfissional(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT usuario_id, tenant_id FROM sessoes_profissional
     WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

// Chamado quando o admin desativa/remove um membro (routes/equipe.js) —
// sem isto, "desativar" não mataria uma sessão de 90 dias já aberta no
// navegador do profissional (usuarios.ativo É checado em authenticate, mas
// só pro próximo request; isto cobre o caso de reativação posterior não
// ressuscitar sessões antigas sem um novo convite/aceite).
async function revogarSessoesProfissional(pool, usuarioId) {
  await pool.query(
    'UPDATE sessoes_profissional SET revogado_em = now() WHERE usuario_id = $1 AND revogado_em IS NULL',
    [usuarioId],
  );
}

module.exports = {
  SESSAO_PROFISSIONAL_DIAS,
  hashToken,
  criarSessaoProfissional,
  resolverSessaoProfissional,
  revogarSessoesProfissional,
};
