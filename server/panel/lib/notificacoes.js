// Serviço de notificações — registro de tipos + cálculo dos pendentes de um
// tenant. Pensado pra crescer sem precisar de endpoint novo a cada tipo: o
// balão (GET /api/notificacoes, routes/notificacoes.js) e a tela
// Configurações > Notificações (GET/PATCH /api/configuracao, campo
// notificacoes_ativas) leem esta lista, não um tipo hard-coded.
//
// Cada tipo: `chave` (persistida em tenants.notificacoes_ativas), `titulo`
// (rótulo tanto no dropdown do balão quanto no toggle de Configurações) e
// `calcular(pool, tenantId)` -> array de itens pendentes (vazio = nada a
// notificar agora).
const TIPOS_NOTIFICACAO = [
  {
    chave: 'whatsapp_aguardando_humano',
    titulo: 'Conversas de WhatsApp aguardando atendimento humano',
    async calcular(pool, tenantId) {
      const { rows } = await pool.query(
        `SELECT id, nome, telefone, aguardando_humano_desde FROM clientes
         WHERE tenant_id = $1 AND status_conversa = 'aguardando_humano'
         ORDER BY aguardando_humano_desde ASC`,
        [tenantId]
      );
      return rows.map((c) => ({
        id: c.id,
        titulo: c.nome || c.telefone,
        detalhe: 'aguardando atendimento humano',
        desde: c.aguardando_humano_desde,
      }));
    },
  },
];

// Chave ausente em `notificacoesAtivas` conta como ativa (default seguro) —
// só `false` explícito desliga. Tipos sem nenhum item pendente não entram no
// resultado (o balão/dropdown não precisam saber distinguir "0 itens" de
// "tipo nem existe").
async function listarNotificacoesPendentes(pool, tenantId, notificacoesAtivas) {
  const ativas = notificacoesAtivas || {};
  const resultado = [];
  for (const tipo of TIPOS_NOTIFICACAO) {
    if (ativas[tipo.chave] === false) continue;
    const itens = await tipo.calcular(pool, tenantId);
    if (itens.length) resultado.push({ tipo: tipo.chave, titulo: tipo.titulo, itens });
  }
  return resultado;
}

module.exports = { TIPOS_NOTIFICACAO, listarNotificacoesPendentes };
