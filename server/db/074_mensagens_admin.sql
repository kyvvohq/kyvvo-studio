-- Mensagens/avisos que um admin da Kyvvo publica pros usuários finais dos
-- produtos — banner no topo do painel. Pedido do Bruno: "Podemos ter uma
-- mensagem de uma nova funcionalidade para People e não pode aparecer para
-- Studio" (produto específico) + "mensagens gerais para kyvvo inteira que
-- deve apresentar para todos os produtos. Ex: Estamos com instabilidade no
-- processo de pagamento" (produto null = todos).
--
-- severidade decide o estilo do banner (info azul / aviso amarelo / erro
-- vermelho, mesmo espectro dos badge-status-* já usados no admin).
-- expira_em é opcional — um aviso de instabilidade tende a ter prazo, um
-- anúncio de funcionalidade nova pode não ter (fica até alguém desativar).

create table mensagens_admin (
  id uuid primary key default gen_random_uuid(),
  produto text check (produto in ('studio', 'people')), -- null = todos os produtos
  texto text not null,
  severidade text not null default 'info' check (severidade in ('info', 'aviso', 'erro')),
  ativo boolean not null default true,
  expira_em timestamptz,
  criado_por uuid references kyvvo_admins(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índice parcial: a query de leitura pública (GET /api/mensagens?produto=X,
-- chamada por Studio/People a cada carregamento de painel) só olha linhas
-- ativas — não vale indexar as inativas/históricas.
create index idx_mensagens_admin_ativas on mensagens_admin (produto) where ativo;
