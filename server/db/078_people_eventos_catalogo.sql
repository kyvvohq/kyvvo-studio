-- Handoff v2 (People), Parte 5.2 — catálogo de eventos obrigatórios do
-- Kyvvo People, governado pelo admin Kyvvo (não pelo recrutador). Vive no
-- banco compartilhado do admin (não no Postgres isolado do kyvvo-people)
-- porque é o admin, não o People, quem escreve aqui — mesmo padrão já
-- usado por mensagens_admin/configuracoes_sistema (kyvvo-admin lê/escreve
-- direto; o People, que tem banco físico separado, só consome via API
-- pública: GET /api/eventos-catalogo/publico em kyvvo-admin).
--
-- `codigo` usa os mesmos nomes de gatilho já existentes em
-- kyvvo-people/lib/automacoes.js (candidatura_criada, vaga_encerrada) —
-- não o nome de exemplo do documento original ("candidatura_confirmada"),
-- pra ficar consistente com o sistema real já em produção.
create table people_eventos_catalogo (
  codigo text primary key,
  etapa_gatilho text not null,
  canal text not null check (canal in ('whatsapp', 'email')),
  template_meta_nome text,
  template_status text not null default 'pendente' check (template_status in ('pendente', 'aprovado', 'rejeitado')),
  obrigatorio boolean not null default false,
  ativo boolean not null default true,
  versao integer not null default 1,
  justificativa text,
  atualizado_por uuid references kyvvo_admins(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Contrato (Parte 5.2): "o admin não pode marcar um evento como
  -- obrigatório sem template_status = aprovado" — garantia final no banco,
  -- além da validação já feita na rota (que devolve um erro 400 legível
  -- antes de chegar aqui).
  constraint eventos_catalogo_obrigatorio_exige_aprovado check (not obrigatorio or template_status = 'aprovado')
);

-- Append-only de propósito (nenhuma rota de DELETE existe pra esta tabela)
-- — toda alteração do catálogo vira uma linha aqui, com o estado antes/
-- depois completo e a justificativa que a exigiu.
create table log_eventos_catalogo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null references people_eventos_catalogo(codigo),
  acao text not null,
  estado_anterior jsonb,
  estado_novo jsonb,
  justificativa text not null,
  alterado_por uuid references kyvvo_admins(id),
  alterado_em timestamptz not null default now()
);
create index idx_log_eventos_catalogo_codigo on log_eventos_catalogo (codigo, alterado_em desc);

-- Seed dos dois eventos que já são obrigatórios em produção hoje via
-- automacoes.removivel=false (kyvvo-people #42/#44) — este catálogo só
-- formaliza o que já é verdade, não muda nenhum comportamento sozinho (o
-- People ainda não consome esta tabela — é a fundação, ver kyvvo-people#53).
--
-- candidatura_criada já tem template aprovado na Meta (3 variantes Utility
-- pt_BR: people_confirma_cadidatura_1/2/3 — o People escolhe entre elas
-- automaticamente via escolherMelhorTemplate). vaga_encerrada ainda NÃO
-- tem template submetido — por isso fica obrigatorio=false aqui (o CHECK
-- acima não permite o contrário), mesmo já sendo removivel=false do lado
-- do People. Essa divergência é esperada e documentada: o catálogo é a
-- fonte de verdade prospectiva, não retroage sobre o que já está no ar.
insert into people_eventos_catalogo
  (codigo, etapa_gatilho, canal, template_meta_nome, template_status, obrigatorio, ativo, versao, justificativa)
values
  ('candidatura_criada', 'candidatura_criada', 'whatsapp', 'people_confirma_cadidatura_1', 'aprovado', true, true, 1,
   'Seed inicial — evento já obrigatório em produção (kyvvo-people #42), template já aprovado na Meta.'),
  ('vaga_encerrada', 'vaga_encerrada', 'whatsapp', null, 'pendente', false, true, 1,
   'Seed inicial — evento já marcado como não removível pelo recrutador no kyvvo-people (#42), mas ainda sem template aprovado na Meta. Marcar obrigatorio=true aqui assim que o template for aprovado.');
