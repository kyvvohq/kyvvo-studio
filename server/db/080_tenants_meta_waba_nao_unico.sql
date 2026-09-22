-- Achado 2026-09-22: a tela de Automações às vezes não trazia nenhum modelo
-- aprovado mesmo com templates aprovados na WABA conectada. Causa raiz: a
-- constraint UNIQUE em tenants.meta_waba_id (034) assumia 1 WABA própria por
-- tenant (self-service via Embedded Signup) — mas o fluxo de "números
-- prontos" (037) compartilha de propósito uma mesma WABA da Kyvvo entre
-- vários salões (um número por tenant, mesma WABA). Quando um segundo tenant
-- é vinculado a um número da mesma WABA, o UPDATE em
-- admin-numeros-prontos.js/admin-adapter.js bate na UNIQUE (23505), a
-- transação sofre ROLLBACK e meta_waba_id fica nulo pra esse tenant — sem
-- erro visível pro admin nem pro tenant, e GET
-- /api/automacoes/templates-whatsapp cai no `if (!wabaId) return {
-- templates: [], conectado }` (nenhum aviso de erro, só lista vazia).

alter table tenants drop constraint if exists tenants_meta_waba_id_key;

-- Backfill: tenants vinculados via números prontos que ficaram com
-- meta_phone_number_id preenchido mas meta_waba_id nulo por causa do
-- problema acima.
update tenants t
set meta_waba_id = np.meta_waba_id
from numeros_prontos np
where np.meta_phone_number_id = t.meta_phone_number_id
  and t.meta_waba_id is null
  and t.meta_phone_number_id is not null;
