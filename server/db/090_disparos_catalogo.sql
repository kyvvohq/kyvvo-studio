-- Catálogo de disparos padrão por produto (Bruno, 2026-10-06): "vamos criar
-- um repositório no portal do admin onde cadastramos os disparos, pra cada
-- produto". Antes disso, cada produto ia precisar de uma lista própria,
-- hardcoded no código (igual o Studio já tem em server/panel/lib/
-- automacoes.js#SEEDS) — em vez disso, fica cadastrado aqui (tela nova em
-- admin.kyvvo.com.br, WhatsApp > Catálogo de disparos) e cada produto lê de
-- lá na hora de montar a mensagem padrão + submeter o template pra Meta
-- quando um tenant conecta a própria WABA (onboarding).
--
-- `gatilho` é texto livre de propósito — o vocabulário de gatilhos é
-- diferente por produto (CRM: pedido_parado/pedido_criado/aniversario_cliente;
-- Studio: agendamento_criado/lembrete_agendamento/...) e uma única CHECK
-- listando tudo ficaria frágil a cada produto novo. `nome` é o nome do
-- template que vai pra Meta — único por produto (não por WABA; cada tenant
-- tem a própria WABA, então reaproveita o mesmo nome em todas).
create table disparos_catalogo (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto in ('studio', 'crm', 'people')),
  gatilho text not null,
  nome text not null,
  categoria text not null check (categoria in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  corpo text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (produto, nome)
);
create index disparos_catalogo_produto_idx on disparos_catalogo (produto) where ativo;
