-- Pedido direto do Bruno (2026-10-23): manter o selo "Mais Popular" só no
-- Smart, tirar do Smart Plus (chave='enterprise', ver 047_planos_eixo_valor
-- — nome/slug "Smart Plus" desde então). Ajuste pontual via admin ficava sem
-- efeito antes da correção do COALESCE em routes/admin-configuracoes.js
-- (PATCH não conseguia limpar `badge`, só `destaque`) — já corrigida; este
-- UPDATE só reflete o pedido no dado atual, não muda nenhuma regra de
-- código.
update planos set badge = null where chave = 'enterprise';
