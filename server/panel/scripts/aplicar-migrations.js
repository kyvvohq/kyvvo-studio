#!/usr/bin/env node
// Aplica as migrations pendentes de server/db/*.sql. Dois chamadores:
//   - gate.yml (verificar): contra o Postgres descartável do CI, do zero.
//   - deploy.yml (deploy-panel), via `docker compose run --rm studio node
//     scripts/aplicar-migrations.js`: contra o Postgres de produção, ANTES
//     de recriar o container — assim o container novo (código novo) já sobe
//     com o schema que ele espera. Se a migration falhar, o script sai com
//     código != 0 e (com `set -e` no script do deploy) o `docker compose up
//     -d --force-recreate studio` seguinte NUNCA roda — não sobe código novo
//     contra schema velho/quebrado.
//
// Motivo de existir (2026-09-10): até aqui, migrations de server/db/ eram
// aplicadas manualmente na EC2 depois de cada deploy — o deploy em si só
// copiava código e reiniciava o container, nunca tocava o Postgres. As
// migrations 068/069/070 ficaram pra trás por 2h+ em produção (a tela de
// Automações inteira devolvia 500 "relation automacoes does not exist")
// porque ninguém rodou o passo manual depois do merge.
//
// Idempotente via schema_migrations_studio (nome próprio pra não colidir
// com a tabela `_migrations` do @kyvvohq/db-migrate usada em
// kyvvo-platform/kyvvo-people/kyvvo-admin — o Studio nunca adotou esse
// pacote, os .sql aqui são aplicados por conta própria). Cada arquivo roda
// dentro de uma transação (BEGIN geral incluso, se o próprio .sql já não
// tiver um) — se falhar, nem o schema nem o registro de "aplicado" ficam
// salvos, e o script para no primeiro erro (não tenta os próximos arquivos
// com o schema num estado incerto).
//
// MIGRATIONS_DIR (env, opcional) — pasta onde estão os .sql. Default
// resolve pra ../db a partir deste arquivo: em produção esse arquivo mora
// em /opt/kyvvo/panel/scripts (scp de server/panel/**) e os .sql em
// /opt/kyvvo/panel/db (scp à parte de server/db/** — ver deploy.yml), então
// ../db bate certinho. No repo local (rodando pelo gate) o caminho real é
// server/db, não server/panel/db — por isso o gate passa MIGRATIONS_DIR
// explícito.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Fixtures de dev (dados fake pra popular ambiente de teste) — nunca devem
// rodar em produção. Mesma lista que o gate.yml já pulava antes desta
// automação; mantida aqui como única fonte da verdade a partir de agora.
const FIXTURES_IGNORADAS = new Set(['006_massa_dados.sql', '017_seed_petshop_demo.sql']);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurado.');

  const dirMigrations = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : path.join(__dirname, '..', 'db');

  const arquivos = fs.readdirSync(dirMigrations)
    .filter((f) => f.endsWith('.sql') && !FIXTURES_IGNORADAS.has(f))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  // RAISE NOTICE (ex.: contagem de linhas afetadas numa migration de dado)
  // não aparece em lugar nenhum por padrão no node-postgres — só este
  // listener manda pro stdout, que é o único jeito de ver esse número no
  // log do deploy sem acesso direto ao Postgres de produção.
  client.on('notice', (msg) => console.log(`[migrations] notice: ${msg.message}`));
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations_studio (
        arquivo text primary key,
        aplicado_em timestamptz not null default now()
      )
    `);
    const { rows } = await client.query('select arquivo from schema_migrations_studio');
    const jaAplicadas = new Set(rows.map((r) => r.arquivo));

    const pendentes = arquivos.filter((f) => !jaAplicadas.has(f));
    if (!pendentes.length) {
      console.log(`[migrations] nada pendente (${arquivos.length} migration(ões) já aplicada(s)) — schema em dia.`);
      return;
    }

    console.log(`[migrations] ${pendentes.length} pendente(s): ${pendentes.join(', ')}`);
    for (const arquivo of pendentes) {
      const sql = fs.readFileSync(path.join(dirMigrations, arquivo), 'utf8');
      process.stdout.write(`[migrations] aplicando ${arquivo}... `);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations_studio (arquivo) values ($1)', [arquivo]);
        await client.query('commit');
        console.log('ok');
      } catch (err) {
        await client.query('rollback');
        console.log('FALHOU');
        console.error(`[migrations] ${arquivo}: ${err.message}`);
        throw err;
      }
    }
    console.log(`[migrations] ${pendentes.length} migration(ões) aplicada(s) com sucesso.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[migrations] erro fatal: ${err.message}`);
  process.exit(1);
});
