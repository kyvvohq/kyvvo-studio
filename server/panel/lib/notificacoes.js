// Serviço de notificações — registro de tipos + cálculo dos pendentes de um
// tenant. Pensado pra crescer sem precisar de endpoint novo a cada tipo: o
// balão (GET /api/notificacoes, routes/notificacoes.js) e a tela
// Configurações > Notificações (GET/PATCH /api/configuracao, campo
// notificacoes_ativas) leem esta lista, não um tipo hard-coded.
//
// Cada tipo: `chave` (persistida em tenants.notificacoes_ativas, formato
// {"<chave>": {"canais": {"studio","email","whatsapp"}, ...params}}), `titulo`
// (rótulo na tela de Configurações e no dropdown do balão) e, ou:
// - `calcular(pool, tenantId, config)` -> array de itens pendentes AGORA
//   (tipos "de estado", ex.: disparos acabando — recalculado a cada consulta,
//   sem persistir nada); ou
// - `eventoUnico: true` -> não tem "calcular": o item é registrado uma vez
//   (dispararNotificacaoEvento, chamado no momento em que o fato acontece:
//   agendamento criado/confirmado/remarcado) na tabela notificacoes_eventos e
//   listado dali pro canal Studio.
const planosCatalogo = require('./planos');

const LIMIAR_DISPAROS_PADRAO = 10;

const TIPOS_NOTIFICACAO = [
  {
    chave: 'whatsapp_aguardando_humano',
    titulo: 'Conversas de WhatsApp aguardando atendimento humano',
    async calcular(pool, tenantId) {
      const { rows } = await pool.query(
        `SELECT id, nome, telefone, aguardando_humano_desde FROM clientes
         WHERE tenant_id = $1 AND status_conversa = 'aguardando_humano'
         ORDER BY aguardando_humano_desde ASC`,
        [tenantId]
      );
      return rows.map((c) => ({
        id: c.id,
        titulo: c.nome || c.telefone,
        detalhe: 'aguardando atendimento humano',
        desde: c.aguardando_humano_desde,
      }));
    },
  },
  {
    chave: 'disparos_acabando',
    titulo: 'Disparos de WhatsApp acabando',
    // Descreve o campo numérico extra pra Configurações > Notificações
    // montar o input sem precisar de endpoint próprio só pra isso.
    campoNumerico: { chave: 'limiar', label: 'Avisar quando restarem apenas', sufixo: 'disparos WhatsApp', padrao: LIMIAR_DISPAROS_PADRAO },
    async calcular(pool, tenantId, config) {
      const { rows: tenantRows } = await pool.query('SELECT plano FROM tenants WHERE id = $1', [tenantId]);
      const plano = tenantRows[0] && planosCatalogo.obterPlano(tenantRows[0].plano);
      // Plano sem limite (a maioria hoje) nunca "acaba" — mesmo critério de
      // limiteDoPlanoExcedido (lib/automacoes.js).
      if (!plano || plano.limite_disparos == null) return [];

      const { rows } = await pool.query(
        `SELECT count(*)::int AS total FROM whatsapp_disparos
         WHERE tenant_id = $1 AND status = 'enviado' AND criado_em >= date_trunc('month', now())`,
        [tenantId]
      );
      const usados = rows[0].total;
      const restante = plano.limite_disparos - usados;
      const limiarConfigurado = Number(config && config.limiar);
      const limiar = limiarConfigurado > 0 ? limiarConfigurado : LIMIAR_DISPAROS_PADRAO;
      if (restante > limiar) return [];

      return [{
        id: tenantId,
        titulo: `Restam ${Math.max(restante, 0)} disparo(s) de WhatsApp este mês`,
        detalhe: `${usados} de ${plano.limite_disparos} usados`,
      }];
    },
  },
  { chave: 'agenda_criada', titulo: 'Novo agendamento criado', eventoUnico: true },
  { chave: 'agenda_confirmada', titulo: 'Agendamento confirmado', eventoUnico: true },
  { chave: 'agenda_remarcada', titulo: 'Agendamento remarcado', eventoUnico: true },
];

