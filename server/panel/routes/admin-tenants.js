// Área admin da Kyvvo (US16) — Tenants — extraído de index.js (fase 9 da
// modularização): GET /admin/api/tenants[/resumo|/:id|/:id/assinatura-resumo|
// /:id/modulos/historico], PATCH /admin/api/tenants/:id[/modulos/:moduloKey|/modo],
// POST/PATCH/DELETE /admin/api/tenants[/:id], GET /admin/api/assinaturas,
// GET /admin/api/planos (catálogo pro filtro).
const bcrypt = require('bcryptjs');
const planos = require('../lib/planos');
const { calcularTrialTenant, statusContaTenant } = require('../lib/trial-conta');
const { montarResumoPagamentos } = require('../lib/pagamentos');

// CHECK da coluna tenants.segmento (migration 018) — legado, só o CRUD de
// tenants do admin ainda usa (cadastro self-service migrou pra segmento_id
// referenciando a tabela `segmentos`, ver /api/segmentos).
const SEGMENTOS_VALIDOS = ['salao_beleza', 'petshop', 'psicologia', 'fisioterapia', 'pilates', 'outro'];

// US69 — modo de atendimento do tenant no WhatsApp: bot (menus, n8n) ou ia
// (conversacional, US68). Mesmo enum do CHECK de tenants.tecnologia
// (migration 046).
const TECNOLOGIA_VALIDA = ['bot', 'ia'];

