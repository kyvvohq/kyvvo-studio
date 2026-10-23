-- Notificação push no navegador (Web Push/VAPID) — 4º canal de
-- Configurações > Notificações > Regras, ao lado de Studio/E-mail/WhatsApp
-- (lib/notificacoes.js#canaisAtivos). Uma assinatura por navegador/dispositivo
-- que o usuário autorizou (não por tenant: o mesmo usuário logado em dois
-- computadores recebe nos dois; endpoint é único por assinatura do browser,
-- por isso o UNIQUE + ON CONFLICT no INSERT de routes/push.js).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index idx_push_subscriptions_tenant on push_subscriptions (tenant_id);
