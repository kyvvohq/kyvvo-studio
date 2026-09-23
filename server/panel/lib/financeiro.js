// Sincronização do lançamento financeiro vinculado a um agendamento —
// extraído de index.js (fase 1 da modularização). Não precisa de
// `init(pool)`: já recebe `client` (pool ou client de transação já aberto
// pelo chamador) como argumento explícito.

// Preferências > Formas de pagamento (tenants.formas_pagamento, migration
// 082) — chaves válidas e quais nunca têm taxa (dinheiro: sem desconto de
// intermediário). Usado tanto na validação do PATCH /api/configuracao
// quanto no cálculo do valor líquido abaixo.
const FORMAS_PAGAMENTO_CHAVES = ['credito_avista', 'credito_prazo', 'debito', 'pix', 'dinheiro'];
const FORMAS_PAGAMENTO_SEM_TAXA = ['dinheiro'];

// US64 — cria/atualiza o lançamento financeiro vinculado a um agendamento
// com serviço pago (CA "Cenário 1/3/4/5/6/7"). `client` pode ser o pool do
// módulo ou um client de transação já aberto pelo chamador — POST/PATCH
// /api/agendamentos precisam que a mudança no agendamento e no financeiro
// aconteçam atomicamente, senão um crash no meio deixaria os dois lados
// inconsistentes.
//
// Sempre um UPDATE em cima do lançamento existente do agendamento (nunca um
// segundo INSERT): o ON CONFLICT usa o índice único uq_lancamentos_agendamento,
// que também garante isso numa corrida (CA "Cenário 7", evitar duplicidade).
async function sincronizarLancamentoFinanceiro(client, {
  tenantId, agendamentoId, servicoNome, servicoPreco, dataHora, statusAgendamento, formaPagamento,
}) {
  // Serviço sem preço (ou preço zero) nunca gera lançamento automático (CA
  // "Cenário 2") — nem na criação nem numa atualização: hoje não existe
  // jeito de mudar o serviço/preço de um agendamento já criado (servico_id é
  // fixo, e servicos.preco não tem endpoint de edição), então um agendamento
  // que nasceu sem lançamento nunca precisa ganhar um depois.
  const preco = servicoPreco != null ? Number(servicoPreco) : 0;
  if (!(preco > 0)) return;

  // 'reagendado' nunca é de fato setado por nenhum código hoje (reagendar só
  // muda data_hora no mesmo registro) — trata como 'confirmado' por
  // segurança, caso isso mude no futuro. 'falta' (no-show) mapeia pro mesmo
  // 'cancelado' que uma cancelação de verdade — financeiramente o efeito é
  // igual (a receita prevista não acontece) — mas o status do AGENDAMENTO em
  // si continua 'falta', distinto de 'cancelado', pro Relatórios conseguir
  // medir taxa de comparecimento e faturamento perdido por no-show à parte.
  const statusFinanceiro = statusAgendamento === 'concluido'
    ? 'realizado'
    : (statusAgendamento === 'cancelado' || statusAgendamento === 'falta')
      ? 'cancelado'
      : 'previsto';

  // formaPagamento só chega preenchida em "Confirmar pagamento" (US, menu
  // Financeiro) — as outras chamadas (criar/reagendar/cancelar agendamento)
  // não sabem a forma de pagamento e não podem apagar a que já foi
  // registrada, por isso o COALESCE no UPDATE mantém o valor existente
  // quando formaPagamento vem null.
  //
  // Valor líquido (pedido do Bruno, 2026-09-23): só calculado quando
  // formaPagamento vem preenchida (ou seja, só em "Confirmar pagamento") —
  // as chaves novas (credito_avista/credito_prazo/debito/pix) podem ter uma
  // taxa (%) configurada em Preferências; dinheiro nunca tem. Tenant que
  // ainda não configurou nada (formas_pagamento = '{}', ou a chave
  // específica ausente/inativa) cai no `taxa == null` → valorLiquido = preco,
  // idêntico ao comportamento de antes desta feature existir.
  let valorLiquido = null;
  if (formaPagamento) {
    const { rows: tRows } = await client.query('SELECT formas_pagamento FROM tenants WHERE id = $1', [tenantId]);
    const cfg = tRows[0] && tRows[0].formas_pagamento && tRows[0].formas_pagamento[formaPagamento];
    const taxa = cfg && cfg.ativo && cfg.taxa != null ? Number(cfg.taxa) : null;
    valorLiquido = taxa != null ? Math.round(preco * (1 - taxa / 100) * 100) / 100 : preco;
  }

  await client.query(
    `INSERT INTO lancamentos_financeiros (tenant_id, agendamento_id, tipo, valor, valor_liquido, descricao, data, status, forma_pagamento)
     VALUES ($1, $2, 'entrada', $3, $4, $5, ($6::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, $7, $8)
     ON CONFLICT (agendamento_id) WHERE agendamento_id IS NOT NULL
     DO UPDATE SET valor = EXCLUDED.valor, data = EXCLUDED.data, status = EXCLUDED.status, descricao = EXCLUDED.descricao,
                    forma_pagamento = COALESCE(EXCLUDED.forma_pagamento, lancamentos_financeiros.forma_pagamento),
                    valor_liquido = COALESCE(EXCLUDED.valor_liquido, lancamentos_financeiros.valor_liquido)`,
    [tenantId, agendamentoId, preco, valorLiquido, servicoNome, dataHora, statusFinanceiro, formaPagamento || null]
  );
}

module.exports = { sincronizarLancamentoFinanceiro, FORMAS_PAGAMENTO_CHAVES, FORMAS_PAGAMENTO_SEM_TAXA };
