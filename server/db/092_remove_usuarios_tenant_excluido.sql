-- Limpeza pedida pelo Bruno (2026-10-12): usuarios.tenant_id é NOT NULL com
-- FK ON DELETE CASCADE pra tenants(id) (003_usuarios.sql) — não existe (nem
-- pode existir) usuário sem tenant no sentido literal. O que existe são
-- usuários cujo tenant foi excluído (soft delete, "Excluir tenant" no
-- admin seta tenants.excluido_em) — esses tenants somem de toda
-- listagem/busca do admin (WHERE excluido_em IS NULL), mas os usuários
-- continuam no banco, inalcançáveis por qualquer tela.
--
-- Backup antes de apagar de vez (DELETE é irreversível e isto mexe em
-- contas de login reais) — em caso de engano, os dados voltam com
-- `insert into usuarios select * from usuarios_orfaos_202610`.
create table if not exists usuarios_orfaos_202610 as
  select u.* from usuarios u
  join tenants t on t.id = u.tenant_id
  where t.excluido_em is not null;

delete from usuarios u
  using tenants t
  where t.id = u.tenant_id and t.excluido_em is not null;

-- Contagem vai pro log do deploy (aplicar-migrations.js imprime stdout de
-- cada migration) — única forma de confirmar o tamanho da limpeza sem
-- acesso direto ao Postgres de produção.
do $$
declare
  total int;
begin
  select count(*) into total from usuarios_orfaos_202610;
  raise notice 'usuarios_orfaos_202610: % usuário(s) de tenant excluído removido(s)', total;
end $$;
