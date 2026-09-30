-- Duas melhorias no serviço de notificações (achado real de uso, 2026-09-30):
--
-- 1) "Marcar como lida" — o balão (sino) sempre listava TODO evento dos
--    últimos 7 dias, sem jeito de tirar um item de lá depois de já ter visto.
--    `lida`/`lida_em` deixam isso possível; GET /api/notificacoes passa a só
--    listar as não lidas (comportamento de "pendentes" de verdade agora).
--
-- 2) "Abrir na data certa" — clicar num evento de agenda (criada/confirmada/
--    remarcada) sempre abria a Agenda no dia de HOJE, nunca no dia do
--    atendimento em si. `referencia_data_hora` guarda o data_hora do
--    agendamento no momento do evento, pro frontend navegar direto pra lá.
alter table notificacoes_eventos add column lida boolean not null default false;
alter table notificacoes_eventos add column lida_em timestamptz;
alter table notificacoes_eventos add column referencia_data_hora timestamptz;

create index idx_notificacoes_eventos_tenant_pendentes on notificacoes_eventos (tenant_id, chave, criado_em desc) where lida = false;