function registerAdminTenantsRoutes(fastify, pool) {
  // US65 — catálogo completo de módulos com o estado (ativo/inativo) daquele
  // tenant específico, pra gestão de módulos por salão no portal Admin. LEFT
  // JOIN porque um módulo sem linha em tenant_modulos conta como inativo
  // (COALESCE), não fica de fora da lista.
  async function modulosDoTenantParaAdmin(tenantId) {
    const { rows } = await pool.query(
      `SELECT m.key, m.nome, m.obrigatorio, COALESCE(tm.ativo, false) AS ativo
       FROM modulos m
       LEFT JOIN tenant_modulos tm ON tm.tenant_id = $1 AND tm.modulo_key = m.key
       ORDER BY m.nome`,
      [tenantId]
    );
    return rows;
  }

  // Colunas ordenáveis da tela de listagem de tenants (US26/CA03) — mapa
  // explícito pra nunca interpolar `order_by` direto numa query SQL.
  const TENANTS_ORDER_COLUMNS = {
    nome: 't.nome',
    cadastrado_em: 't.cadastrado_em',
    ativado_em: 't.ativado_em',
    status: 't.status',
  };

  // Buckets de status usados no filtro "Status ▾" da tela de Tenants — chave
  // enviada pelo frontend -> rótulo de `status_conta` (statusContaTenant).
  // "inativo" no filtro cobre tudo que não é Ativo/Trial ativo (Inativo,
  // Suspenso, Trial expirado, Não ativado) — mesmo agrupamento dos cards de
  // estatística (GET /admin/api/tenants/resumo), pra bater a soma exibida.
  const STATUS_CONTA_FILTRO = {
    ativo: ['Ativo'],
    trial: ['Trial ativo'],
    inativo: ['Inativo', 'Suspenso', 'Trial expirado', 'Não ativado'],
  };

  fastify.get('/admin/api/tenants', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { page, limit, order_by: orderByParam, order_dir: orderDirParam, status: statusFiltro, plano: planoFiltro, modo: modoFiltro } =
      request.query;

    // Sem paginação explícita, mantém o comportamento legado (lista completa,
    // ordenada por data de cadastro do sistema) — não muda o CRUD de tenants
    // já existente (US16/painel.html), que consome este mesmo endpoint sem
    // esses parâmetros.
    if (page === undefined && limit === undefined) {
      const { rows } = await pool.query(
        `SELECT t.id, t.nome, t.segmento, t.ativo, t.criado_em, t.cadastrado_em, t.ativado_em, t.tecnologia,
                (SELECT COUNT(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
         FROM tenants t
         WHERE t.excluido_em IS NULL
         ORDER BY t.criado_em DESC`
      );
      return { tenants: rows };
    }

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const orderColumn = TENANTS_ORDER_COLUMNS[orderByParam] || TENANTS_ORDER_COLUMNS.cadastrado_em;
    const orderDir = String(orderDirParam).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Busca por e-mail (de qualquer usuário do tenant) ou WhatsApp — parâmetro
    // sempre bindado via $n, nunca interpolado na query (US27/CA05).
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';
    const condicoes = ['t.excluido_em IS NULL'];
    const searchParams = [];
    if (search) {
      searchParams.push(`%${search}%`);
      condicoes.push(`(t.whatsapp ILIKE $${searchParams.length}
           OR EXISTS (SELECT 1 FROM usuarios u WHERE u.tenant_id = t.id AND u.email ILIKE $${searchParams.length}))`);
    }
    if (modoFiltro) {
      searchParams.push(modoFiltro);
      condicoes.push(`t.tecnologia = $${searchParams.length}`);
    }
    if (planoFiltro) {
      searchParams.push(planoFiltro);
      condicoes.push(`t.plano = $${searchParams.length}`);
    }
    const whereClause = `WHERE ${condicoes.join(' AND ')}`;

    const buscarLinhas = async () => {
      const { rows } = await pool.query(
        `SELECT t.id, t.nome, t.segmento, t.ativo, t.criado_em, t.cadastrado_em, t.ativado_em,
                t.whatsapp, t.status, t.trial_expires_at, t.tecnologia, t.plano,
                resp.nome AS responsavel, resp.email AS email,
                (SELECT COUNT(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
         FROM tenants t
         LEFT JOIN LATERAL (
           SELECT nome, email FROM usuarios WHERE tenant_id = t.id ORDER BY criado_em ASC LIMIT 1
         ) resp ON true
         ${whereClause}
         ORDER BY ${orderColumn} ${orderDir} NULLS LAST`,
        searchParams
      );
      return rows.map((t) => {
        const trial = calcularTrialTenant(t);
        return {
          ...t,
          plano_nome: planos.nomeDoPlano(t.plano),
          status_conta: statusContaTenant(t),
          trial_ativo: trial.trialAtivo,
          trial_dias_restantes: trial.trialDiasRestantes,
        };
      });
    };

    // Filtro por "Status ▾" é aplicado aqui em JS, não em SQL: status_conta é
    // derivado (depende do cálculo de trial, que não é uma coluna) — filtrar
    // depois de calcular evita duplicar essa lógica em SQL. Isso troca a
    // paginação em SQL (LIMIT/OFFSET) por buscar todos os matches de
    // busca/plano/modo e paginar em memória só quando o filtro de status
    // está ativo — aceitável, o volume de tenants é baixo hoje.
    if (statusFiltro && STATUS_CONTA_FILTRO[statusFiltro]) {
      const statusPermitidos = STATUS_CONTA_FILTRO[statusFiltro];
      const todasFiltradas = (await buscarLinhas()).filter((t) => statusPermitidos.includes(t.status_conta));
      const total = todasFiltradas.length;
      const offset = (pageNum - 1) * limitNum;
      return {
        tenants: todasFiltradas.slice(offset, offset + limitNum),
        page: pageNum,
        limit: limitNum,
        total,
        total_paginas: Math.max(Math.ceil(total / limitNum), 1),
      };
    }

    const { rows: totalRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM tenants t ${whereClause}`, searchParams);
    const total = totalRows[0].total;
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await pool.query(
      `SELECT t.id, t.nome, t.segmento, t.ativo, t.criado_em, t.cadastrado_em, t.ativado_em,
              t.whatsapp, t.status, t.trial_expires_at, t.tecnologia, t.plano,
              resp.nome AS responsavel, resp.email AS email,
              (SELECT COUNT(*)::int FROM usuarios u WHERE u.tenant_id = t.id) AS total_usuarios
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT nome, email FROM usuarios WHERE tenant_id = t.id ORDER BY criado_em ASC LIMIT 1
       ) resp ON true
       ${whereClause}
       ORDER BY ${orderColumn} ${orderDir} NULLS LAST
       LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`,
      [...searchParams, limitNum, offset]
    );

    return {
      tenants: rows.map((t) => {
        const trial = calcularTrialTenant(t);
        return {
          ...t,
          plano_nome: planos.nomeDoPlano(t.plano),
          status_conta: statusContaTenant(t),
          trial_ativo: trial.trialAtivo,
          trial_dias_restantes: trial.trialDiasRestantes,
        };
      }),
      page: pageNum,
      limit: limitNum,
      total,
      total_paginas: Math.max(Math.ceil(total / limitNum), 1),
    };
  });

  // GET /admin/api/tenants/resumo (cards de estatística de Tenants/Dashboard)
  // — mesmos buckets de STATUS_CONTA_FILTRO acima, mas como contagem: Ativos
  // e "Em trial" são os únicos buckets com rótulo próprio no mockup,
  // Inativos absorve todo o resto (Suspenso/Trial expirado/Não ativado) pra
  // a soma dos 4 cards bater exatamente com o Total.
  fastify.get('/admin/api/tenants/resumo', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const { rows } = await pool.query(
      `SELECT t.ativo, t.status, t.ativado_em, t.trial_expires_at, t.criado_em
       FROM tenants t WHERE t.excluido_em IS NULL`
    );
    let ativos = 0;
    let emTrial = 0;
    let novosMes = 0;
    const inicioMes = new Date();
    inicioMes.setUTCDate(1);
    inicioMes.setUTCHours(0, 0, 0, 0);
    for (const t of rows) {
      const status = statusContaTenant(t);
      if (status === 'Ativo') ativos += 1;
      else if (status === 'Trial ativo') emTrial += 1;
      if (t.criado_em && new Date(t.criado_em) >= inicioMes) novosMes += 1;
    }
    const total = rows.length;
    return { total, ativos, em_trial: emTrial, inativos: total - ativos - emTrial, novos_mes: novosMes };
  });

  fastify.get('/admin/api/tenants/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    const { rows: modulosAtivos } = await pool.query(
      `SELECT m.key, m.nome, m.preco_mensal
       FROM tenant_modulos tm JOIN modulos m ON m.key = tm.modulo_key
       WHERE tm.tenant_id = $1 AND tm.ativo
       ORDER BY m.nome`,
      [id]
    );
    // US65 — catálogo completo (ativos e inativos) pra tela de gestão de
    // módulos (CA01); `modulos_ativos` acima continua existindo só pro modal
    // antigo de edição da listagem (US16/app.js).
    const modulos = await modulosDoTenantParaAdmin(id);
    const { rows: usuarios } = await pool.query('SELECT id, email, nome FROM usuarios WHERE tenant_id = $1 ORDER BY nome', [id]);
    // Responsável = primeiro usuário cadastrado do tenant (US28/CA03) — mesmo
    // critério (criado_em ASC) usado na listagem (US26); consulta separada
    // porque a lista `usuarios` acima é ordenada por nome (usada pelo CRUD
    // antigo do US16) e não por data de criação.
    const { rows: responsavelRows } = await pool.query(
      'SELECT nome, email FROM usuarios WHERE tenant_id = $1 ORDER BY criado_em ASC LIMIT 1',
      [id]
    );
    const responsavel = responsavelRows[0] || null;
    const { rows: contagemRows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM servicos WHERE tenant_id = $1) AS servicos,
         (SELECT COUNT(*)::int FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL) AS profissionais,
         (SELECT COUNT(*)::int FROM agendamentos WHERE tenant_id = $1) AS total_agendamentos,
         (SELECT MAX(data_hora) FROM agendamentos WHERE tenant_id = $1) AS ultimo_agendamento,
         (SELECT COUNT(*)::int FROM clientes WHERE tenant_id = $1) AS total_clientes`,
      [id]
    );

    // Indicador de trial somente leitura (US31/CA05) — todo o cálculo de
    // datas acontece aqui; o frontend só formata e exibe.
    const trial = calcularTrialTenant(tenant);

    return {
      ...tenant,
      status_conta: statusContaTenant(tenant),
      plano_atual: planos.nomeDoPlano(tenant.plano),
      trial_ativo: trial.trialAtivo,
      trial_inicio: trial.trialInicio,
      trial_fim: trial.trialFim,
      trial_dias_restantes: trial.trialDiasRestantes,
      responsavel,
      modulos_ativos: modulosAtivos,
      modulos,
      usuarios,
      contagens: contagemRows[0],
    };
  });

  // GET /admin/api/tenants/:id/assinatura-resumo — alimenta o painel lateral
  // "Ver detalhes" da tela de Tenants (versão compacta, ao contrário do GET
  // /admin/api/tenants/:id acima que traz tudo pra página cheia). Carregado
  // só quando o painel abre (não em toda listagem), porque reaproveita
  // montarResumoPagamentos, que chama a Asaas de verdade — tem latência de
  // rede real, não é instantâneo.
  fastify.get('/admin/api/tenants/:id/assinatura-resumo', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query(
      `SELECT id, nome, whatsapp, telefone, meta_phone_number_id, ativo, plano, status, ativado_em,
              status_alterado_em, asaas_customer_id, asaas_subscription_id, asaas_meio_pagamento, asaas_cartao_final
       FROM tenants WHERE id = $1 AND excluido_em IS NULL`,
      [id]
    );
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }

    const { rows: responsavelRows } = await pool.query(
      'SELECT nome, email FROM usuarios WHERE tenant_id = $1 ORDER BY criado_em ASC LIMIT 1',
      [id]
    );
    // Número conectado: number vinculado via "números prontos" (US39.2) tem
    // prioridade porque é o dado mais recente/confiável; self-service
    // (Embedded Signup) não passa por `numeros_prontos`, só grava
    // meta_phone_number_id direto em tenants — nesse caso cai no fallback de
    // `tenant.telefone` (cadastrado no onboarding).
    const { rows: numeroRows } = tenant.meta_phone_number_id
      ? await pool.query('SELECT telefone FROM numeros_prontos WHERE meta_phone_number_id = $1 LIMIT 1', [tenant.meta_phone_number_id])
      : { rows: [] };

    const pagamentos = await montarResumoPagamentos(tenant);
    const trial = calcularTrialTenant(tenant);

    return {
      id: tenant.id,
      nome: tenant.nome,
      status_conta: statusContaTenant(tenant),
      trial_dias_restantes: trial.trialDiasRestantes,
      responsavel: responsavelRows[0] || null,
      whatsapp: tenant.whatsapp,
      plano_nome: pagamentos.plano_nome,
      valor_plano: pagamentos.valor_plano,
      proxima_cobranca: pagamentos.proxima_cobranca,
      whatsapp_conectado: Boolean(tenant.meta_phone_number_id),
      whatsapp_numero: (numeroRows[0] && numeroRows[0].telefone) || tenant.telefone || null,
    };
  });

  // US65/CA02-CA06 — ativa ou desativa um módulo pra um tenant específico.
  // Bloqueia desativação de módulo obrigatório (CA04) e registra auditoria
  // de toda alteração de estado (CA05) na mesma transação do upsert.
  fastify.patch('/admin/api/tenants/:id/modulos/:moduloKey', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id, moduloKey } = request.params;
    const { ativo } = request.body || {};
    if (typeof ativo !== 'boolean') {
      return reply.code(400).send({ error: 'Campo "ativo" deve ser um booleano.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [id]);
      if (!tenantRows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Tenant não encontrado' });
      }

      const { rows: moduloRows } = await client.query('SELECT key, nome, obrigatorio FROM modulos WHERE key = $1', [moduloKey]);
      const modulo = moduloRows[0];
      if (!modulo) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Módulo não encontrado' });
      }

      if (modulo.obrigatorio && !ativo) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: `O módulo "${modulo.nome}" é obrigatório e não pode ser desativado.` });
      }

      const { rows: atualRows } = await client.query(
        'SELECT ativo FROM tenant_modulos WHERE tenant_id = $1 AND modulo_key = $2 FOR UPDATE',
        [id, moduloKey]
      );
      const estadoAnterior = atualRows[0] ? atualRows[0].ativo : false;

      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, modulo_key) DO UPDATE SET ativo = $3`,
        [id, moduloKey, ativo]
      );

      if (estadoAnterior !== ativo) {
        await client.query(
          `INSERT INTO log_modulos_tenant (tenant_id, modulo_key, acao, estado_anterior, estado_novo, alterado_por)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, moduloKey, ativo ? 'ativado' : 'desativado', estadoAnterior, ativo, request.admin.adminId]
        );
      }

      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }

    return { modulos: await modulosDoTenantParaAdmin(id) };
  });

  // US65/CA05 — histórico cronológico das alterações de módulos de um tenant.
  fastify.get('/admin/api/tenants/:id/modulos/historico', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { id } = request.params;
    const { rows } = await pool.query(
      `SELECT l.modulo_key, m.nome AS modulo_nome, l.acao, l.estado_anterior, l.estado_novo, l.alterado_em, a.nome AS alterado_por_nome
       FROM log_modulos_tenant l
       JOIN modulos m ON m.key = l.modulo_key
       LEFT JOIN kyvvo_admins a ON a.id = l.alterado_por
       WHERE l.tenant_id = $1
       ORDER BY l.alterado_em DESC
       LIMIT 20`,
      [id]
    );
    return { historico: rows };
  });

  // US69/CA03 — troca o modo de atendimento (bot/ia) de um tenant específico.
  // Só o admin Kyvvo faz essa troca (o dono do salão só visualiza, CA06) — o
  // modo está vinculado ao plano contratado (US67), e liberar a edição pro
  // salão quebraria a lógica de cobrança. Cada troca é auditada em
  // log_modo_atendimento_tenant (migration 046), mesmo padrão de
  // log_modulos_tenant (US65/CA05).
  fastify.patch('/admin/api/tenants/:id/modo', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { tecnologia } = request.body || {};

    if (!TECNOLOGIA_VALIDA.includes(tecnologia)) {
      return reply.code(422).send({ error: `tecnologia deve ser um de: ${TECNOLOGIA_VALIDA.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: antesRows } = await client.query('SELECT tecnologia FROM tenants WHERE id = $1 FOR UPDATE', [id]);
      const anterior = antesRows[0];
      if (!anterior) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Tenant não encontrado' });
      }

      const { rows: atualizadoRows } = await client.query(
        'UPDATE tenants SET tecnologia = $2 WHERE id = $1 RETURNING *',
        [id, tecnologia]
      );
      const novo = atualizadoRows[0];

      if (anterior.tecnologia !== tecnologia) {
        await client.query(
          `INSERT INTO log_modo_atendimento_tenant (tenant_id, valor_anterior, valor_novo, alterado_por)
           VALUES ($1, $2, $3, $4)`,
          [id, anterior.tecnologia, tecnologia, request.admin.adminId]
        );
      }

      await client.query('COMMIT');
      return novo;
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.post('/admin/api/tenants', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { nome, telefone, endereco, segmento, horario_abertura: horarioAbertura, horario_fechamento: horarioFechamento, usuario } =
      request.body || {};

    if (!nome || !nome.trim()) {
      return reply.code(400).send({ error: 'Campo "nome" é obrigatório' });
    }
    if (segmento !== undefined && !SEGMENTOS_VALIDOS.includes(segmento)) {
      return reply.code(400).send({ error: `segmento deve ser um de: ${SEGMENTOS_VALIDOS.join(', ')}` });
    }
    if (usuario && (!usuario.email || !usuario.senha)) {
      return reply.code(400).send({ error: 'Para criar o usuário de login junto, informe "email" e "senha" do usuário' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (nome, telefone, endereco, segmento, horario_abertura, horario_fechamento)
         VALUES ($1, $2, $3, COALESCE($4, 'salao_beleza'), COALESCE($5::time, '08:00'::time), COALESCE($6::time, '20:00'::time))
         RETURNING id, nome, telefone, endereco, segmento, ativo, criado_em`,
        [nome.trim(), telefone || null, endereco || null, segmento || null, horarioAbertura || null, horarioFechamento || null]
      );
      const tenant = tenantRows[0];

      // Todo tenant novo já nasce com a agenda inteligente ativa — é o
      // mínimo pra usar o portal (mesmo padrão da migration 010).
      await client.query(
        `INSERT INTO tenant_modulos (tenant_id, modulo_key, ativo) VALUES ($1, 'agenda_inteligente', true)`,
        [tenant.id]
      );

      let usuarioCriado = null;
      if (usuario) {
        const hash = await bcrypt.hash(usuario.senha, 10);
        // email_verified=true: onboarding feito pela própria equipe Kyvvo,
        // já é confiável (mesmo raciocínio do backfill da migration 021) —
        // sem isso o usuário nasceria bloqueado em /verificar.html sem nunca
        // ter recebido nenhum token (US20 só gera/envia token no cadastro
        // self-service e no reenvio).
        const { rows: usuarioRows } = await client.query(
          `INSERT INTO usuarios (tenant_id, email, senha_hash, nome, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id, email, nome`,
          [tenant.id, usuario.email.toLowerCase().trim(), hash, usuario.nome || nome.trim()]
        );
        usuarioCriado = usuarioRows[0];
      }

      await client.query('COMMIT');
      reply.code(201);
      return { ...tenant, usuario: usuarioCriado };
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Já existe um usuário com esse e-mail' });
      }
      throw erro;
    } finally {
      client.release();
    }
  });

  fastify.patch('/admin/api/tenants/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { nome, telefone, endereco, segmento, ativo, horario_abertura: horarioAbertura, horario_fechamento: horarioFechamento } =
      request.body || {};

    if (segmento !== undefined && !SEGMENTOS_VALIDOS.includes(segmento)) {
      return reply.code(400).send({ error: `segmento deve ser um de: ${SEGMENTOS_VALIDOS.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE tenants SET
         nome = COALESCE($2, nome),
         telefone = COALESCE($3, telefone),
         endereco = COALESCE($4, endereco),
         segmento = COALESCE($5, segmento),
         ativo = COALESCE($6, ativo),
         horario_abertura = COALESCE($7, horario_abertura),
         horario_fechamento = COALESCE($8, horario_fechamento)
       WHERE id = $1
       RETURNING id, nome, telefone, endereco, segmento, ativo, horario_abertura, horario_fechamento`,
      [id, nome ? nome.trim() : null, telefone, endereco, segmento, ativo, horarioAbertura, horarioFechamento]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }
    return rows[0];
  });

  // DELETE /admin/api/tenants/:id — "Excluir tenant" do menu "•••" da tela de
  // Tenants. Soft delete só (excluido_em), nunca hard delete: apagar de
  // verdade cascatearia agendamentos/clientes/financeiro/usuários do tenant —
  // perda de dado real. Some da listagem/busca admin (WHERE excluido_em IS
  // NULL nas rotas acima), mas o registro continua no banco. Não existe hoje
  // uma tela de "tenants excluídos" pra restaurar — se for engano, é via SQL
  // direto (UPDATE tenants SET excluido_em = NULL WHERE id = ...). Também
  // desativa o acesso (ativo = false), já que um tenant excluído não deve
  // continuar autenticando no portal.
  fastify.delete('/admin/api/tenants/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query(
      `UPDATE tenants SET excluido_em = now(), ativo = false
       WHERE id = $1 AND excluido_em IS NULL
       RETURNING id`,
      [id]
    );
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Tenant não encontrado' });
    }
    return { ok: true };
  });

  // GET /admin/api/assinaturas — tela "Assinaturas" (menu Clientes). Igual
  // GET /admin/api/tenants/:id/assinatura-resumo, reaproveita
  // montarResumoPagamentos em vez de duplicar a leitura da Asaas — só chama
  // a API externa pra quem já tem assinatura de verdade (asaas_subscription_id),
  // em paralelo. Se a base de tenants pagantes crescer muito, isso fica
  // lento (uma chamada HTTP externa por tenant) — não é problema hoje, vale
  // revisitar se a lista de tenants pagos passar de algumas dezenas.
  fastify.get('/admin/api/assinaturas', { preHandler: [fastify.authenticateAdmin] }, async () => {
    const { rows } = await pool.query(
      `SELECT id, nome, ativo, plano, status, ativado_em, status_alterado_em, asaas_customer_id,
              asaas_subscription_id, asaas_meio_pagamento, asaas_cartao_final, cancelado_em, acesso_ate
       FROM tenants WHERE excluido_em IS NULL ORDER BY nome ASC`
    );
    const linhas = await Promise.all(
      rows.map(async (tenant) => {
        const pagamentos = await montarResumoPagamentos(tenant);
        return {
          id: tenant.id,
          nome: tenant.nome,
          plano_nome: pagamentos.plano_nome,
          valor_plano: pagamentos.valor_plano,
          status_conta: statusContaTenant(tenant),
          proxima_cobranca: pagamentos.proxima_cobranca,
        };
      })
    );
    return { assinaturas: linhas };
  });

  // GET /admin/api/planos — catálogo pro filtro "Plano ▾" da tela de
  // Tenants. Existe `/api/planos` (rota pública, US67, cima deste arquivo)
  // com o mesmo dado, mas o frontend admin chama tudo com prefixo `/api/...`
  // que o proxy do host admin reescreve pra `/admin/api/...` (mesma
  // convenção de todas as outras rotas admin) — não dá pra reaproveitar a
  // rota pública direto por causa dessa reescrita. Só o cache em memória
  // (PLANOS_CACHE), sem consulta ao banco.
  fastify.get('/admin/api/planos', { preHandler: [fastify.authenticateAdmin] }, async () => {
    return {
      planos: planos.obterTodos()
        .filter((p) => p.ativo)
        .sort((a, b) => Number(a.preco_mensal) - Number(b.preco_mensal))
        .map((p) => ({ chave: p.chave, nome: p.nome })),
    };
  });
}

module.exports = { registerAdminTenantsRoutes };
