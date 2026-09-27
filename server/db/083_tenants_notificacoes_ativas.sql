-- Serviço de notificações (balão no topo, Configurações > Notificações):
-- cada tenant liga/desliga quais tipos quer receber. Formato:
-- {"<chave>": bool, ...} — chave AUSENTE conta como ativa (default seguro:
-- notificação nova entra ligada sem precisar de backfill em todo tenant
-- existente); só uma chave explicitamente `false` desliga aquele tipo.
-- Chaves válidas ficam no registro de código (lib/notificacoes.js), não
-- num CHECK aqui — mesmo padrão livre de formas_pagamento (082).
alter table tenants add column notificacoes_ativas jsonb not null default '{}'::jsonb;
