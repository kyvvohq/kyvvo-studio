-- Cadastro de Profissional ganha e-mail, telefone e chave PIX (pedido
-- explícito 2026-09-17) — pensando em repasse de comissão/pagamento e,
-- futuramente, esse profissional também logar no sistema com privilégios
-- limitados (não implementado ainda, só o dado já fica pronto). Todos
-- opcionais — nenhum agendamento/vínculo depende deles hoje.
-- `pix varchar(77)`: tamanho pedido explicitamente (cobre o maior tipo de
-- chave Pix existente, a chave e-mail, que o Bacen limita a 77 caracteres).
alter table profissionais add column if not exists email text;
alter table profissionais add column if not exists telefone text;
alter table profissionais add column if not exists pix varchar(77);
