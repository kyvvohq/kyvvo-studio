// WhatsApp (self-service, Embedded Signup da Meta) — extraído de index.js
// (fase 7 da modularização): GET /api/whatsapp/config-publica|status|conversas,
// POST /api/whatsapp/solicitar-numero-novo|conectar. Não inclui o webhook
// (/webhook/whatsapp, GET/POST) nem o IA Engine — esses ficam em index.js
// até a fase WhatsApp/IA Engine.
const metaWhatsappService = require('../meta-whatsapp-service');

function registerWhatsappConfigRoutes(fastify, pool) {
  // appId/configId não são secretos — só inicializam o SDK do Facebook no
  // frontend, por isso não têm problema em ir numa rota GET comum.
  fastify.get('/api/whatsapp/config-publica', { preHandler: [fastify.authenticate] }, async () => {
    return {
      appId: process.env.META_APP_ID || null,
      configId: process.env.META_CONFIG_ID || null,
    };
  });

  // Chama a Graph API da Meta ao vivo com o phone_number_id do tenant (não
  // um valor fixo de ambiente — cada tenant tem o seu, ver migration 033/034)
  // usando o META_WHATSAPP_TOKEN compartilhado do Usuário do Sistema.
  fastify.get('/api/whatsapp/status', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      'SELECT meta_phone_number_id, novo_numero_solicitado_em, novo_numero_ddd_preferencia FROM tenants WHERE id = $1',
      [tenantId]
    );
    const tenant = rows[0] || {};
    const phoneNumberId = tenant.meta_phone_number_id;
    const status = {
      conectado: false,
      phoneNumberId: phoneNumberId || null,
      // CA (US39.1) — front usa isso pra trocar o botão "Pedir número novo"
      // por um card de "pedido recebido" sem precisar de outra chamada.
      pedidoNumeroNovo: tenant.novo_numero_solicitado_em
        ? { solicitadoEm: tenant.novo_numero_solicitado_em, dddPreferencia: tenant.novo_numero_ddd_preferencia }
        : null,
    };
    if (!phoneNumberId) return status;

    const metaToken = process.env.META_WHATSAPP_TOKEN;
    if (!metaToken) {
      status.erro = 'META_WHATSAPP_TOKEN não configurado no servidor.';
      return status;
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v22.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${metaToken}` }, signal: AbortSignal.timeout(8000) }
      );
      const corpo = await res.json();
      if (res.ok) {
        status.conectado = true;
        status.numeroExibido = corpo.display_phone_number || null;
        status.nomeVerificado = corpo.verified_name || null;
        status.qualidade = corpo.quality_rating || null;
      } else {
        status.erro = (corpo.error && corpo.error.message) || `A Meta respondeu ${res.status}.`;
      }
    } catch (err) {
      status.erro = `Falha ao contatar a Meta: ${err.message}`;
    }
    return status;
  });

  // Lista de conversas do WhatsApp (submenu Configurações > WhatsApp) — um
  // registro por cliente, com a atividade mais recente em `conversas_ia`.
  // Só tem dados reais pra tenants em modo IA (conversas_ia só é populada
  // por processarMensagemIA); tenants em modo bot (menus) devolvem lista
  // vazia, o que é esperado, não um bug — o bot de menus não guarda
  // transcript de conversa nesse formato.
  fastify.get('/api/whatsapp/conversas', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows: tenantRows } = await pool.query('SELECT nome FROM tenants WHERE id = $1', [tenantId]);
    const tenantNome = tenantRows[0] ? tenantRows[0].nome : null;

    const { rows } = await pool.query(
      `SELECT c.id AS cliente_id, c.nome, c.telefone, c.status_conversa, MAX(ci.criado_em) AS ultima_mensagem_em
       FROM clientes c
       JOIN conversas_ia ci ON ci.cliente_id = c.id
       WHERE c.tenant_id = $1
       GROUP BY c.id, c.nome, c.telefone, c.status_conversa
       ORDER BY ultima_mensagem_em DESC
       LIMIT 50`,
      [tenantId]
    );

    return {
      tenant_nome: tenantNome,
      conversas: rows.map((r) => ({
        cliente_id: r.cliente_id,
        cliente_nome: r.nome,
        telefone: r.telefone,
        status_conversa: r.status_conversa,
        ultima_mensagem_em: r.ultima_mensagem_em,
      })),
    };
  });

  // Histórico completo de uma conversa (popup ao clicar numa linha da
  // listagem acima). Mensagens role='user' já são texto puro; role='assistant'
  // são gravadas como JSON ({intent, params, resposta}, ver
  // salvarMensagemIA/processarMensagemIA em lib/ia-engine.js — de propósito,
  // pra não vazar o histórico de resposta em linguagem natural de volta pro
  // prompt da IA) — aqui extrai só `resposta` pra exibir como texto normal.
  fastify.get('/api/whatsapp/conversas/:clienteId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { clienteId } = request.params;

    const { rows: clienteRows } = await pool.query(
      'SELECT nome, telefone, status_conversa, handoff_devolvido_em FROM clientes WHERE id = $1 AND tenant_id = $2',
      [clienteId, tenantId]
    );
    const cliente = clienteRows[0];
    if (!cliente) {
      return reply.code(404).send({ error: 'Cliente não encontrado' });
    }

    const { rows } = await pool.query(
      `SELECT role, conteudo, criado_em FROM conversas_ia
       WHERE tenant_id = $1 AND cliente_id = $2
       ORDER BY criado_em ASC`,
      [tenantId, clienteId]
    );

    const mensagens = rows.map((r) => {
      if (r.role !== 'assistant') {
        return { role: r.role, texto: r.conteudo, criado_em: r.criado_em };
      }
      try {
        const parsed = JSON.parse(r.conteudo);
        return { role: r.role, texto: parsed.resposta ?? r.conteudo, criado_em: r.criado_em };
      } catch {
        return { role: r.role, texto: r.conteudo, criado_em: r.criado_em };
      }
    });

    return {
      cliente: {
        nome: cliente.nome,
        telefone: cliente.telefone,
        status_conversa: cliente.status_conversa,
        // Preenchido pelo worker de retorno automático (lib/worker-handoff.js)
        // quando ele devolve a conversa ao bot por timeout; limpo quando o
        // salão retoma manualmente. O front usa isso pra avisar que a
        // devolução foi automática, não feita por alguém da equipe.
        handoff_devolvido_em: cliente.handoff_devolvido_em,
      },
      mensagens,
    };
  });

  // Atendimento humano ao vivo — "Assumir atendimento" (janela de chat em
  // atendimento.html). Qualquer membro da equipe pode assumir, não só admin
  // (mesmo critério de GET /api/whatsapp/conversas). Marca status_conversa
  // pra suspender a resposta automática da IA (ver processarMensagemIA em
  // lib/ia-engine.js) sem mexer em mais nada.
  fastify.post('/api/whatsapp/conversas/:clienteId/assumir', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { clienteId } = request.params;
    const { rowCount } = await pool.query(
      "UPDATE clientes SET status_conversa = 'aguardando_humano', aguardando_humano_desde = now() WHERE id = $1 AND tenant_id = $2",
      [clienteId, tenantId]
    );
    if (!rowCount) return reply.code(404).send({ error: 'Cliente não encontrado' });
    return { ok: true, status_conversa: 'aguardando_humano' };
  });

  // "Devolver pra IA" e "Concluir atendimento" caem aqui — mesmo efeito no
  // banco (status_conversa volta a 'ativo', a IA responde de novo), só muda
  // a intenção de quem clicou; não há um terceiro status pra distinguir
  // "concluído" de "devolvido", de propósito (decisão explícita — evita
  // migração/estado extra pra uma distinção que não muda nenhum
  // comportamento do sistema).
  fastify.post('/api/whatsapp/conversas/:clienteId/liberar', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { clienteId } = request.params;
    // Retomada manual pelo salão: zera o cronômetro do handoff e também o
    // marcador de devolução automática (se a conversa tinha voltado pro bot
    // sozinha antes, agora quem está no controle é a equipe de novo).
    const { rowCount } = await pool.query(
      "UPDATE clientes SET status_conversa = 'ativo', aguardando_humano_desde = NULL, handoff_devolvido_em = NULL WHERE id = $1 AND tenant_id = $2",
      [clienteId, tenantId]
    );
    if (!rowCount) return reply.code(404).send({ error: 'Cliente não encontrado' });
    return { ok: true, status_conversa: 'ativo' };
  });

  // Mensagem manual do atendente durante atendimento humano (janela de
  // atendimento ao vivo, atendimento.html) — envia de verdade pelo WhatsApp
  // do salão (mesmo enviarTexto usado pela IA) e grava em conversas_ia com
  // role='assistant' (mesma role da IA — do ponto de vista do histórico
  // enviado pra Claude, é o mesmo "turno" de resposta; o texto puro em vez
  // do JSON {intent,...} cai no catch/fallback do parse acima, que já exibe
  // como texto normal quando o JSON.parse falha).
  fastify.post('/api/whatsapp/conversas/:clienteId/mensagem', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { clienteId } = request.params;
    const { texto } = request.body || {};
    if (!texto || !texto.trim()) {
      return reply.code(400).send({ error: 'Mensagem vazia' });
    }

    const { rows: clienteRows } = await pool.query(
      'SELECT nome, telefone FROM clientes WHERE id = $1 AND tenant_id = $2',
      [clienteId, tenantId]
    );
    const cliente = clienteRows[0];
    if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado' });

    const { rows: tenantRows } = await pool.query('SELECT meta_phone_number_id FROM tenants WHERE id = $1', [tenantId]);
    const phoneNumberId = tenantRows[0] && tenantRows[0].meta_phone_number_id;
    if (!phoneNumberId) {
      return reply.code(409).send({ error: 'WhatsApp não conectado.' });
    }

    try {
      await metaWhatsappService.enviarTexto(phoneNumberId, cliente.telefone, texto.trim());
    } catch (erro) {
      return reply.code(502).send({ error: `Falha ao enviar pelo WhatsApp: ${erro.message}` });
    }

    await pool.query(
      `INSERT INTO conversas_ia (tenant_id, cliente_id, role, conteudo) VALUES ($1, $2, 'assistant', $3)`,
      [tenantId, clienteId, texto.trim()]
    );
    // Defensivo — mensagem manual só faz sentido em atendimento humano;
    // garante o estado certo mesmo se a janela for aberta sem passar pelo
    // /assumir antes (ex.: aba antiga reaberta). coalesce pra não reiniciar
    // o cronômetro do handoff se ele já estava rodando.
    await pool.query("UPDATE clientes SET status_conversa = 'aguardando_humano', aguardando_humano_desde = coalesce(aguardando_humano_desde, now()) WHERE id = $1", [clienteId]);

    return { ok: true };
  });

  // CA (US39.1) — pedido de "Novo número": passos 2/3 da jornada (coleta de
  // dados mínimos + confirmação de expectativa, sem prometer SLA). Os outros
  // dados mínimos (nome do negócio, telefone, segmento, horário) já foram
  // coletados no cadastro — só registra a preferência de DDD e o timestamp,
  // pra a operação ver quem está esperando (aparece em GET
  // /admin/api/tenants/:id, e o vínculo do número em si já é feito por
  // /admin/api/numeros-prontos/:id/vincular, ver migration 037).
  // US62 — conectar/trocar o WhatsApp do negócio é configuração do negócio,
  // restrita ao administrador (status/config pública continuam livres).
  fastify.post('/api/whatsapp/solicitar-numero-novo', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { ddd_preferencia: dddPreferencia } = request.body || {};

    const { rows } = await pool.query(
      'SELECT nome, telefone, segmento, horario_abertura, horario_fechamento, meta_phone_number_id, novo_numero_solicitado_em FROM tenants WHERE id = $1',
      [tenantId]
    );
    const tenant = rows[0];
    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant não encontrado.' });
    }
    if (tenant.meta_phone_number_id) {
      return reply.code(409).send({ error: 'Este salão já tem um número de WhatsApp conectado.' });
    }
    if (tenant.novo_numero_solicitado_em) {
      return reply.code(409).send({ error: 'Você já pediu um número novo. Nossa equipe vai avisar quando estiver pronto.' });
    }

    const { rows: atualizadoRows } = await pool.query(
      `UPDATE tenants SET novo_numero_ddd_preferencia = $2, novo_numero_solicitado_em = now()
       WHERE id = $1
       RETURNING nome, telefone, segmento, horario_abertura, horario_fechamento, novo_numero_ddd_preferencia, novo_numero_solicitado_em`,
      [tenantId, dddPreferencia || null]
    );
    return atualizadoRows[0];
  });

  // Recebe o resultado do Embedded Signup (code + waba_id + phone_number_id,
  // vindos do postMessage/callback do FB.login no frontend). Troca o code
  // por um token de curta duração pra assinar os webhooks dessa WABA e
  // atribuir o Usuário do Sistema compartilhado a ela (sem essa atribuição,
  // qualquer chamada futura com META_WHATSAPP_TOKEN nessa WABA/número volta
  // com "missing permissions" — ver atribuirUsuarioSistema). O
  // envio/recebimento de mensagem continua usando o Usuário do Sistema
  // compartilhado (ver comentário em meta-whatsapp-service.js). O token do
  // cliente não é persistido, só usado nesta chamada.
  fastify.post('/api/whatsapp/conectar', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { code, wabaId, phoneNumberId } = request.body || {};

    if (!code || !wabaId || !phoneNumberId) {
      return reply.code(400).send({ error: 'Dados incompletos retornados pelo WhatsApp. Tente conectar novamente.' });
    }

    try {
      const { access_token: tokenCliente } = await metaWhatsappService.trocarCodePorToken(code);
      await metaWhatsappService.assinarWebhooks(wabaId, tokenCliente);
      try {
        const resultado = await metaWhatsappService.atribuirUsuarioSistema(wabaId, tokenCliente);
        console.log(`[whatsapp] atribuição do Usuário do Sistema à waba ${wabaId} (tenant ${tenantId}): ${JSON.stringify(resultado)}`);
      } catch (erroAtribuicao) {
        // Best-effort — pode depender de aprovação/config pendente do lado da
        // Meta (ver "Status Pendente" no App Dashboard); não impede a conexão
        // de ser salva. Sem essa atribuição, chamadas futuras com
        // META_WHATSAPP_TOKEN nessa WABA/número continuam com permissão
        // negada até a Meta liberar.
        console.error(`[whatsapp] falha ao atribuir Usuário do Sistema à waba ${wabaId} do tenant ${tenantId}: ${erroAtribuicao.message}`);
      }
      try {
        await metaWhatsappService.registrarNumero(phoneNumberId);
      } catch (erroRegistro) {
        // Best-effort — o número pode já vir registrado dependendo da
        // configuração do Embedded Signup; não impede a conexão de ser salva.
        console.error(`[whatsapp] falha ao registrar número ${phoneNumberId} do tenant ${tenantId}: ${erroRegistro.message}`);
      }
    } catch (erro) {
      return reply.code(400).send({ error: `Não foi possível conectar o WhatsApp: ${erro.message}` });
    }

    try {
      await pool.query('UPDATE tenants SET meta_waba_id = $2, meta_phone_number_id = $3 WHERE id = $1', [
        tenantId,
        wabaId,
        phoneNumberId,
      ]);
    } catch (erro) {
      if (erro.code === '23505') {
        return reply.code(409).send({ error: 'Esse número de WhatsApp já está conectado a outra conta Kyvvo.' });
      }
      throw erro;
    }

    return { conectado: true, phoneNumberId, wabaId };
  });
}

module.exports = { registerWhatsappConfigRoutes };
