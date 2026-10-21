// US68.2 — webhook do WhatsApp — extraído de index.js (fase 11 da
// modularização, a última): GET /webhook/whatsapp (handshake da Meta),
// POST /webhook/whatsapp (roteador: IA Engine pra tecnologia='ia', repasse
// pro n8n pra tecnologia='bot').
const metaWhatsappService = require('../meta-whatsapp-service');
const { processarMensagemIA } = require('../lib/ia-engine');
const { detectarOptOut, confirmarAgendamentoPorBotao } = require('../lib/automacoes');

// Achado numa avaliação do bot (2026-08-19): antes, qualquer exceção não
// tratada no pipeline (Anthropic fora do ar, timeout, erro de banco) só
// era logada — o cliente nunca recebia nada de volta, parecendo que o
// salão tinha ignorado a mensagem dele. Ver uso no handler POST
// /webhook/whatsapp.
const MENSAGEM_ERRO_GENERICO_IA = 'Desculpa, tive um probleminha aqui agora. Pode mandar sua mensagem de novo em instantes? 🙏';

// Botões de resposta rápida (payload fixo, configurado no template aprovado
// na Meta — Business Manager > WhatsApp Manager > Templates): a Confirmação
// de agenda ganha "Confirmar"/"Remarcar", e Aniversário do cliente/Clientes
// inativos ganham "Agendar atendimento". O payload não carrega o id do
// agendamento (Quick Reply buttons de template não suportam parâmetro
// dinâmico por envio) — o alvo é sempre resolvido pelo telefone de quem
// respondeu (ver confirmarAgendamentoPorBotao / processarMensagemIA).
const BOTAO_CONFIRMAR = 'CONFIRMAR';
const BOTAO_REMARCAR = 'REMARCAR';
const BOTAO_AGENDAR = 'AGENDAR';
const MENSAGEM_CONFIRMAR_SEM_ATENDIMENTO = 'Não encontrei nenhum agendamento seu aguardando confirmação por aqui. Se quiser marcar um horário, é só me chamar! 😊';
// Aceita o payload fixo (CONFIRMAR/REMARCAR/AGENDAR) ou o texto do botão
// ("Agendar atendimento", "Confirmar", "Remarcar"), sem acento/caixa. Devolve
// null pra payload vazio ou desconhecido.
function normalizarBotao(valor) {
  const t = String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  if (t.startsWith('CONFIRMAR')) return BOTAO_CONFIRMAR;
  if (t.startsWith('REMARCAR')) return BOTAO_REMARCAR;
  if (t.startsWith('AGENDAR')) return BOTAO_AGENDAR;
  return null;
}
function mensagemConfirmarSucesso(ag) {
  const primeiroNome = ag.cliente ? `, ${ag.cliente.split(' ')[0]}` : '';
  return `Prontinho${primeiroNome}! Seu horário de ${ag.servico} com ${ag.profissional} está confirmado. Até lá! 💜`;
}

