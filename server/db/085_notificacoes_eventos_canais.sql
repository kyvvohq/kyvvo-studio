-- Redesenho de Configurações > Notificações: matriz de canais
-- (Descrição/E-mail/WhatsApp/Studio) + 3 tipos novos orientados a evento
-- (agenda criada/confirmada/remarcada), além dos 2 tipos existentes que já
-- eram calculados por polling (whatsapp_aguardando_humano, disparos_acabando).
--
-- tenants.notificacoes_ativas (083) continua JSONB, sem migration de
-- formato: o formato novo por chave é {"canais": {"studio","email",
-- "whatsapp"}, ...params}, e o código (lib/notificacoes.js) trata o formato
-- antigo ({"ativo": bool}, sem canal explícito) como "só Studio ligado",
-- que é exatamente o que sempre foi até aqui.
--
-- notificacoes_eventos: log dos tipos orientados a evento (não há "estado
-- atual" pra recalcular via polling como nos 2 tipos antigos — um "novo
-- agendamento" é um fato pontual, não uma condição permanente). O sino lista
-- os últimos eventos de cada tipo; sem coluna de "lida" de propósito (mesmo
-- nível de simplicidade dos 2 tipos existentes, que também não têm).
create table notificacoes_eventos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  chave text not null,
  titulo text not null,
  detalhe text,
  criado_em timestamptz not null default now()
);

create index idx_notificacoes_eventos_tenant_chave on notificacoes_eventos (tenant_id, chave, criado_em desc);
