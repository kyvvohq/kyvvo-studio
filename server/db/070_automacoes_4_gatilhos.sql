-- Reduz o conjunto de gatilhos de automação de 8 para 4 (decisão do Bruno,
-- 2026-09-10): Confirmação de agenda (agendamento_criado), Feedback do
-- serviço (agendamento_concluido), Aniversário do cliente (aniversario_cliente)
-- e Clientes inativos (cliente_inativo). Saem: agendamento_cancelado,
-- agendamento_falta, agendamento_reagendado e lembrete_agendamento.
--
-- Com o lembrete fora, a coluna lembrete_horas_antes e o CHECK que a
-- amarrava deixam de fazer sentido — são removidos.

-- Apaga as automações dos gatilhos que saíram (automacao_disparos cai por
-- ON DELETE CASCADE — ver 069).
delete from automacoes
where gatilho in ('agendamento_cancelado', 'agendamento_falta',
                  'agendamento_reagendado', 'lembrete_agendamento');

alter table automacoes drop constraint if exists automacoes_lembrete_horas;
alter table automacoes drop column if exists lembrete_horas_antes;

-- CHECK inline da 068 tem nome automático automacoes_gatilho_check.
alter table automacoes drop constraint if exists automacoes_gatilho_check;
alter table automacoes add constraint automacoes_gatilho_check check (gatilho in (
  'agendamento_criado', 'agendamento_concluido',
  'aniversario_cliente', 'cliente_inativo'
));
