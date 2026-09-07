---
name: refinar
description: Transforma uma ideia solta de tarefa num issue fechado e testável para o agente de IA (agente.yml), já com a label agent:* certa e um aviso se a tarefa esbarra em caminho protegido.
---

# refinar

Pega um rascunho de tarefa (uma frase, um print, um "arruma isso") e devolve o
corpo de issue no formato que `.github/ISSUE_TEMPLATE/tarefa-agente.yml` espera,
pronto pra colar em `gh issue create`.

## Quando usar

Antes de abrir qualquer issue com label `agent:*`. O workflow `agente.yml` roda
o `anthropics/claude-code-action` com `--max-turns 30` e escopo travado pela
label — issue vago = PR ruim ou nenhum PR.

## Passos

1. **Entenda a tarefa.** Leia o rascunho. Se faltar o essencial (o que muda, como
   saber que ficou pronto), pergunte — no máximo duas perguntas.

2. **Classifique a categoria** e a label correspondente:
   - mexe só em teste (`server/panel/tests/`, `server/panel/tests-unit/`) → `agent:tests`
   - front ou rota do painel do tenant (`server/panel/`, fora de `public/admin/`) → `agent:panel`
   - área de admin (`server/panel/public/admin/`, rotas de admin) → `agent:admin`
   - landing Express (`server/`) → `agent:landing`

3. **Cheque caminho protegido.** Se a tarefa, pra ficar de pé, precisa tocar
   `.github/workflows/`, `.github/dependabot.yml`, `server/db/` (migration),
   qualquer `.npmrc`, qualquer `package.json`, um `*-service.js`
   (`asaas`/`meta-whatsapp`/`anthropic`/`evolution`) ou o `CLAUDE.md` — **pare**.
   Isso não vai por agente: é PR humano com a label `revisado:infra`. Diga isso
   e não gere o issue.

4. **Escreva o corpo** com estas seções (as do template):
   - **Objetivo** — 1–2 frases, resultado final.
   - **Critério de aceite** — checklist verificável. Prefira "tal teste passa",
     "tal tela mostra tal coisa". Todo item tem que ser checável sem adivinhar.
   - **Arquivos / áreas prováveis** — onde a mudança mora (rode `grep`/`glob` pra
     confirmar antes de listar; não chute).
   - **Fora de escopo** — o que não pode mudar.
   - **Contexto / links** — prints, PRs, logs.

5. **Entregue** o bloco pronto:

   ```
   gh issue create \
     --title "[agente] <título curto>" \
     --label "tarefa" --label "agent:<categoria>" \
     --body "<corpo>"
   ```

   Lembre que aplicar a label `agent:*` é o que dispara o workflow — confirme
   com o humano antes de criar já com ela, ou crie sem e deixe a pessoa aplicar.

## Regras

- Uma tarefa por issue. Se o rascunho tem três coisas, gere três.
- Critério de aceite sem número mágico não medido: "rápido" não serve, "resposta
  < 200ms no teste" serve.
- Não invente caminho de arquivo. Verifique.
- O agente segue o `CLAUDE.md` da raiz (fluxo obrigatório, máx. 3 tentativas de
  conserto, draft PR se não convergir) — não repita isso no issue, referencie.
