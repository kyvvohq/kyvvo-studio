-- Novo status 'a_confirmar' (amarelo) — estágio entre a criação do
-- atendimento e o cliente confirmar de fato pelo WhatsApp (botão
-- "Confirmar" na Confirmação de agenda). Funcionalmente equivalente a
-- 'confirmado' em todo lugar que hoje trata 'confirmado' como "ocupa
-- horário/é um atendimento válido" (disponibilidade, relatórios,
-- reagendar/cancelar pelo bot) — só muda a cor/rótulo na tela e dispara a
-- notificação de "agenda_confirmada" quando o cliente confirma de verdade.
alter table agendamentos drop constraint if exists agendamentos_status_check;
alter table agendamentos add constraint agendamentos_status_check
  check (status in ('a_confirmar', 'confirmado', 'cancelado', 'reagendado', 'concluido', 'falta'));

alter table agendamentos alter column status set default 'a_confirmar';

drop index if exists idx_agendamentos_profissional_data;
create index idx_agendamentos_profissional_data on agendamentos (profissional_id, data_hora)
  where status in ('confirmado', 'a_confirmar');
