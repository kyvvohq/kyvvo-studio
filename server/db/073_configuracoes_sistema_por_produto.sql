-- Configurações gerais viram por produto — Bruno: "People deve ter suas
-- configurações apartada de Studio, são públicos diferentes". Nenhuma chave
-- de configuracoes_sistema é genuinamente "geral" pra Kyvvo inteira hoje
-- (trial/carência/suporte/horário comercial — tudo faz sentido divergir
-- por produto); o conceito de aviso pra Kyvvo inteira é escopo da tabela
-- nova em 074_mensagens_admin.sql, não deste.
--
-- Duplica cada linha existente pra 'people' ANTES de trocar a PK (senão
-- perde o dado) — ponto de partida com os MESMOS valores de hoje; Bruno
-- diverge cada produto daqui pra frente pela tela nova do admin.
--
-- Todo leitor direto desta tabela (kyvvo-studio/server/panel/lib/
-- configuracoes-sistema.js, kyvvo-platform/lib/configuracoes-sistema.js,
-- kyvvo-admin/lib/configuracoes-sistema.js) precisa filtrar por produto a
-- partir de agora — sem isso, `SELECT chave, valor FROM
-- configuracoes_sistema` sem WHERE devolve 2 linhas por chave e
-- Object.fromEntries silenciosamente fica com a que vier por último.

alter table configuracoes_sistema add column produto text not null default 'studio';
alter table configuracoes_sistema add constraint configuracoes_sistema_produto_check check (produto in ('studio', 'people'));

insert into configuracoes_sistema (chave, valor, produto)
  select chave, valor, 'people' from configuracoes_sistema where produto = 'studio';

alter table configuracoes_sistema drop constraint configuracoes_sistema_pkey;
alter table configuracoes_sistema add primary key (chave, produto);
