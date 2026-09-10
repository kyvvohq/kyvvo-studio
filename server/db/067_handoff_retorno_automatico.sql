-- Retorno automático de handoff — uma conversa que entra em
-- 'aguardando_humano' e o salão não retoma dentro de N horas (config
-- whatsapp_handoff_retorno_horas, 2h por padrão) volta sozinha pro
-- atendimento por IA. Sem esse retorno, um handoff esquecido trava a
-- conversa pra sempre (a IA nunca mais responde aquele cliente) e ninguém
-- percebe — bug real encontrado em produção 2026-09-10.

alter table clientes add column if not exists aguardando_humano_desde timestamptz;
alter table clientes add column if not exists handoff_devolvido_em timestamptz;

-- Backfill: quem já está em 'aguardando_humano' agora não tem o timestamp
-- de início — sem ele o worker não consegue calcular "há mais de N horas".
-- Assume "desde agora" (conservador: dá o prazo cheio a partir da migration,
-- em vez de devolver todo mundo de uma vez no primeiro ciclo).
update clientes set aguardando_humano_desde = now()
where status_conversa = 'aguardando_humano' and aguardando_humano_desde is null;

-- Índice do worker: varre só quem está aguardando, pelo horário de entrada.
create index if not exists idx_clientes_aguardando_humano_desde
  on clientes (aguardando_humano_desde)
  where status_conversa = 'aguardando_humano';

-- Config editável pelo admin da Kyvvo sem deploy (mesma tabela/rota das
-- outras chaves de configuracoes_sistema).
insert into configuracoes_sistema (chave, valor)
values ('whatsapp_handoff_retorno_horas', '2')
on conflict (chave) do nothing;
