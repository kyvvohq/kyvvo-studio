-- Preferências > Formas de pagamento (pedido do Bruno, 2026-09-23): cada
-- tenant configura quais formas aceita e a taxa (%) que a maquininha/gateway
-- cobra em cada uma — usado pra calcular o valor líquido de um atendimento
-- ao confirmar o pagamento (ver lib/financeiro.js:sincronizarLancamentoFinanceiro).
-- Formato: {"<chave>": {"ativo": bool, "taxa": number|null}, ...}, chaves
-- possíveis: credito_avista, credito_prazo, debito, pix, dinheiro (dinheiro
-- nunca tem taxa — sem desconto de intermediário). Default '{}' = tenant
-- ainda não configurou nada; nesse caso a tela de "Confirmar pagamento"
-- continua mostrando as 4 opções antigas (pix/cartão/dinheiro/outro) sem
-- cálculo de taxa, exatamente como já era antes desta migration.
alter table tenants add column formas_pagamento jsonb not null default '{}'::jsonb;

-- Valor líquido calculado no momento da confirmação de pagamento (preço do
-- serviço menos a taxa da forma de pagamento usada) — null quando o tenant
-- não configurou taxa pra essa forma (comportamento antigo: sem desconto).
-- `valor` continua sendo o valor bruto/cobrado do cliente, usado nos
-- resumos de receita já existentes — valor_liquido é informativo, adicional.
alter table lancamentos_financeiros add column valor_liquido numeric;

-- Expande o CHECK de forma_pagamento (035/055) pras novas chaves — mantém
-- as antigas (pix/cartao/dinheiro/outro) pra não quebrar lançamentos já
-- gravados nem tenants que ainda não configuraram as novas formas.
alter table lancamentos_financeiros drop constraint if exists lancamentos_financeiros_forma_pagamento_check;
alter table lancamentos_financeiros add constraint lancamentos_financeiros_forma_pagamento_check
  check (forma_pagamento is null or forma_pagamento in (
    'pix', 'cartao', 'dinheiro', 'outro', 'credito_avista', 'credito_prazo', 'debito'
  ));
