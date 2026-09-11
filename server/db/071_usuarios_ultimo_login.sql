-- Kyvvo Admin (kyvvo-admin) precisa mostrar "último login" na tela de
-- Usuários — hoje só existe `criado_em` (data de cadastro). Quem grava essa
-- coluna é o POST /api/auth/login do kyvvo-platform (autoridade de auth desde
-- o corte P3; é o endpoint que nginx roteia de fato em produção).

alter table usuarios add column ultimo_login_em timestamptz;