function registerWebhookWhatsappRoutes(fastify, pool) {
  const TENANT_CAMPOS_WEBHOOK = `id, nome, telefone, meta_phone_number_id, tecnologia,
                dias_funcionamento, horario_abertura, horario_fechamento,
                horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim,
                onboarding_horario_revisado, feriados_bloqueados,
                ia_janela_encerramento_minutos`;

  // US68.2 — handshake de verificação do webhook da Meta (App Dashboard →
  // WhatsApp → Configuração → Webhook, chamado uma vez ao salvar a URL e
  // sempre que a Meta reconfirma a assinatura). Mesma lógica que já existia
  // dentro do n8n (workflow v4) — token comparado com META_VERIFY_TOKEN,
  // resposta é o challenge cru (texto puro, não JSON).
  fastify.get('/webhook/whatsapp', async (request, reply) => {
    const query = request.query || {};
    const valido = query['hub.mode'] === 'subscribe'
      && !!process.env.META_VERIFY_TOKEN
      && query['hub.verify_token'] === process.env.META_VERIFY_TOKEN;
    if (!valido) return reply.code(403).send('Forbidden');
    return reply.code(200).type('text/plain').send(query['hub.challenge'] || '');
  });

  // US68.2 — roteador: recebe o webhook da Meta Cloud API no lugar do n8n e
  // decide, por tenant.tecnologia, se processa pelo IA Engine (US68) ou
  // repassa sem alteração pro n8n (fluxo de bot atual, intocado). Sem auth — é um
  // webhook externo, mesmo padrão de rota pública já usado em /api/planos.
  // Tenant desconhecido/inativo, evento sem mensagem (ex.: status de
  // entrega) ou qualquer erro no processamento cai no repasse pro n8n —
  // nunca perde o evento silenciosamente nem quebra o fluxo de bot.
  fastify.post('/webhook/whatsapp', async (request, reply) => {
    const body = request.body || {};
    const ehMeta = body.object === 'whatsapp_business_account';
    const change = ehMeta ? (((body.entry || [])[0] || {}).changes || [])[0] : null;
    const value = change ? change.value : null;

    let tenant = null;
    let telefone = null;
    let mensagem = null;
    let botaoPayload = null;
    let pushName = null;
    let enviarResposta = null;

    if (ehMeta && value) {
      const phoneNumberId = value.metadata && value.metadata.phone_number_id;
      const msg = (value.messages || [])[0];
      // 'button' = clique num botão de resposta rápida de um template
      // (Confirmação de agenda/Aniversário/Clientes inativos, ver
      // lib/automacoes.js) — a Meta manda o payload configurado no template
      // em `msg.button.payload`, sem texto livre nenhum.
      if (phoneNumberId && msg && (msg.type === 'text' || msg.type === 'button' || msg.type === 'interactive')) {
        const { rows } = await pool.query(
          `SELECT ${TENANT_CAMPOS_WEBHOOK} FROM tenants WHERE meta_phone_number_id = $1 AND ativo = true LIMIT 1`,
          [phoneNumberId]
        );
        tenant = rows[0] || null;
        telefone = msg.from;
        if (msg.type === 'text') {
          mensagem = (msg.text && msg.text.body) || '';
        } else if (msg.type === 'button') {
          // Template criado sem payload customizado: a Meta devolve o texto do
          // botão em `payload` (ou só em `text`) — normalizarBotao cobre os dois.
          botaoPayload = normalizarBotao((msg.button && (msg.button.payload || msg.button.text)) || '');
        } else {
          const resp = msg.interactive && msg.interactive.button_reply;
          botaoPayload = normalizarBotao((resp && (resp.id || resp.title)) || '');
        }
        if (msg.type !== 'text' && !botaoPayload) {
          fastify.log.warn({ tipo: msg.type, button: msg.button, interactive: msg.interactive }, 'Clique em botão do WhatsApp com payload não reconhecido');
        }
        const contato = (value.contacts || [])[0];
        pushName = (contato && contato.profile && contato.profile.name) || null;
        enviarResposta = (numero, texto) => metaWhatsappService.enviarTexto(tenant.meta_phone_number_id, numero, texto);
      }
      // Sem messages[0] (ex.: webhook de status "delivered"/"read") ou sem
      // phone_number_id: não há o que processar — cai no repasse abaixo, que
      // é inofensivo (o n8n também ignora esses eventos na mesma condição).
    }

    // Opt-out das automações (lib/automacoes.js): cliente que responde
    // "PARAR"/"SAIR"/... entra na lista e não recebe mais mensagem proativa.
    // Escopo do tenant (cada tenant do Studio tem seu número). Não muda o
    // fluxo da conversa — segue pro IA/n8n normalmente.
    if (tenant && telefone && detectarOptOut(mensagem)) {
      pool.query(
        `UPDATE clientes SET whatsapp_opt_out = true, whatsapp_opt_out_em = now()
         WHERE tenant_id = $1 AND telefone = $2 AND whatsapp_opt_out = false`,
        [tenant.id, String(telefone).replace(/\D/g, '')]
      ).catch((err) => fastify.log.error({ err: err.message, tenantId: tenant.id }, 'automacao opt-out'));
    }

    // Botão de resposta rápida — só tenants no motor de IA por ora
    // (tecnologia='bot'/n8n tem workflow próprio, edição separada, fora
    // deste repositório). "Confirmar" é ação direta (sem IA); "Remarcar" e
    // "Agendar atendimento" viram uma mensagem sintética pro MESMO motor
    // conversacional que já sabe reagendar/agendar em linguagem natural —
    // reaproveita listar horários livres, confirmar com o cliente e
    // encerrar com uma resposta natural, sem duplicar esse fluxo aqui.
    if (tenant && tenant.tecnologia === 'ia' && telefone && botaoPayload) {
      try {
        if (botaoPayload === BOTAO_CONFIRMAR) {
          const agendamento = await confirmarAgendamentoPorBotao(pool, { tenantId: tenant.id, telefone });
          await enviarResposta(telefone, agendamento ? mensagemConfirmarSucesso(agendamento) : MENSAGEM_CONFIRMAR_SEM_ATENDIMENTO);
        } else if (botaoPayload === BOTAO_REMARCAR) {
          await processarMensagemIA({ tenant, telefone, mensagem: 'Quero remarcar meu horário, pode me ajudar?', pushName, enviarResposta });
        } else if (botaoPayload === BOTAO_AGENDAR) {
          await processarMensagemIA({ tenant, telefone, mensagem: 'Quero marcar um novo horário.', pushName, enviarResposta });
        }
        return reply.code(200).send({ ok: true });
      } catch (erro) {
        fastify.log.error({ erro: erro.message, tenantId: tenant.id, botaoPayload }, 'Falha ao processar botão do WhatsApp (Confirmar/Remarcar/Agendar)');
        try {
          await enviarResposta(telefone, MENSAGEM_ERRO_GENERICO_IA);
        } catch (erroEnvio) {
          fastify.log.error({ erro: erroEnvio.message, tenantId: tenant.id }, 'Falha ao enviar mensagem de erro genérica do botão');
        }
        return reply.code(200).send({ ok: true });
      }
    }

    if (tenant && tenant.tecnologia === 'ia' && telefone && mensagem && mensagem.trim()) {
      try {
        await processarMensagemIA({ tenant, telefone, mensagem: mensagem.trim(), pushName, enviarResposta });
        return reply.code(200).send({ ok: true });
      } catch (erro) {
        fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha no IA Engine (US68) — mensagem não processada');
        // Achado numa avaliação do bot (2026-08-19): antes esse catch só
        // logava e respondia 200 pro webhook da Meta — o cliente nunca
        // recebia nada de volta, parecendo que o salão tinha ignorado a
        // mensagem dele. `enviarResposta` também pode falhar (token
        // expirado, instância desconectada) — nunca deixa essa segunda
        // falha derrubar a resposta do webhook.
        try {
          await enviarResposta(telefone, MENSAGEM_ERRO_GENERICO_IA);
        } catch (erroEnvio) {
          fastify.log.error({ erro: erroEnvio.message, tenantId: tenant.id }, 'Falha ao enviar mensagem de erro genérica da IA (US68)');
        }
        return reply.code(200).send({ ok: true });
      }
    }

    // tecnologia='bot', tenant não encontrado/inativo, evento sem mensagem,
    // ou N8N_WEBHOOK_URL ausente em dev: repassa o payload original sem
    // alteração — exatamente o que já acontecia antes deste roteador
    // existir (Meta → n8n direto, mesma URL configurada no App Dashboard).
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) return reply.code(200).send({ ok: true });
    try {
      const resposta = await fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const texto = await resposta.text();
      reply.code(resposta.status);
      try {
        return reply.send(JSON.parse(texto));
      } catch {
        return reply.send(texto);
      }
    } catch (erro) {
      fastify.log.error({ erro: erro.message }, 'Falha ao repassar webhook pro n8n (US68.2)');
      return reply.code(200).send({ ok: true });
    }
  });
}

module.exports = { registerWebhookWhatsappRoutes };
