-- Limiar de "cliente novo" configurável por tenant (Preferências, painel do
-- salão) — antes era um número fixo de 30 dias, cravado direto em SQL (ver
-- CLIENTE_STATUS_SQL em routes/clientes.js). Mesmo padrão de
-- 065_tenants_cliente_inativo_dias.sql; 30 continua sendo o default pra
-- quem nunca mexeu na tela.
alter table tenants add column if not exists cliente_novo_dias integer not null default 30;
alter table tenants add constraint tenants_cliente_novo_dias_check check (cliente_novo_dias between 1 and 365);
