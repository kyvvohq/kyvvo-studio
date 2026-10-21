-- Janela de encerramento (substitui o IA_GAP_NOVA_CONVERSA_MS hardcoded de
-- 2h em lib/ia-engine.js por um valor configurável por tenant, 15-480 min)
-- e retomada de atendimento (nudge proativo opcional) — mesma feature do
-- CRM (kyvvo-crm db/045), Configurações > Preferências (já chamada assim
-- no Studio, sem rename nesta tela).
alter table tenants add column ia_janela_encerramento_minutos smallint not null default 120
  check (ia_janela_encerramento_minutos between 15 and 480);

alter table tenants add column ia_retomada_ativa boolean not null default false;
alter table tenants add column ia_retomada_tentativas smallint not null default 1
  check (ia_retomada_tentativas between 1 and 3);
alter table tenants add column ia_retomada_intervalo_horas smallint not null default 1
  check (ia_retomada_intervalo_horas between 1 and 3);

-- Controle de nudge por cliente — mesmo padrão de aguardando_humano_desde
-- (067_handoff_retorno_automatico.sql): timestamp efêmero direto em
-- `clientes`, sem tabela de sessão nova. Zerado sempre que uma nova
-- mensagem role='user' é salva (ver salvarMensagemIA em lib/ia-engine.js).
alter table clientes add column ia_retomada_tentativas smallint not null default 0;
alter table clientes add column ia_retomada_ultima_em timestamptz;
