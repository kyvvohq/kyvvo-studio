-- As 4 travas de disparo de WhatsApp das automações (mesmo desenho do
-- kyvvo-people, db/020 + db/021): anti-spam de 24h, fila de fora-do-horário,
-- opt-out por cliente, e dedupe dos gatilhos por tempo (o worker roda a cada
-- 5 min e não pode repetir a mesma mensagem).

-- Trava de 24h: uma linha por envio REAL (não por tentativa bloqueada).
-- Consulta: existe envio pro telefone nas últimas 24h? (cruza todas as
-- automações — passar por vários status no mesmo dia não vira spam).
create table whatsapp_envios (
  id uuid primary key,
  tenant_id uuid not null,
  telefone_e164 text not null,
  enviado_em timestamptz not null default now()
);
create index whatsapp_envios_telefone_idx on whatsapp_envios (telefone_e164, enviado_em desc);

-- Fila: fora do horário comercial (config por produto no kyvvo-admin, lida
-- via GET /api/configuracoes/whatsapp-horario) o disparo entra aqui e sai
-- quando o horário abrir. O worker (server/panel/index.js) processa em lotes.
create table whatsapp_fila (
  id uuid primary key,
  tenant_id uuid not null,
  telefone_e164 text not null,
  template_nome text not null,
  parametros_corpo jsonb not null,
  parametro_botao text,
  criado_em timestamptz not null default now(),
  processado_em timestamptz
);
create index whatsapp_fila_pendentes_idx on whatsapp_fila (criado_em) where processado_em is null;

-- Opt-out: cliente que respondeu pedindo pra não receber mais (detecção
-- automática por palavra-chave no webhook-whatsapp.js). No Studio cada tenant
-- tem seu próprio número Meta, então o opt-out já é naturalmente por tenant
-- (a coluna fica no cliente, que é por tenant).
alter table clientes add column whatsapp_opt_out boolean not null default false;
alter table clientes add column whatsapp_opt_out_em timestamptz;

-- Dedupe dos gatilhos por tempo. chave:
--   lembrete_agendamento -> agendamento_id
--   aniversario_cliente  -> cliente_id || '-' || ano
--   cliente_inativo      -> cliente_id || '-' || aaaamm
create table automacao_disparos (
  automacao_id uuid not null references automacoes(id) on delete cascade,
  chave text not null,
  disparado_em timestamptz not null default now(),
  primary key (automacao_id, chave)
);
