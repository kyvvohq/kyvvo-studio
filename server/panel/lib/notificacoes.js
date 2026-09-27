// Serviço de notificações — registro de tipos + cálculo dos pendentes de um
// tenant. Pensado pra crescer sem precisar de endpoint novo a cada tipo: o
// balão (GET /api/notificacoes, routes/notificacoes.js) e a tela
// Configurações > Notificações (GET/PATCH /api/configuracao, campo
// notificacoes_ativas) leem esta lista, não um tipo hard-coded.
//
// Cada tipo: `chave` (persistida em tenants.notificacoes_ativas, formato
// {"<chave>": {"ativo": bool, ...params}}, mesmo molde de formas_pagamento —
// escolhido pra caber parâmetro extra por tipo, ex.: `limiar` de
// disparos_acabando, sem precisar de coluna nova a cada notificação nova),
// `titulo` (rótulo no dropdown do balão e no toggle de Configurações) e
// `calcular(pool, tenantId, config)` -> array de itens pendentes (vazio =
// nada a notificar agora); `config` é o objeto salvo pro tenant nessa chave
// (nunca null — listarNotificacoesPendentes já normaliza pra {}).
const planosCatalogo = require('./planos');

const LIMIAR_DISPAROS_PADRAO = 10;

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
  {
    chave: 'disparos_acabando',
    titulo: 'Disparos de WhatsApp acabando',
    // Descreve o campo numérico extra pra Configurações > Notificações
    // montar o input sem precisar de endpoint próprio só pra isso.
    campoNumerico: { chave: 'limiar', label: 'Avisar quando restarem até', padrao: LIMIAR_DISPAROS_PADRAO },
    async calcular(pool, tenantId, config) {
      const { rows: tenantRows } = await pool.query('SELECT plano FROM tenants WHERE id = $1', [tenantId]);
      const plano = tenantRows[0] && planosCatalogo.obterPlano(tenantRows[0].plano);
      // Plano sem limite (a maioria hoje) nunca "acaba" — mesmo critério de
      // limiteDoPlanoExcedido (lib/automacoes.js).
      if (!plano || plano.limite_disparos == null) return [];

      const { rows } = await pool.query(
        `SELECT count(*)::int AS total FROM whatsapp_disparos
         WHERE tenant_id = $1 AND status = 'enviado' AND criado_em >= date_trunc('month', now())`,
        [tenantId]
      );
      const usados = rows[0].total;
      const restante = plano.limite_disparos - usados;
      const limiarConfigurado = Number(config && config.limiar);
      const limiar = limiarConfigurado > 0 ? limiarConfigurado : LIMIAR_DISPAROS_PADRAO;
      if (restante > limiar) return [];

      return [{
        id: tenantId,
        titulo: `Restam ${Math.max(restante, 0)} disparo(s) de WhatsApp este mês`,
        detalhe: `${usados} de ${plano.limite_disparos} usados`,
      }];
    },
  },
];

// Chave ausente em `notificacoesAtivas` conta como ativa (default seguro) —
// só `ativo: false` explícito desliga. Tipos sem nenhum item pendente não
// entram no resultado (o balão/dropdown não precisam saber distinguir "0
// itens" de "tipo nem existe").
async function listarNotificacoesPendentes(pool, tenantId, notificacoesAtivas) {
  const todasConfigs = notificacoesAtivas || {};
  const resultado = [];
  for (const tipo of TIPOS_NOTIFICACAO) {
    const config = todasConfigs[tipo.chave] || {};
    if (config.ativo === false) continue;
    const itens = await tipo.calcular(pool, tenantId, config);
    if (itens.length) resultado.push({ tipo: tipo.chave, titulo: tipo.titulo, itens });
  }
  return resultado;
}

module.exports = { TIPOS_NOTIFICACAO, listarNotificacoesPendentes };
