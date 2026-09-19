-- Log de disparo de WhatsApp por automação (pedido do Bruno: aba no admin
-- com total de disparos, realizados e histórico com número, modelo/template,
-- data/hora e status). Diferente de `whatsapp_envios` (só timestamp, existe
-- unicamente pra sustentar a trava de 24h) — aqui é uma linha por tentativa
-- que chegou a um desfecho final, com o motivo quando bloqueada.
--
-- "Enfileirado" (fora do horário comercial) não é um desfecho final: só vira
-- uma linha aqui quando o worker da fila realmente resolve o envio
-- (enviado/erro) — assim "total de disparos" nunca conta a mesma tentativa
-- duas vezes (uma ao entrar na fila, outra ao sair dela).
create table whatsapp_disparos (
  id uuid primary key,
  tenant_id uuid not null,
  telefone_e164 text not null,
  template_nome text,
  gatilho text,
  status text not null check (status in ('enviado', 'erro', 'bloqueado_optout', 'bloqueado_24h')),
  criado_em timestamptz not null default now()
);
create index whatsapp_disparos_tenant_idx on whatsapp_disparos (tenant_id, criado_em desc);
create index whatsapp_disparos_status_idx on whatsapp_disparos (status);
