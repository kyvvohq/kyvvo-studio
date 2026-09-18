# Kyvvo Studio

Painel web de gestão do Kyvvo — o produto que o dono do negócio (tenant) usa
pra gerenciar agenda, clientes, serviços, financeiro, perfil e a assinatura.
Mais a área admin da Kyvvo e a landing de vendas `studio.kyvvo.com.br`.

Extraído de `kyvvohq/kyvvo` em 2026-09-07 (histórico preservado — este repo é
um descendente do `kyvvo` original, só sem os pedaços institucionais e o n8n).
O institucional (`kyvvo.com.br`) ficou em `kyvvohq/kyvvo`; o bot em
`kyvvohq/kyvvo-n8n`.

## O que tem aqui

- **Painel do tenant** (`server/panel/public/`): agenda (dia/semana/mês),
  Quadro, clientes, serviços, profissionais, financeiro, perfil, plano e
  cobrança.
- **Painel admin** (`server/panel/public/admin/`): gestão interna de todos os
  tenants.
- **Backend do painel** (`server/panel/`): Node.js + Fastify + PostgreSQL.
  Integrações: Asaas (pagamento), Meta WhatsApp Cloud API, Resend, Anthropic.
- **Landing do Studio** (`server/public-studio/`, servida por `server/index.js`
  em `studio.kyvvo.com.br` junto do painel).
- **Migrations** (`server/db/`): SQL sequencial (`NNN_descricao.sql`).

## Stack

| Camada | Tecnologia |
|---|---|
| Backend (painel + admin) | Node.js + Fastify + PostgreSQL |
| Landing | Node.js + Express |
| Design System | `kyvvo-design-system` (tokens + componentes; servido em tempo real pelo nginx em `/ds/`, não é dependência npm) |
| Pagamentos | Asaas (Pix recorrente + cartão, tokenização server-side) |
| E-mail | Resend |
| Testes | Playwright (`server/panel/tests/`), `node --test` (`tests-unit/`) |
| Infra | EC2 (Docker Compose) atrás de Cloudflare |
| CI/CD | GitHub Actions — deploy automático em push na `main` (`.github/workflows/deploy.yml`) |

## Estrutura

```
server/
├── index.js              # landing studio.kyvvo.com.br (:3000)
├── public-studio/        # HTML/CSS da landing
├── db/                   # migrations SQL
├── scripts/              # gen-env-from-ssm.sh, backup-db.sh, ...
├── tests/                # Playwright da landing
└── panel/                # o painel (:3001)
    ├── index.js          # API Fastify (tenant + admin)
    ├── routes/ lib/      # handlers e libs
    ├── *-service.js      # asaas, meta-whatsapp, anthropic, evolution
    ├── tests/ tests-unit/
    └── public/           # UI do tenant + admin/
```

## Deploy

Push na `main` → `.github/workflows/deploy.yml`:
- `deploy-landing` — muda em `server/index.js|package.json|.npmrc|public-studio/**` → recria o container `landing`
- `deploy-panel` — muda em `server/panel/**` → recria o container `studio`

Ambos scp pra `/opt/kyvvo/{landing,panel}` na EC2 e rodam
`gen-env-from-ssm.sh` + `docker compose up -d --force-recreate`.

Secrets necessários no repo: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY_B64`,
`NPM_PACKAGES_TOKEN`.

<!-- teste de branch protection -->
