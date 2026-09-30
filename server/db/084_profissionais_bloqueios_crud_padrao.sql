-- CRUD padrao (Editar/Desativar/Excluir) para Profissionais e Bloqueio de
-- agenda, mesmo padrao ja usado em Servicos (US17/PR4).
--
-- Profissionais: "Excluir" passa a ser soft delete (excluido_em), nao mais
-- um DELETE de verdade -- profissional_id tem ON DELETE CASCADE em
-- agendamentos (001_init.sql), entao um hard delete apagaria o historico de
-- agendamentos antigos desse profissional (mesmo bug ja corrigido em
-- Servicos, 031_servicos_ativo_exclusao.sql). "Desativar" e um campo novo
-- (ativo), independente da exclusao.
alter table profissionais add column ativo boolean not null default true;
alter table profissionais add column excluido_em timestamptz;

-- Bloqueio de agenda: "Desativar" permite suspender um bloqueio manual
-- temporariamente (ex.: periodo de ferias que a pessoa quer reativar depois)
-- sem perder as datas configuradas -- so bloqueios ativos devem contar pra
-- checagem de conflito em POST /api/bloqueios e pra Agenda considerar o
-- horario como indisponivel.
alter table bloqueios_agenda add column ativo boolean not null default true;
