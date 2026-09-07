# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Kyvvo Studio: the tenant-facing web panel (`studio.kyvvo.com.br`), the internal
Kyvvo admin area (`admin.kyvvo.com.br`), and the sales landing. Extracted from
`kyvvohq/kyvvo` on 2026-09-07 with history preserved. The platform institutional
site lives in `kyvvohq/kyvvo`; the WhatsApp bot in `kyvvohq/kyvvo-n8n`.

Everything is under `server/`. There is **no build step** and no bundler.

## Two independent deployables, one directory tree

| App | Dir | Framework | Port | Container | Hostnames |
|---|---|---|---|---|---|
| Landing | `server/` (`index.js`) | Express | 3000 | `landing` | `studio.kyvvo.com.br` landing, `api.kyvvo.com.br` |
| Panel + Admin API | `server/panel/` (`index.js`) | Fastify | 3001 | `studio` | `studio.kyvvo.com.br` panel, `admin.kyvvo.com.br` |

They have **separate `package.json`, separate `node_modules`, separate deploys,
and share no modules**. Code that both need (e.g. the Sentry payload-redaction
helper) is intentionally duplicated in each `index.js` — keep it that way; do not
introduce a shared module across the landing/panel boundary.

## Commands

Run from `server/` (landing) or `server/panel/` (panel) as noted.

```bash
# Landing (server/)
npm start                 # node index.js  (needs DATABASE_URL)
npm run dev               # node --watch index.js
npm run test:e2e          # Playwright — landing (static, no DB)

# Panel (server/panel/)
npm start                 # node index.js  (needs DATABASE_URL, JWT_SECRET, ADMIN_JWT_SECRET)
npm run test:unit         # node --test tests-unit/*.test.js
npm run test:e2e          # Playwright — panel + admin UI (static, no DB)

# Single Playwright spec / single test
npx playwright test tests/inicio.spec.js
npx playwright test -g "botão + Novo agendamento abre o modal"

# Single unit test file
node --test tests-unit/feriados.test.js
```

`npm ci` in either dir needs `NPM_PACKAGES_TOKEN` in the environment — `.npmrc`
points `@kyvvohq` at GitHub Packages and reads that token.

**Playwright locally:** both `playwright.config.js` files hardcode
`launchOptions.executablePath: '/opt/pw-browsers/chromium'` (the CI/EC2 path).
On a dev machine that path won't exist — override it or run in an environment
that has it.

## Testing model (important)

Playwright specs do **not** touch Postgres or the real server. Each config
starts a tiny static file server (`tests/static-server.js`) that serves
`public/` (panel) or `public-studio/` (landing); specs stub every API call with
`page.route(...)` and seed `localStorage` with a fake JWT. So E2E specs exercise
front-end behavior only. Backend logic is covered by `tests-unit/` (`node --test`,
pure functions from `lib/`) and by `server/tests/*.spec.js` (plan-page specs,
also static).

## CI / deploy

- **`.github/workflows/.github/workflows/gate.yml`** — the PR gate (migrations +
  unit + Playwright against a real Postgres service). **It sits at a nested path
  GitHub Actions does not scan** (`.github/workflows/**` beyond the top level is
  ignored), so as committed it does not run. If you touch CI, this is why the
  gate looks absent.
- **`deploy.yml`** triggers on push to the **`release`** branch (not `main`),
  path-filtered: landing files → recreate `landing` container; `server/panel/**`
  → recreate `studio`. scp to `/opt/kyvvo/{landing,panel}` on EC2, then
  `gen-env-from-ssm.sh` + `docker compose up -d --force-recreate`.
- **`deploy-backup.yml`** triggers on push to `main` for `server/scripts/**` —
  syncs scripts and reinstalls the backup cron.
