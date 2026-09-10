-- Automações do Studio: mensagens de WhatsApp disparadas por gatilho de
-- agendamento (eventos) ou por tempo (worker de 5 min). Tenant-wide — uma
-- automação por gatilho, vale pra todo o salão. Espelha o motor do
-- kyvvo-people (lib/automacoes.js), adaptado ao contexto de agendamento.
--
-- gatilhos de evento (routes/agenda.js chama dispararAutomacoes):
--   agendamento_criado      -- POST /api/agendamentos (só o agendamento âncora, não cada ocorrência de recorrência)
--   agendamento_cancelado   -- PATCH .../:id status -> cancelado
--   agendamento_concluido   -- PATCH .../:id status -> concluido
--   agendamento_falta       -- PATCH .../:id status -> falta (no-show)
--   agendamento_reagendado  -- PATCH .../:id status -> reagendado
-- gatilhos de tempo (worker: processarLembretes/Aniversarios/Inativos):
--   lembrete_agendamento    -- lembrete_horas_antes horas antes do data_hora
--   aniversario_cliente     -- no dia do aniversário (clientes.data_nascimento)
--   cliente_inativo         -- sem agendamento há tenants.cliente_inativo_dias dias
--
-- removivel=false trava ativo/exclusão em código (nenhuma nasce assim no v1;
-- a coluna fica pro mesmo padrão do People). O texto que o cliente recebe é
-- o do template aprovado na Meta (whatsapp_template) — `corpo` é só
-- preview/referência editável na tela.
create table automacoes (
  id uuid primary key,
  tenant_id uuid not null,
  gatilho text not null check (gatilho in (
    'agendamento_criado', 'agendamento_cancelado', 'agendamento_concluido',
    'agendamento_falta', 'agendamento_reagendado',
    'lembrete_agendamento', 'aniversario_cliente', 'cliente_inativo'
  )),
  canal text not null default 'whatsapp' check (canal in ('whatsapp')),
  nome text not null,
  ativo boolean not null default true,
  removivel boolean not null default true,
  corpo text not null,
  whatsapp_template text,
  lembrete_horas_antes integer,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint automacoes_lembrete_horas check (
    (gatilho = 'lembrete_agendamento' and lembrete_horas_antes is not null and lembrete_horas_antes between 1 and 168) or
    (gatilho <> 'lembrete_agendamento' and lembrete_horas_antes is null)
  )
);
create index automacoes_tenant_gatilho_idx on automacoes (tenant_id, gatilho);
