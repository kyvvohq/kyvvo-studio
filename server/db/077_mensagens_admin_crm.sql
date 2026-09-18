-- Libera 'crm' como produto valido em mensagens_admin (banner de avisos do
-- admin), acompanhando a liberacao equivalente em planos.produto
-- (kyvvo-platform#009_crm_planos) - pedido do Bruno, 2026-09-18.
alter table mensagens_admin drop constraint if exists mensagens_admin_produto_check;
alter table mensagens_admin add constraint mensagens_admin_produto_check check (produto in ('studio', 'people', 'crm'));