- Repo secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY_B64`, `NPM_PACKAGES_TOKEN`.

## Database

- Migrations are plain sequential SQL: `server/db/NNN_descricao.sql`, applied in
  filename order (`for f in $(ls server/db/*.sql | sort); do psql -f "$f"; done`).
  No migration framework, no down migrations, no schema-diff — a change is a new
  numbered file.
- **Multi-tenancy is enforced in every query** (`WHERE tenant_id = $1`). There is
  no Row Level Security (the `001_init.sql` comment says so explicitly). Any new
  query that reads tenant data must carry the `tenant_id` filter itself.
- The production database is named `railway` (legacy); the panel connects via
  `DATABASE_URL`.

## Panel architecture

**`server/panel/index.js`** wires plugins and calls `registerXxxRoutes(fastify, pool)`
for each file in `routes/`, and `lib.init(pool)` for stateful helpers in `lib/`.
The long block comments in `index.js` are historical breadcrumbs from an 11-phase
extraction of a once-monolithic file — they describe where code *moved to*, not
current behavior. Route files follow one shape: `registerXxxRoutes(fastify, pool)`
with handlers gated by `preHandler: [fastify.authenticate, ...]`.

**Two isolated auth systems — never mix them:**
- Tenant: `@fastify/jwt` default namespace, `JWT_SECRET`, populates `request.user`.
- Admin: `@fastify/jwt` `admin` namespace, `ADMIN_JWT_SECRET`, `request.adminJwtVerify`,
  populates `request.admin`. Separate secret, separate table, separate decorator
  (`fastify.authenticateAdmin`). Do not share a preHandler between the two.

**`fastify.authenticate`** (in `index.js`) is the core gate:
1. `resolverClaims` (`lib/resolver-sessao.js`) verifies the token as RS256 against
   the `kyvvo-platform` service (`lib/platform.js`, JWKS), falling back to legacy
   HS256 for pre-cutover 7-day tokens.
2. It then **re-reads `token_version`, `role`, `ativo`, and tenant status from the
   DB on every request** — JWT claims are never trusted for authz. A role change
   or a disabled member takes effect on the next request.
3. Email-verification and subscription/trial state are enforced here too, via the
   `ROTAS_LIVRES_SEM_VERIFICACAO` / `ROTAS_LIVRES_SEM_ASSINATURA` whitelists.
   Blocked accounts keep GET access; only writes outside the whitelist get 403.

Other decorators: `fastify.requireModulo('financeiro')` (checks `tenant_modulos`),
`fastify.requireAdmin` (role `administrador`). Chain both **after** `authenticate`.

**Front end** is un-bundled static assets in `public/`:
- Tenant panel is a hand-rolled SPA in `public/app.js` (~6k lines). The server
  registers a fixed list of clean paths (`/agenda`, `/clientes`, `/modulo/:chave`,
  …) that all serve `painel.html`; `app.js` reads the path and renders the section.
- Admin UI is separate under `public/admin/` (`shell.js` + one `*.html`/`*.js`
  pair per page). Auth there is client-side (token in `localStorage`) plus the
  JSON API it calls.
- The tenant panel is always dark-themed. Only the admin area has a light/dark
  toggle (`localStorage.kyvvo_admin_tema`, applied pre-paint).

## External services & sibling repos

- `@kyvvohq/design-system` — tokens + components from GitHub Packages, served raw
  at `/ds/` straight out of `node_modules` (no bundler). See `docs/design-system.md`;
  brand accent `--accent:#7c5cfc`, do not change `--muted:#7484a5` without
  re-checking WCAG contrast.
- `@kyvvohq/platform-client` → the `kyvvo-platform` service, the emerging auth
  authority (P3 cutover in progress; token verification is the first piece).
- `@kyvvohq/asaas` — Asaas payments (Pix recurring + card, server-side tokenization).
- `*-service.js` in `server/panel/`: `asaas-service`, `meta-whatsapp-service`,
  `anthropic-service` (IA engine, `lib/ia-engine.js`), `evolution-service`.
- Every integration is **inert without its credential** — no `SENTRY_DSN`, no
  `POSTHOG_KEY`, no `META_WHATSAPP_TOKEN` means that feature is simply off, the
  app still boots.

## Secrets

Never commit them. They live in **AWS SSM Parameter Store** as `SecureString` at
`/kyvvo/<service>/<KEY>`; `server/scripts/gen-env-from-ssm.sh` materializes
`/opt/kyvvo/env/<service>.env` on the EC2 host, consumed by `docker-compose` via
`env_file`. See `docs/ssm-cutover.md`.

## Stale documentation

`docs/architecture.md` describes an **obsolete** stack (n8n + Supabase + React
Native / Expo, RLS-based tenancy). None of that reflects this repo today. Trust
`README.md`, `docs/design-system.md`, and the code. The infra table and
backup/SSM sections of `architecture.md` are still roughly accurate; the app
architecture and DB sections are not.
