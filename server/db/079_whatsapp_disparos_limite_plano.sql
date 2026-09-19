-- Adiciona o status 'bloqueado_limite_plano' ao log de disparos (US WhatsApp
-- > Disparos, pedido do Bruno 2026-09-19: o limite de disparos do plano
-- (planos.limite_disparos) existia só como texto de marketing na página
-- pública — agora é aplicado de verdade em enviarOuEnfileirar/processarFila).
alter table whatsapp_disparos drop constraint if exists whatsapp_disparos_status_check;
alter table whatsapp_disparos add constraint whatsapp_disparos_status_check
  check (status in ('enviado', 'erro', 'bloqueado_optout', 'bloqueado_24h', 'bloqueado_limite_plano'));
