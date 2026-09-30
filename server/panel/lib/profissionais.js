// Profissional padrão automático — extraído de index.js (fase 2 da
// modularização). Fica em lib/ (não dentro de routes/profissionais.js)
// porque também é chamada pelo IA Engine e por POST /api/agendamentos, que
// ainda não foram extraídos. Precisa do pool do Postgres; mesmo padrão
// `init(pool)` já usado em token-service.js.
let pool;
function init(poolInstance) {
  pool = poolInstance;
}

// Garante que o tenant tenha ao menos 1 profissional — cobre o momento antes
// do tenant cadastrar o primeiro de verdade (menu Profissionais, sem gate de
// plano desde 2026-09-11: todo plano real permite 3+, ver painel.html), sem
// o qual ele não teria como criar o profissional exigido por
// agendamentos.profissional_id (NOT NULL). Cria um profissional padrão
// nomeado com o responsável pelo tenant (nome do admin em usuarios), já
// vinculado a todos os serviços existentes, e devolve `unico: true` quando
// esse é o único profissional do tenant — usado por quem chama pra decidir
// se deve vincular novos serviços automaticamente e se deve pular a pergunta
// "com quem?" no bot/IA (sem isso, ficam inagendáveis: profissionais_servicos
// vazio, ou a IA pergunta um profissional que não faz diferença nenhuma).
async function garantirProfissionalPadrao(tenantId) {
  const { rows: existentes } = await pool.query(
    'SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL ORDER BY nome',
    [tenantId]
  );
  if (existentes.length === 1) return { ...existentes[0], unico: true };
  if (existentes.length > 1) return { ...existentes[0], unico: false };

  const { rows: admin } = await pool.query(
    `SELECT nome FROM usuarios WHERE tenant_id = $1 AND role = 'administrador' ORDER BY criado_em ASC LIMIT 1`,
    [tenantId]
  );
  const nome = (admin[0] && admin[0].nome) || 'Atendimento';
  const { rows: criado } = await pool.query(
    'INSERT INTO profissionais (tenant_id, nome) VALUES ($1, $2) RETURNING id, nome',
    [tenantId, nome]
  );
  await pool.query(
    `INSERT INTO profissionais_servicos (profissional_id, servico_id)
     SELECT $1, s.id FROM servicos s WHERE s.tenant_id = $2`,
    [criado[0].id, tenantId]
  );
  return { ...criado[0], unico: true };
}

module.exports = { init, garantirProfissionalPadrao };
