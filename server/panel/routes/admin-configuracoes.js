// Área admin da Kyvvo — Configurações do sistema (US38) — extraído de
// index.js (fase 9 da modularização): GET /admin/api/configuracoes,
// PATCH /admin/api/configuracoes/planos/:chave, PATCH /admin/api/configuracoes/sistema.
const planos = require('../lib/planos');
const configSistema = require('../lib/configuracoes-sistema');
const { EMAIL_REGEX } = require('../lib/validadores');

// Preços dos planos e configurações gerais (antes hardcoded no código) —
// editáveis por qualquer admin da Kyvvo autenticado, sem deploy. Chaves das
// configurações gerais que este endpoint reconhece (mesmas de
// carregarConfiguracoesSistema/migration 028) — outras chaves no corpo são
// ignoradas silenciosamente.
const CONFIGURACOES_SISTEMA_CHAVES = [
  'trial_dias',
  'carencia_dias_inadimplencia',
  'max_tentativas_reenvio_token',
  'email_suporte',
  'whatsapp_suporte',
  'whatsapp_handoff_retorno_horas',
];

function registerAdminConfiguracoesRoutes(fastify, pool) {
  fastify.get('/admin/api/configuracoes', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const { rows: planosRows } = await pool.query(
      `SELECT chave, produto, slug, nome, descricao, tecnologia, tipo_numero, preco_mensal,
              limite_disparos, destaque, badge, headline_diferencial, frase_beneficio, herda_de, ativo, atualizado_em
       FROM planos ORDER BY produto ASC, preco_mensal ASC`
    );
    // US74/CA05 — features/limites por plano, pro admin editar (mesma forma
    // de junção em JS usada em GET /api/planos).
    const chaves = planosRows.map((p) => p.chave);
    const [{ rows: featuresRows }, { rows: limitesRows }] = await Promise.all([
      pool.query(`SELECT plano_chave, id, label, ordem FROM plano_features WHERE plano_chave = ANY($1) ORDER BY ordem ASC`, [chaves]),
      pool.query(`SELECT plano_chave, chave, valor FROM plano_limites WHERE plano_chave = ANY($1)`, [chaves]),
    ]);
    // pg devolve NUMERIC como string (evita perda de precisão) — converte pra
    // number aqui, já que o front trata preço como valor numérico.
    const planos = planosRows.map((p) => ({
      ...p,
      preco_mensal: Number(p.preco_mensal),
      features: featuresRows.filter((f) => f.plano_chave === p.chave).map((f) => ({ id: f.id, label: f.label, ordem: f.ordem })),
      limites: Object.fromEntries(limitesRows.filter((l) => l.plano_chave === p.chave).map((l) => [l.chave, l.valor])),
    }));
    const { rows: sistemaRows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    const sistema = Object.fromEntries(sistemaRows.map((r) => [r.chave, r.valor]));
    const { rows: log } = await pool.query(
      `SELECT l.campo, l.valor_anterior, l.valor_novo, l.alterado_em, a.nome AS alterado_por_nome
       FROM log_configuracoes l
       LEFT JOIN kyvvo_admins a ON a.id = l.alterado_por
       ORDER BY l.alterado_em DESC
       LIMIT 20`
    );
    return { planos, sistema, log };
  });

  // CA03/CA05/CA09/US67-CA04 — atualiza um plano (descrição/preço/limite/
  // destaque/badge/ativo). `slug`, `tecnologia` e `tipo_numero` são
  // identificadores estruturais e não são aceitos aqui (somente leitura).
  // Preço mínimo de R$1 (CA03), e cada campo alterado grava uma linha própria
  // no log de auditoria (CA05/CA07) na mesma transação da atualização.
  // conversas_mes/profissionais/unidades são do Studio; vagas_ativas/
  // candidatos_notificados_mes são do People (migration 064) — mesma rota
  // de PATCH serve os dois produtos, então a lista de chaves válidas é a
  // união (o CHECK de plano_limites.chave é a garantia final de qualquer
  // jeito, isso só evita um round-trip de erro genérico de constraint).
  const PLANO_LIMITES_CHAVES_VALIDAS = ['conversas_mes', 'profissionais', 'unidades', 'vagas_ativas', 'candidatos_notificados_mes'];

  fastify.patch('/admin/api/configuracoes/planos/:chave', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { chave } = request.params;
    const {
      nome,
      descricao,
      preco_mensal: precoMensal,
      limite_disparos: limiteDisparos,
      destaque,
      badge,
      headline_diferencial: headlineDiferencial,
      frase_beneficio: fraseBeneficio,
      features,
      limites,
      ativo,
    } = request.body || {};

    if (precoMensal !== undefined && !(Number(precoMensal) >= 1)) {
      return reply.code(400).send({ error: 'Preço mensal deve ser no mínimo R$ 1,00.' });
    }
    // US72/CA04 — nome é editável (o eixo de valor da US72 já fica no dado,
    // mas o PO pode querer ajustar o texto sem deploy); `slug` continua
    // estrutural e não é aceito aqui, então editar o nome nunca altera o
    // slug automaticamente.
    if (nome !== undefined && !nome.trim()) {
      return reply.code(400).send({ error: 'Nome do plano não pode ficar em branco.' });
    }
    // US73/CA01/CA04 — mesmo limite de 120 caracteres da migration, validado
    // aqui também (o CHECK do banco é a garantia final, isso só evita um
    // round-trip de erro genérico de constraint).
    if (headlineDiferencial !== undefined && headlineDiferencial !== null && headlineDiferencial.length > 120) {
      return reply.code(400).send({ error: 'Headline de diferencial deve ter no máximo 120 caracteres.' });
    }
    if (fraseBeneficio !== undefined && fraseBeneficio !== null && fraseBeneficio.length > 120) {
      return reply.code(400).send({ error: 'Frase de benefício deve ter no máximo 120 caracteres.' });
    }
    // US74/CA01/CA05 — até 3 diferenciais por plano; o resto da UI (3 campos
    // fixos) já impede mandar mais, isso é a garantia server-side.
    if (features !== undefined && (!Array.isArray(features) || features.length > 3)) {
      return reply.code(400).send({ error: 'Máximo de 3 diferenciais por plano.' });
    }
    if (limites !== undefined) {
      if (typeof limites !== 'object' || limites === null || Array.isArray(limites)) {
        return reply.code(400).send({ error: 'Campo "limites" deve ser um objeto.' });
      }
      const chaveInvalida = Object.keys(limites).find((k) => !PLANO_LIMITES_CHAVES_VALIDAS.includes(k));
      if (chaveInvalida) {
        return reply.code(400).send({ error: `Chave de limite inválida: "${chaveInvalida}". Use: ${PLANO_LIMITES_CHAVES_VALIDAS.join(', ')}.` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: antesRows } = await client.query('SELECT * FROM planos WHERE chave = $1 FOR UPDATE', [chave]);
      const anterior = antesRows[0];
      if (!anterior) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Plano não encontrado' });
      }

      // `badge` e `limite_disparos` aceitam null como valor explícito (US72 —
      // "remover selo"/"sem limite"), então COALESCE($n, coluna) não serve
      // pra eles: um PATCH mandando null pra limpar o campo cairia no
      // COALESCE e manteria o valor antigo, deixando o admin sem conseguir
      // remover um badge já salvo. Só `undefined` (campo ausente do body)
      // significa "não alterar" — nesse caso caímos pro valor anterior aqui
      // em JS, e o resto dos campos (que nunca precisam de null explícito)
      // continua com COALESCE normalmente.
      const badgeFinal = badge === undefined ? anterior.badge : badge;
      const limiteDisparosFinal = limiteDisparos === undefined ? anterior.limite_disparos : limiteDisparos;

      const { rows: atualizadoRows } = await client.query(
        `UPDATE planos SET
           nome = COALESCE($2, nome),
           descricao = COALESCE($3, descricao),
           preco_mensal = COALESCE($4, preco_mensal),
           limite_disparos = $5,
           destaque = COALESCE($6, destaque),
           badge = $7,
           headline_diferencial = COALESCE($8, headline_diferencial),
           frase_beneficio = COALESCE($9, frase_beneficio),
           ativo = COALESCE($10, ativo),
           atualizado_em = now(),
           atualizado_por = $11
         WHERE chave = $1
         RETURNING chave, slug, nome, descricao, tecnologia, tipo_numero, preco_mensal,
                   limite_disparos, destaque, badge, headline_diferencial, frase_beneficio, ativo, atualizado_em`,
        [chave, nome ? nome.trim() : null, descricao, precoMensal, limiteDisparosFinal, destaque, badgeFinal, headlineDiferencial, fraseBeneficio, ativo, request.admin.adminId]
      );
      const novo = atualizadoRows[0];

      // US74/CA05 — substituição total das features/limites do plano (o
      // admin sempre manda o conjunto completo, mesma lógica de "salvar
      // tudo de uma vez" já usada pelos outros campos desta rota).
      if (features !== undefined) {
        await client.query('DELETE FROM plano_features WHERE plano_chave = $1', [chave]);
        for (let i = 0; i < features.length; i++) {
          const label = String(features[i] || '').trim();
          if (!label) continue;
          await client.query(
            'INSERT INTO plano_features (plano_chave, label, ordem) VALUES ($1, $2, $3)',
            [chave, label, i + 1]
          );
        }
      }
      if (limites !== undefined) {
        for (const chaveLimite of PLANO_LIMITES_CHAVES_VALIDAS) {
          if (!(chaveLimite in limites)) continue;
          const valor = limites[chaveLimite];
          await client.query(
            `INSERT INTO plano_limites (plano_chave, chave, valor)
             VALUES ($1, $2, $3)
             ON CONFLICT (plano_chave, chave) DO UPDATE SET valor = $3`,
            [chave, chaveLimite, valor == null ? null : Number(valor)]
          );
        }
      }

      const camposComparados = [
        ['nome', anterior.nome, novo.nome],
        ['descricao', anterior.descricao, novo.descricao],
        ['preco_mensal', anterior.preco_mensal, novo.preco_mensal],
        ['limite_disparos', anterior.limite_disparos, novo.limite_disparos],
        ['destaque', anterior.destaque, novo.destaque],
        ['badge', anterior.badge, novo.badge],
        ['headline_diferencial', anterior.headline_diferencial, novo.headline_diferencial],
        ['frase_beneficio', anterior.frase_beneficio, novo.frase_beneficio],
        ['ativo', anterior.ativo, novo.ativo],
      ];
      for (const [campo, valorAnterior, valorNovo] of camposComparados) {
        if (String(valorAnterior) !== String(valorNovo)) {
          await client.query(
            `INSERT INTO log_configuracoes (campo, valor_anterior, valor_novo, alterado_por)
             VALUES ($1, $2, $3, $4)`,
            [`planos.${chave}.${campo}`, valorAnterior == null ? null : String(valorAnterior), valorNovo == null ? null : String(valorNovo), request.admin.adminId]
          );
        }
      }

      await client.query('COMMIT');
      await planos.carregar();
      // pg devolve NUMERIC como string — converte antes de devolver ao front.
      return { ...novo, preco_mensal: Number(novo.preco_mensal) };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  // CA06/CA07/CA09 — atualiza uma ou mais configurações gerais de uma vez;
  // recarrega o cache em memória (carregarConfiguracoesSistema) logo depois
  // de persistir, pra valer no processo já rodando sem deploy/restart.
  // Chaves numéricas alimentam constantes centrais do sistema (TRIAL_DIAS
  // etc.) — um valor inválido aqui quebraria o cálculo de trial pra todo
  // mundo, então valida antes de gravar.
  const CONFIGURACOES_SISTEMA_NUMERICAS = new Set(['trial_dias', 'carencia_dias_inadimplencia', 'max_tentativas_reenvio_token', 'whatsapp_handoff_retorno_horas']);

  fastify.patch('/admin/api/configuracoes/sistema', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const corpo = request.body || {};
    const chavesEnviadas = CONFIGURACOES_SISTEMA_CHAVES.filter((chave) => corpo[chave] !== undefined);
    if (!chavesEnviadas.length) {
      return reply.code(400).send({ error: `Envie ao menos uma configuração válida: ${CONFIGURACOES_SISTEMA_CHAVES.join(', ')}` });
    }
    for (const chave of chavesEnviadas) {
      if (CONFIGURACOES_SISTEMA_NUMERICAS.has(chave) && !(Number.isInteger(Number(corpo[chave])) && Number(corpo[chave]) > 0)) {
        return reply.code(400).send({ error: `"${chave}" deve ser um número inteiro maior que zero.` });
      }
    }
    if (corpo.email_suporte !== undefined && !EMAIL_REGEX.test(corpo.email_suporte)) {
      return reply.code(400).send({ error: 'E-mail de suporte inválido.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const chave of chavesEnviadas) {
        const valorNovo = String(corpo[chave]);
        const { rows: antesRows } = await client.query('SELECT valor FROM configuracoes_sistema WHERE chave = $1 FOR UPDATE', [chave]);
        const valorAnterior = antesRows[0] ? antesRows[0].valor : null;
        await client.query(
          `UPDATE configuracoes_sistema SET valor = $2, atualizado_em = now(), atualizado_por = $3 WHERE chave = $1`,
          [chave, valorNovo, request.admin.adminId]
        );
        if (valorAnterior !== valorNovo) {
          await client.query(
            `INSERT INTO log_configuracoes (campo, valor_anterior, valor_novo, alterado_por) VALUES ($1, $2, $3, $4)`,
            [`sistema.${chave}`, valorAnterior, valorNovo, request.admin.adminId]
          );
        }
      }
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    await configSistema.carregar();
    const { rows: sistemaRows } = await pool.query('SELECT chave, valor FROM configuracoes_sistema');
    return Object.fromEntries(sistemaRows.map((r) => [r.chave, r.valor]));
  });
}

module.exports = { registerAdminConfiguracoesRoutes };
