-- US16c — acesso temporário de um usuário de OUTRO tenant, só pra
-- documentação/auditoria no admin (pedido do Bruno, 2026-10-13: validar
-- informações pontuais sem mexer em login/autenticação de verdade). Não
-- cria sessão nem token nenhum — é só um registro visível na tela de
-- detalhe do tenant (quem, desde quando, até quando, por quê, concedido
-- por quem), pra quando o acesso real acontece por outro canal (senha
-- compartilhada, suporte logando manualmente etc.) e precisa ficar
-- rastreado. usuario_id aponta pro usuário de verdade (noutro tenant) —
-- não duplica conta nem mexe em usuarios.tenant_id, que continua intocado.
create table tenant_acessos_temporarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  motivo text not null,
  concedido_por uuid references kyvvo_admins(id) on delete set null,
  concedido_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid references kyvvo_admins(id) on delete set null
);

create index idx_tenant_acessos_temporarios_tenant on tenant_acessos_temporarios (tenant_id);
create index idx_tenant_acessos_temporarios_usuario on tenant_acessos_temporarios (usuario_id);

-- Só um acesso "ainda não revogado" por par tenant/usuário — reconceder
-- depois de expirado precisa revogar o antigo primeiro (a aplicação cuida
-- disso), evita duas linhas competindo pra descrever o mesmo acesso.
create unique index uq_acesso_temporario_ativo on tenant_acessos_temporarios (tenant_id, usuario_id) where revogado_em is null;
