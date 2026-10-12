-- CRM também editável em Produtos > CRM > Configurações (admin), igual
-- Studio/People desde 073_configuracoes_sistema_por_produto.sql — mas aquela
-- migration só previu 'studio'/'people' no CHECK, então qualquer PATCH
-- /api/configuracoes/crm/sistema (kyvvo-admin) dava 500: a Postgres rejeita
-- o insert com violação do CHECK antes mesmo de chegar no ON CONFLICT.
-- Bug real em produção (2026-10-12, "dias de carência" no CRM).
--
-- Mesmo padrão da 073: duplica as linhas de 'studio' pra 'crm' (ponto de
-- partida com os valores de hoje; diverge daqui pra frente pela tela do
-- admin), DEPOIS troca o CHECK pra incluir 'crm' — senão o insert de
-- duplicação também seria rejeitado pelo CHECK antigo.

alter table configuracoes_sistema drop constraint configuracoes_sistema_produto_check;
alter table configuracoes_sistema add constraint configuracoes_sistema_produto_check check (produto in ('studio', 'people', 'crm'));

insert into configuracoes_sistema (chave, valor, produto)
  select chave, valor, 'crm' from configuracoes_sistema where produto = 'studio'
  on conflict (chave, produto) do nothing;
