// Conta do tenant logado — extraído de index.js (fase 10 da modularização):
// GET /api/tenant/status, POST /api/onboarding/dispensar, POST /api/eventos.
const tokenService = require('../token-service');
const configSistema = require('../lib/configuracoes-sistema');
const { calcularTrialTenant, calcularBloqueioAssinatura } = require('../lib/trial-conta');
const { EVENTOS_ANALYTICS_TIPOS_FRONTEND, registrarEvento } = require('../lib/eventos');

// "Trocar de produto" no menu de perfil: outros produtos Kyvvo que o MESMO
// tenant também tem ativo (ex.: um salão que também usa o CRM). A fonte de
// verdade de módulos cross-produto é o kyvvo-platform, mas seu Postgres
// (schema `platform`) vive no MESMO banco físico que este serviço já usa
// (mesma DATABASE_URL, schemas irmãos) — dá pra consultar direto pelo pool
// já existente, sem round-trip HTTP nem serviço/segredo novo. Best-effort de
// propósito (try/catch): se a role de banco deste serviço não tiver SELECT
// no schema platform, ou a tabela mudar de formato num deploy futuro do
// kyvvo-platform, o item de menu simplesmente não aparece — nunca deve
// quebrar o carregamento do painel por causa disso.
const PRODUTOS_CRUZADOS = {
  crm: { nome: 'CRM', url: 'https://crm.kyvvo.com.br' },
  people: { nome: 'People', url: 'https://people.kyvvo.com.br' },
};

async function buscarOutrosProdutos(pool, tenantId) {
  try {
    const { rows } = await pool.query(
      'SELECT modulo_key FROM platform.tenant_modulos WHERE tenant_id = $1 AND ativo AND modulo_key = ANY($2::text[])',
      [tenantId, Object.keys(PRODUTOS_CRUZADOS)]
    );
    return rows.map((r) => PRODUTOS_CRUZADOS[r.modulo_key]);
  } catch {
    return [];
  }
}

function registerContaRoutes(fastify, pool) {
  // Status do tenant logado: usado pela tela de validação e pelo banner de
  // trial no portal (CA09). Devolve dias restantes do trial.
  fastify.get('/api/tenant/status', { preHandler: [fastify.authenticate] }, async (request) => {
    const { userId, tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT u.email, u.email_verified, u.role, t.status, t.plano, t.trial_expires_at, t.ativado_em,
              t.status_alterado_em, t.acesso_ate,
              t.onboarding_horario_revisado, t.onboarding_dispensado
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    const info = rows[0] || {};
    // BUG (achado na US52) — `dias_restantes` era calculado a partir de
    // `trial_expires_at` (fixado no momento do cadastro), enquanto o trial
    // que de fato vale pra cobrança/bloqueio é `ativado_em + TRIAL_DIAS`
    // (US31/calcularTrialTenant, `ativado_em` só é setado quando o e-mail é
    // verificado). Um tenant que demorasse pra verificar via aqui um trial
    // mais curto (ou já "expirado") do que o que realmente estava valendo.
    // Unifica no mesmo cálculo usado no resto do sistema.
    const trial = calcularTrialTenant(info);
    // Motivo de bloqueio (mesma fonte de verdade de `authenticate`) — o
    // frontend usa isso pra redirecionar pra /bloqueio.html antes mesmo de
    // tropeçar num 403 de alguma outra rota.
    const bloqueioMotivo = calcularBloqueioAssinatura(info);

    // US59 — dados pros avisos contextuais do painel (CA "trial, configuração
    // incompleta e cobrança pendente"): sem serviço/profissional cadastrado
    // ou WhatsApp desconectado, o tenant não consegue receber agendamento
    // nenhum pelo bot, então vale nudge mesmo fora do dashboard.
    const { rows: contagem } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL) AS servicos,
         (SELECT COUNT(*)::int FROM profissionais WHERE tenant_id = $1) AS profissionais,
         (SELECT meta_phone_number_id FROM tenants WHERE id = $1) AS meta_phone_number_id`,
      [tenantId]
    );
    const configInfo = contagem[0];
    const outrosProdutos = await buscarOutrosProdutos(pool, tenantId);

    return {
      tenant_id: tenantId,
      email: info.email,
      email_mascarado: info.email ? tokenService.mascararEmail(info.email) : null,
      email_verified: !!info.email_verified,
      role: info.role,
      status: info.status,
      plano: info.plano,
      trial_ativo: trial.trialAtivo,
      dias_restantes: trial.trialDiasRestantes,
      bloqueio_motivo: bloqueioMotivo,
      suporte_email: configSistema.config.emailSuporte,
      suporte_whatsapp: configSistema.config.whatsappSuporte,
      pagamento_pendente: info.status === 'inadimplente',
      // horario_nao_confirmado (US56): diferente de sem_servicos/
      // whatsapp_desconectado, o horário de funcionamento sempre tem um
      // valor (default 08:00-20:00 da migration 014) — não dá pra detectar
      // "incompleto" por ausência de dado, só se o tenant já passou pela
      // tela de Configuração ao menos uma vez (onboarding_horario_revisado,
      // setado em PATCH /api/configuracao).
      configuracao: {
        sem_servicos: configInfo.servicos === 0,
        sem_profissionais: configInfo.profissionais === 0,
        whatsapp_desconectado: !configInfo.meta_phone_number_id,
        horario_nao_confirmado: !info.onboarding_horario_revisado,
      },
      // Com 0 ou 1 profissional, "qual profissional" nunca é uma decisão
      // real — o campo/nome só faz sentido mostrar pra quem realmente tem
      // 2+ (plano Custom). Usado pelo frontend pra esconder o campo em todo
      // lugar que mostra/pede profissional (Novo agendamento, Agenda,
      // Bloqueios, Encaixe), não só no menu Profissionais.
      mostrar_profissional: configInfo.profissionais > 1,
      onboarding_dispensado: !!info.onboarding_dispensado,
      outros_produtos: outrosProdutos,
    };
  });

  // US56 — o usuário optou por pular o checklist de onboarding por agora.
  // Só afasta o redirecionamento automático pro checklist no próximo acesso
  // (CA "usuário pode retomar o onboarding depois") — o item "Primeiros
  // passos" continua na sidebar enquanto algum passo estiver pendente.
  fastify.post('/api/onboarding/dispensar', { preHandler: [fastify.authenticate] }, async (request) => {
    await pool.query('UPDATE tenants SET onboarding_dispensado = true WHERE id = $1', [request.user.tenantId]);
    return { ok: true };
  });

  // US52 — endpoint genérico pro frontend registrar impressões do funil de
  // conversão pós-trial (aviso de vencimento, tela de bloqueio). Sem
  // requireModulo/ROTAS_LIVRES_SEM_ASSINATURA parcial: fica liberado mesmo
  // com o tenant bloqueado (é assim que "bloqueio_exibido" é registrado).
  fastify.post('/api/eventos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tipo } = request.body || {};
    if (!EVENTOS_ANALYTICS_TIPOS_FRONTEND.has(tipo)) {
      return reply.code(400).send({ error: 'Tipo de evento inválido.' });
    }
    await registrarEvento(request.user.tenantId, tipo);
    return { ok: true };
  });
}

module.exports = { registerContaRoutes };
