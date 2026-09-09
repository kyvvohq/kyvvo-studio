-- Fase 3 do plano de travas de WhatsApp do People (2026-09-09): horário
-- comercial pra disparo de WhatsApp, config por produto (não por tenant),
-- editável pelo admin sem deploy — mesmo mecanismo de configuracoes_sistema
-- já usado por trial_dias etc. (029_configuracoes_sistema.sql). Lido pelo
-- kyvvo-people via GET /api/configuracoes/whatsapp-horario (kyvvo-admin,
-- rota pública — não é dado sensível).
--
-- Horário em HH:MM (hora local de Brasília, fixo — o servidor roda em UTC,
-- quem lê que converte). Dias úteis: dígitos ISO (1=segunda ... 7=domingo),
-- separados por vírgula.
insert into configuracoes_sistema (chave, valor) values
  ('whatsapp_horario_inicio', '09:00'),
  ('whatsapp_horario_fim', '18:00'),
  ('whatsapp_dias_uteis', '1,2,3,4,5')
on conflict (chave) do nothing;
