-- Reverte 088_modulo_crm_resumo.sql — o card "Resumo" do CRM virou parte
-- padrão sempre ativa (pedido do Bruno, 2026-10-03: "o resumo não é um
-- módulo a ser liberado, ele será default"), não um módulo opt-in por
-- tenant via Tenants > Módulos. tenant_modulos/log_modulos_tenant têm FK
-- `on delete cascade` pra modulos(key) (migrations 010/044) — um delete só
-- na linha do catálogo já limpa qualquer toggle/log que alguém tenha
-- mexido nesse meio-tempo.
delete from modulos where key = 'crm_resumo';
