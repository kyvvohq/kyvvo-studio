-- Catálogo do módulo "Resumo" do CRM (dashboard do Painel Hoje com métricas
-- do dia + drill-down em relatório — pedido do Bruno, 2026-10-03). Ativação
-- por tenant continua manual via admin (PATCH /admin/api/tenants/:id/modulos/:moduloKey),
-- mesmo fluxo dos demais módulos (US65) — esta migration só cria a entrada
-- no catálogo. O toggle sincroniza com crm_configuracoes.resumo_ativo (banco
-- próprio do CRM) via admin-interno — ver routes/admin-tenants.js no
-- kyvvo-admin.
insert into modulos (key, nome) values
  ('crm_resumo', 'CRM — Resumo (Painel Hoje)')
on conflict (key) do nothing;