// Formato novo: {"canais": {"studio","email","whatsapp"}, ...}. Formato
// antigo (tenants que nunca abriram a tela redesenhada): {"ativo": bool},
// sem canal explícito — tratado como "só Studio", que é o que sempre existiu
// até aqui (nunca houve envio real de e-mail/WhatsApp pra estes avisos).
function canaisAtivos(cfg) {
  if (cfg && cfg.canais && typeof cfg.canais === 'object' && !Array.isArray(cfg.canais)) {
    return {
      studio: cfg.canais.studio !== false,
      email: !!cfg.canais.email,
      whatsapp: !!cfg.canais.whatsapp,
    };
  }
  return { studio: cfg ? cfg.ativo !== false : true, email: false, whatsapp: false };
}

// --- Envio real (E-mail/WhatsApp), além do Studio (sino in-app) ----------
// Mesmos provedores de token-service.js (Resend/Meta Cloud API), sem o
// conceito de token de 6 dígitos — mensagem livre. Best-effort: nunca lança,
// cai num modo de log sem as variáveis de ambiente (mesmo espírito de
// token-service.js), pra funcionar em dev/homologação sem serviço externo.
async function enviarEmailNotificacao(email, assunto, corpoTexto) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Kyvvo <no-reply@kyvvo.com.br>';
  if (!apiKey) {
    console.log(`[notificacoes] (dev) e-mail para ${email} — ${assunto}: ${corpoTexto}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: assunto,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111"><p>${corpoTexto}</p></div>`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[notificacoes] Resend respondeu ${res.status} ao enviar para ${email}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notificacoes] Falha ao enviar e-mail para ${email}: ${err.message}`);
    return false;
  }
}

async function enviarWhatsappNotificacao(whatsappNacional, texto) {
  if (!whatsappNacional) return false;
  const apiToken = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!apiToken || !phoneNumberId) {
    console.log(`[notificacoes] (dev) WhatsApp para 55${whatsappNacional}: ${texto}`);
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `55${whatsappNacional}`,
        type: 'text',
        text: { body: texto },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.error(`[notificacoes] Meta WhatsApp API respondeu ${res.status} ao enviar para 55${whatsappNacional}: ${corpo}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notificacoes] Falha ao enviar WhatsApp para 55${whatsappNacional}: ${err.message}`);
    return false;
  }
}

// Dispara uma notificação de EVENTO ÚNICO (agenda criada/confirmada/
// remarcada — diferente dos tipos "de estado" acima). Chamado no momento em
// que o fato acontece (routes/agenda.js, lib/ia-engine.js, lib/automacoes.js
// no botão "Confirmar" do WhatsApp). Best-effort de propósito (try/catch
// amplo): nunca deve interromper a criação/atualização do agendamento que
// disparou a notificação. `referenciaDataHora` (opcional) é o data_hora do
// agendamento em questão — guardado pra "abrir na data certa" ao clicar no
// item no balão (ver GET /api/notificacoes e o clique em app.js).
async function dispararNotificacaoEvento(pool, tenantId, chave, { titulo, detalhe, referenciaDataHora }) {
  try {
    const { rows: tenantRows } = await pool.query('SELECT notificacoes_ativas, whatsapp FROM tenants WHERE id = $1', [tenantId]);
    const tenant = tenantRows[0];
    if (!tenant) return;
    const cfg = (tenant.notificacoes_ativas || {})[chave];
    const canais = canaisAtivos(cfg);

    if (canais.studio) {
      await pool.query(
        'INSERT INTO notificacoes_eventos (tenant_id, chave, titulo, detalhe, referencia_data_hora) VALUES ($1, $2, $3, $4, $5)',
        [tenantId, chave, titulo, detalhe || null, referenciaDataHora || null]
      );
    }
    if (canais.email) {
      const { rows: adminRows } = await pool.query(
        `SELECT email FROM usuarios WHERE tenant_id = $1 AND role = 'administrador' ORDER BY criado_em ASC LIMIT 1`,
        [tenantId]
      );
      if (adminRows[0]) enviarEmailNotificacao(adminRows[0].email, titulo, detalhe || titulo).catch(() => {});
    }
    if (canais.whatsapp) {
      enviarWhatsappNotificacao(tenant.whatsapp, detalhe ? `${titulo}\n${detalhe}` : titulo).catch(() => {});
    }
  } catch (err) {
    console.error(`[notificacoes] Falha ao disparar evento "${chave}" pro tenant ${tenantId}: ${err.message}`);
  }
}

// Chave ausente em `notificacoesAtivas` conta como ativa no Studio (default
// seguro, mesmo comportamento de sempre) — só desliga com o canal Studio
// explicitamente desmarcado. Tipos sem nenhum item pendente/evento não lido
// não entram no resultado. Eventos já marcados como lidos somem daqui (ver
// marcarNotificacaoLida) — "pendente" agora é de verdade "não visto ainda",
// não só "dos últimos 7 dias".
async function listarNotificacoesPendentes(pool, tenantId, notificacoesAtivas) {
  const todasConfigs = notificacoesAtivas || {};
  const resultado = [];
  for (const tipo of TIPOS_NOTIFICACAO) {
    const config = todasConfigs[tipo.chave] || {};
    const canais = canaisAtivos(config);
    if (!canais.studio) continue;

    if (tipo.eventoUnico) {
      // eslint-disable-next-line no-await-in-loop
      const { rows } = await pool.query(
        `SELECT id, titulo, detalhe, criado_em, referencia_data_hora FROM notificacoes_eventos
         WHERE tenant_id = $1 AND chave = $2 AND lida = false
         ORDER BY criado_em DESC LIMIT 20`,
        [tenantId, tipo.chave]
      );
      if (rows.length) {
        resultado.push({
          tipo: tipo.chave,
          titulo: tipo.titulo,
          eventoUnico: true,
          itens: rows.map((r) => ({
            id: r.id, titulo: r.titulo, detalhe: r.detalhe, desde: r.criado_em,
            dataAgendamento: r.referencia_data_hora,
          })),
        });
      }
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const itens = await tipo.calcular(pool, tenantId, config);
    if (itens.length) resultado.push({ tipo: tipo.chave, titulo: tipo.titulo, eventoUnico: false, itens });
  }
  return resultado;
}

// "Marcar como lida" — só existe pros tipos orientados a evento (só eles têm
// uma linha real em notificacoes_eventos; os "de estado" — whatsapp_
// aguardando_humano/disparos_acabando — são recalculados a cada consulta,
// não têm o que marcar). Escopado por tenant_id (nunca deixa marcar/ver linha
// de outro tenant) e `lida = false` na condição evita um segundo UPDATE
// inofensivo, mas também deixa o RETURNING vazio indicar "não achou" pro
// chamador (id errado ou já lida).
async function marcarNotificacaoLida(pool, tenantId, id) {
  const { rows } = await pool.query(
    `UPDATE notificacoes_eventos SET lida = true, lida_em = now()
     WHERE id = $1 AND tenant_id = $2 AND lida = false
     RETURNING id`,
    [id, tenantId]
  );
  return rows.length > 0;
}

async function marcarTodasNotificacoesLidas(pool, tenantId) {
  const { rowCount } = await pool.query(
    `UPDATE notificacoes_eventos SET lida = true, lida_em = now() WHERE tenant_id = $1 AND lida = false`,
    [tenantId]
  );
  return rowCount;
}

// Histórico completo (lidas + não lidas) dos tipos orientados a evento — aba
// "Histórico" da tela Configurações > Notificações. Sem filtro de canal
// ativo de propósito (é um log/auditoria do que já aconteceu, não uma lista
// de pendências — um tipo desligado depois não deve apagar o que já foi
// registrado antes). Limite de 200 é só uma trava de bom senso.
async function listarHistoricoNotificacoes(pool, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, chave, titulo, detalhe, criado_em, lida, lida_em, referencia_data_hora
     FROM notificacoes_eventos
     WHERE tenant_id = $1
     ORDER BY criado_em DESC LIMIT 200`,
    [tenantId]
  );
  const tituloPorChave = Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t.chave, t.titulo]));
  return rows.map((r) => ({
    id: r.id,
    tipo: r.chave,
    tipoTitulo: tituloPorChave[r.chave] || r.chave,
    titulo: r.titulo,
    detalhe: r.detalhe,
    criadoEm: r.criado_em,
    lida: r.lida,
    lidaEm: r.lida_em,
    dataAgendamento: r.referencia_data_hora,
  }));
}

module.exports = {
  TIPOS_NOTIFICACAO,
  canaisAtivos,
  listarNotificacoesPendentes,
  dispararNotificacaoEvento,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
  listarHistoricoNotificacoes,
};
