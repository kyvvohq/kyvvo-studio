-- Acesso de profissional (não-admin): login sem senha, só via convite por
-- e-mail + clique no link + sessão longa (90 dias). Papel novo, separado de
-- 'operador' (que continua com acesso operacional amplo, sem financeiro) —
-- 'profissional' só enxerga a própria agenda e um financeiro CALCULADO
-- (preço do serviço × atendimentos concluídos dele), nunca lancamentos_
-- financeiros (livro-caixa manual, sem ligação com profissional/agendamento).
--
-- senha_hash vira opcional: contas 'profissional' nunca têm senha — reforçado
-- em POST /api/auth/login (guarda explícita antes do bcrypt.compare).
alter table usuarios alter column senha_hash drop not null;

-- Um login por profissional (evita duas contas controlando a "mesma" agenda).
-- on delete cascade: excluir o profissional (tela de Profissionais) também
-- remove o login vinculado — mesmo espírito de agendamentos.profissional_id.
alter table usuarios add column if not exists profissional_id uuid references profissionais(id) on delete cascade;
create unique index if not exists uq_usuarios_profissional on usuarios (profissional_id) where profissional_id is not null;

alter table usuarios drop constraint if exists usuarios_role_check;
alter table usuarios add constraint usuarios_role_check
  check (role in ('administrador', 'operador', 'profissional'));

alter table convites_equipe add column if not exists profissional_id uuid references profissionais(id) on delete cascade;
alter table convites_equipe drop constraint if exists convites_equipe_role_check;
alter table convites_equipe add constraint convites_equipe_role_check
  check (role in ('administrador', 'operador', 'profissional'));

-- Sessão de 90 dias, token opaco (não-JWT) — mecanismo PARALELO ao RS256 do
-- kyvvo-platform, só pra este papel (que nunca precisa de SSO com outros
-- produtos Kyvvo). token_hash (sha256), nunca o token em texto puro: é um
-- bearer que trafega em toda request, diferente do token de convite (uso
-- único, consumido no aceite) — vazar esta tabela não deve expor sessões
-- ativas utilizáveis.
create table sessoes_profissional (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz
);
create index idx_sessoes_profissional_usuario on sessoes_profissional (usuario_id) where revogado_em is null;
