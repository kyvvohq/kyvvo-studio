-- Kyvvo Admin (kyvvo-admin) ganha uma tela de Administradores — hoje não dá
-- pra revogar acesso de ninguém sem mexer direto no banco (kyvvo_admins não
-- tinha nem uma coluna de status). "Desativar" é sempre soft, mesmo padrão
-- de tenants/usuarios (020_admin_kyvvo.sql, 003_usuarios.sql) — nunca deleta
-- uma conta com histórico de auditoria/ações.

alter table kyvvo_admins add column ativo boolean not null default true;
