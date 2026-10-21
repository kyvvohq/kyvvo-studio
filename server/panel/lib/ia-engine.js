// US68 — IA Engine (motor conversacional Claude Haiku 4.5) — extraído de
// index.js (fase 11 da modularização, a última). Substitui o fluxo de bot
// por menus (n8n) pra tenants com tecnologia='ia'. O roteador
// (routes/webhook-whatsapp.js) intercepta o webhook da Meta/Evolution antes
// do n8n: tenants 'bot' são repassados sem alteração; tenants 'ia' são
// processados por este módulo. Só `processarMensagemIA` é exportada — as
// demais são privadas, chamadas só entre si dentro do próprio motor.
const { OFFSET_BRASILIA_MINUTOS } = require('./datetime');
const { dentroDoHorarioFuncionamento, buscarBloqueioConflitante } = require('./horario-funcionamento');
const { sincronizarLancamentoFinanceiro } = require('./financeiro');
const { garantirProfissionalPadrao } = require('./profissionais');
const { calcularDisponibilidadeIA, IA_DIAS_DISPONIBILIDADE, IA_DURACAO_PADRAO_MINUTOS } = require('./disponibilidade');
const { dispararNotificacaoEvento } = require('./notificacoes');
const anthropicService = require('../anthropic-service');
const { parsearIntentIA, escolherAgendamentoAlvoIA } = require('../ia-intent-parser');

// Mesma mensagem/critério do fluxo n8n (workflow v4, nó "Formatar lista de
// serviços"): tenant sem serviço ativo ou sem confirmar o horário de
// funcionamento (onboarding_horario_revisado) ainda não está pronto pra
// atender — resposta fixa, não deixa a IA decidir o que dizer.
const MENSAGEM_TENANT_NAO_PRONTO_IA = 'Estamos finalizando os últimos ajustes por aqui! 🛠️\n\nEm breve vamos te atender com muito carinho — tente novamente mais tarde.';
const IA_HISTORICO_MENSAGENS = 10;
// Depois desse intervalo sem nenhuma mensagem (de qualquer papel), a
// próxima mensagem do cliente conta como abertura de conversa nova pra fins
// de saudação — cliente que já conversou há dias e manda "oi" de novo
// também merece ser cumprimentado pelo nome, não só quem nunca falou com o
// salão (bug real: historico.length sozinho nunca zera pra quem já tem
// histórico salvo, então a saudação com nome só disparava na primeiríssima
// mensagem da vida do cliente). Configurável por tenant desde 2026-10-21
// (Configurações > Preferências, "janela de encerramento") — isto é, na
// prática, o próprio mecanismo de "encerrar o atendimento" do Studio: não
// existe um estado explícito de sessão aberta/fechada aqui (ao contrário do
// agente novo do CRM), então "encerrar" É re-cumprimentar do zero na
// próxima mensagem. Fallback (tenant sem a coluna carregada, ex. query
// antiga em teste) continua em 2h (120min), o valor fixo de antes.
const IA_JANELA_ENCERRAMENTO_MINUTOS_PADRAO = 120;

let pool;
let fastify;
function init(poolInstance, fastifyInstance) {
  pool = poolInstance;
  fastify = fastifyInstance;
}

// US68/CA02 — monta o system prompt com o contexto real do tenant (serviços,
// profissionais, disponibilidade) — a IA nunca inventa preço/horário porque
// tudo que ela pode oferecer já vem pronto aqui.
// `cliente` traz nome/data_nascimento (pra saudação e o gate de aniversário)
// e `primeiraMensagem` (historico.length <= 1 em processarMensagemIA) diz se
// é a abertura da conversa, pra IA só cumprimentar pelo nome uma vez.
async function montarContextoIA(tenant, cliente, primeiraMensagem) {
  const { rows: servicos } = await pool.query(
    'SELECT nome, duracao_minutos, preco FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL ORDER BY nome',
    [tenant.id]
  );
  const disponibilidade = await calcularDisponibilidadeIA(tenant);
  // Fora do plano Custom o tenant tem 1 único profissional (garantido por
  // garantirProfissionalPadrao) — nesse caso o "com quem" nunca é uma decisão
  // real do cliente, então a IA não deve perguntar nem mencionar nome de
  // profissional (pedido explícito: não aparecer no bot fora do Custom).
  const { unico: profissionalUnico } = await garantirProfissionalPadrao(tenant.id);

  // Atendimentos futuros (não só o mais próximo) — usado tanto pra IA
  // confirmar QUAL atendimento reagendar/cancelar antes de executar, quanto
  // pra perguntar se um pedido de "agendar" é um atendimento A MAIS (não
  // confundir com reagendamento do que já existe). Corrigido numa avaliação
  // do bot (2026-08-19): antes só trazia o mais próximo (LIMIT 1) — com a
  // recorrência de agendamento (Novo agendamento > Recorrência) um cliente
  // pode ter vários atendimentos confirmados ao mesmo tempo, e "o mais
  // próximo" deixava de ser necessariamente o que o cliente quis dizer.
  // Limite de 10 é só uma trava de bom senso.
  const { rows: atendimentosFuturosRows } = await pool.query(
    `SELECT a.data_hora, s.nome AS servico_nome
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
      WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status IN ('confirmado', 'a_confirmar') AND a.data_hora > now()
      ORDER BY a.data_hora ASC LIMIT 10`,
    [tenant.id, cliente.id]
  );
  // Mesmo padrão de HORÁRIOS LIVRES: texto amigável + ISO exato entre
  // colchetes, pra IA copiar em "dataHoraAlvoISO" sem nunca reconstruir a
  // data sozinha.
  const textoAtendimentosFuturos = atendimentosFuturosRows.length
    ? atendimentosFuturosRows.map((a) => {
        const texto = new Date(a.data_hora).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `- ${a.servico_nome || 'Atendimento'} em ${texto} [${new Date(a.data_hora).toISOString()}]`;
      }).join('\n')
    : '(nenhum)';

  const listaServicos = servicos.length
    ? servicos.map((s) => `- ${s.nome} (${s.duracao_minutos}min, R$ ${Number(s.preco).toFixed(2)})`).join('\n')
    : '(nenhum serviço cadastrado ainda)';

  // Cada slot lista o texto amigável E o ISO exato lado a lado — a IA nunca
  // reconstrói o ISO sozinha (já causou bug real: ano errado, "2024" em vez
  // do ano corrente, quando só o texto formatado era mostrado). Ela só copia
  // o valor entre colchetes. Com 1 único profissional, a lista fica achatada
  // (sem o prefixo "- Nome:") pra IA nem saber que existe uma escolha aqui.
  const listaDisponibilidade = disponibilidade.length
    ? disponibilidade.map((p) => {
        // Sem corte artificial aqui — o cálculo já limita a
        // IA_SLOTS_POR_DIA_PROFISSIONAL × IA_DIAS_DISPONIBILIDADE (21 no
        // padrão atual), então mostrar tudo cobre a janela de dias inteira em
        // vez de truncar nos primeiros ~2 dias (bug encontrado em produção).
        const horarios = p.slots.map((s) => {
          const d = new Date(s.dataHoraISO);
          const texto = d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `${texto} [${s.dataHoraISO}]`;
        }).join(', ');
        return profissionalUnico ? `- ${horarios}` : `- ${p.profissional}: ${horarios}`;
      }).join('\n')
    : '(sem horários livres nos próximos dias)';

  const agoraBrasilia = new Date(Date.now() - OFFSET_BRASILIA_MINUTOS * 60000);
  const hojeFormatado = agoraBrasilia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

  return `Você é a atendente virtual do salão "${tenant.nome}", via WhatsApp. Responda em português do Brasil, de forma breve, calorosa e direta — como uma recepcionista experiente, nunca como um robô.

Hoje é ${hojeFormatado}.

DADOS DO CLIENTE:
- Nome: ${cliente.nome || '(não informado ainda)'}
- Data de nascimento: ${cliente.data_nascimento ? 'já informada' : 'não informada'}

ATENDIMENTOS FUTUROS CONFIRMADOS (cada um mostra o texto e, entre colchetes, o valor ISO exato — copie literalmente em "dataHoraAlvoISO" quando precisar identificar QUAL atendimento é; nunca invente):
${textoAtendimentosFuturos}

SERVIÇOS DISPONÍVEIS:
${listaServicos}

HORÁRIOS LIVRES (próximos ${IA_DIAS_DISPONIBILIDADE} dias — cada horário mostra o texto e, entre colchetes, o valor ISO exato que você deve copiar em "dataHoraISO"; nunca invente ou monte um ISO por conta própria):
${listaDisponibilidade}

Sua tarefa é ajudar o cliente a AGENDAR, REAGENDAR ou CANCELAR um horário, CONSULTAR informações do salão, ou registrar a DATA DE NASCIMENTO dele. Você NUNCA executa a ação diretamente — você só entende a intenção do cliente e devolve um JSON estruturado; quem executa é o sistema.

Responda SEMPRE e SOMENTE com um objeto JSON válido (sem texto antes/depois, sem markdown), no formato exato:
{"intent": "agendar" | "reagendar" | "cancelar" | "consultar" | "informar_nascimento" | "unknown" | "fallback_humano", "params": {"servicoNome": string|null, "profissionalNome": string|null, "dataHoraISO": string|null, "dataHoraAlvoISO": string|null, "dataNascimento": string|null}, "resposta": "texto natural pra enviar ao cliente"}

Regras:
- Use intent "unknown" quando a mensagem não deixar clara a intenção — nesse caso "resposta" deve pedir o esclarecimento que falta.
${primeiraMensagem ? `- Esta é a PRIMEIRA mensagem da conversa. ${cliente.nome ? `Cumprimente o cliente pelo nome (${cliente.nome.split(' ')[0]}) logo no início da resposta.` : 'O nome do cliente ainda não é conhecido — cumprimente normalmente, sem inventar um nome.'}` : '- Já é uma conversa em andamento — não repita a saudação completa de novo, vá direto ao ponto.'}
- Se o cliente pedir pra REAGENDAR ou CANCELAR:
  - Se ATENDIMENTOS FUTUROS CONFIRMADOS tiver só 1: apresente esse atendimento (serviço, data e hora) e pergunte se é esse mesmo — use intent "unknown" nessa pergunta. SÓ USE intent "reagendar"/"cancelar" depois que o cliente confirmar explicitamente (ex.: "sim", "isso mesmo").
  - Se tiver MAIS DE 1: liste todos (data e serviço de cada) e pergunte qual deles o cliente quer — use intent "unknown" nessa pergunta. SÓ USE intent "reagendar"/"cancelar" depois que o cliente identificar claramente qual (por data, dia da semana ou serviço), e inclua o ISO exato desse atendimento (copiado literalmente da lista) em "dataHoraAlvoISO".
  - Se não tiver nenhum: não há o que reagendar/cancelar — avise o cliente (intent "unknown").
- Se o cliente pedir pra AGENDAR algo novo e já houver pelo menos 1 em ATENDIMENTOS FUTUROS CONFIRMADOS, pergunte primeiro se é um atendimento A MAIS além do(s) que já existe(m) (não assuma que é reagendamento) — use intent "unknown" nessa pergunta, e só depois de confirmado siga coletando serviço/data/hora normalmente.
${profissionalUnico
  ? '- Use intent "agendar"/"reagendar" SÓ quando já tiver serviço e data/hora confirmados pelo cliente na conversa — antes disso, pergunte o que falta usando intent "unknown". Este salão tem só 1 profissional: NUNCA pergunte "com quem" nem mencione nome de profissional, deixe "profissionalNome" sempre null.'
  : '- Use intent "agendar"/"reagendar" SÓ quando já tiver serviço, profissional (ou "qualquer um") e data/hora confirmados pelo cliente na conversa — antes disso, pergunte o que falta usando intent "unknown".'}
- "dataHoraISO" deve ser exatamente um dos valores entre colchetes [ ] listados acima em HORÁRIOS LIVRES — copie o texto entre colchetes literalmente, nunca monte ou invente um ISO novo.
- "dataHoraAlvoISO" só é necessário quando há MAIS DE 1 atendimento em ATENDIMENTOS FUTUROS CONFIRMADOS e o cliente está reagendando/cancelando um deles — copie o ISO exato entre colchetes daquela lista, nunca invente. Deixe null nos outros casos (só 1 atendimento confirmado, nenhum, ou intent diferente de "reagendar"/"cancelar").
${cliente.data_nascimento ? '' : `- IMPORTANTE — antes de usar intent "agendar" ou "reagendar" de verdade (com tudo já confirmado pelo cliente), se você ainda não perguntou a data de nascimento nesta conversa, pergunte primeiro (use intent "unknown"): deixe bem claro que é totalmente opcional, só pra cadastro, sem nenhum problema se ele não quiser informar. Se o cliente informar uma data, use intent "informar_nascimento" com "dataNascimento" no formato AAAA-MM-DD (calcule o ano a partir do que o cliente disser, usando o ano atual como referência quando ele não disser o ano). Se o cliente disser que prefere não informar (ou já tiver respondido isso antes nesta conversa, mesmo que só "não"), prossiga normalmente com intent "agendar"/"reagendar" sem perguntar de novo.`}
- Use intent "cancelar" quando o cliente quiser cancelar um agendamento existente (não precisa de dataHoraISO nesse caso, e não precisa perguntar data de nascimento pra cancelar).
- Use intent "fallback_humano" quando o cliente pedir explicitamente para falar com uma pessoa, reclamar de forma que a IA não deva resolver sozinha, ou quando a conversa estiver claramente travada após tentativas de esclarecimento.
- "resposta" é sempre em linguagem natural, nunca contém JSON nem menciona "intent"/"params".`;
}

// US68/CA05 — histórico persistido por tenant+cliente; carregado a cada
// mensagem nova pra dar contexto de conversa à IA (sem estado em memória).
async function buscarHistoricoIA(tenantId, clienteId) {
  const { rows } = await pool.query(
    `SELECT role, conteudo FROM conversas_ia
     WHERE tenant_id = $1 AND cliente_id = $2
     ORDER BY criado_em DESC LIMIT $3`,
    [tenantId, clienteId, IA_HISTORICO_MENSAGENS]
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.conteudo }));
}

// US68 dashboard de consumo — tokensEntrada/tokensSaida só fazem sentido pra
// role='assistant' (a única que chama a Anthropic API); ficam null nos
// outros casos, que é o default da coluna.
async function salvarMensagemIA(tenantId, clienteId, role, conteudo, intent = null, tokensEntrada = null, tokensSaida = null) {
  await pool.query(
    'INSERT INTO conversas_ia (tenant_id, cliente_id, role, conteudo, intent, tokens_entrada, tokens_saida) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [tenantId, clienteId, role, conteudo, intent, tokensEntrada, tokensSaida]
  );
  // Retomada de atendimento (lib/worker-retomada-ia.js): o cliente respondeu
  // de verdade, então zera o contador de nudges pendentes — mesma ideia do
  // reset em crm_conversas_whatsapp.salvarConversa() do CRM.
  if (role === 'user') {
    await pool.query('UPDATE clientes SET ia_retomada_tentativas = 0, ia_retomada_ultima_em = NULL WHERE id = $1', [clienteId]);
  }
}

// US68/CA04 — executor de ação: só roda depois do parser validar o JSON.
// Resolve nomes (serviço/profissional) recebidos em texto livre da IA pros
// IDs reais do tenant; nunca deleta agendamento, só troca status (mesmo
// padrão já usado no resto do sistema, ex. DELETE /api/agendamentos).
// Recebe o tenant inteiro (não só tenantId) — precisa validar horário de
// funcionamento antes de agendar (ver abaixo), achado numa avaliação do bot.
async function executarAcaoIA({ intent, params, tenant, clienteId }) {
  const tenantId = tenant.id;

  if (intent === 'agendar' || intent === 'reagendar') {
    if (!params.dataHoraISO) throw new Error('HorarioNaoInformado');
    const { rows: servicoRows } = params.servicoNome
      ? await pool.query('SELECT id, nome, preco, duracao_minutos FROM servicos WHERE tenant_id = $1 AND ativo = true AND nome ILIKE $2 LIMIT 1', [tenantId, `%${params.servicoNome}%`])
      : { rows: [] };
    const servico = servicoRows[0] || null;
    const { rows: profRows } = params.profissionalNome
      ? await pool.query('SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL AND ativo AND nome ILIKE $2 LIMIT 1', [tenantId, `%${params.profissionalNome}%`])
      : { rows: [] };
    let profissional = profRows[0] || null;
    if (!profissional) {
      const { rows: qualquer } = await pool.query('SELECT id, nome FROM profissionais WHERE tenant_id = $1 AND excluido_em IS NULL AND ativo ORDER BY nome LIMIT 1', [tenantId]);
      profissional = qualquer[0] || null;
    }
    if (!profissional) throw new Error('SemProfissionalDisponivel');

    const duracao = servico ? servico.duracao_minutos : IA_DURACAO_PADRAO_MINUTOS;

    // Defesa em profundidade (achado numa avaliação do bot, 2026-08-19): o
    // prompt já instrui a IA a só copiar horários de HORÁRIOS LIVRES (que já
    // respeitam expediente/dias abertos/almoço), mas uma decisão de negócio
    // nunca pode depender só da palavra do modelo — mesma validação que
    // POST/PATCH /api/agendamentos sempre fizeram, e que este caminho nunca
    // tinha feito.
    const validacaoHorario = dentroDoHorarioFuncionamento(tenant, params.dataHoraISO, duracao);
    if (!validacaoHorario.valido) throw new Error('HorarioForaDoFuncionamento');

    const bloqueioConflitante = await buscarBloqueioConflitante(tenantId, profissional.id, params.dataHoraISO, duracao);
    if (bloqueioConflitante) throw new Error('HorarioIndisponivel');

    // Bug corrigido numa avaliação do bot (2026-08-19): antes comparava a
    // duração do agendamento NOVO ($4, correta) contra uma duração FIXA de
    // 30min pro agendamento JÁ EXISTENTE (interpolada direto no SQL) — um
    // serviço mais longo (ex.: Coloração, 90min) só "ocupava" 30min aos
    // olhos da IA, permitindo encaixar outro cliente no meio de um
    // atendimento em andamento. LEFT JOIN (não INNER) + COALESCE: um
    // agendamento sem serviço vinculado (servico_id null, possível neste
    // mesmo fluxo, linha do INSERT abaixo) cai no padrão de 30min em vez de
    // sumir da checagem de conflito inteira.
    const { rows: conflito } = await pool.query(
      `SELECT a.id
         FROM agendamentos a
         LEFT JOIN servicos s ON s.id = a.servico_id
        WHERE a.tenant_id = $1 AND a.profissional_id = $2 AND a.status IN ('confirmado', 'a_confirmar')
          AND a.data_hora < $3::timestamptz + ($4 * interval '1 minute')
          AND $3::timestamptz < a.data_hora + (COALESCE(s.duracao_minutos, $5) * interval '1 minute')`,
      [tenantId, profissional.id, params.dataHoraISO, duracao, IA_DURACAO_PADRAO_MINUTOS]
    );
    if (conflito.length) throw new Error('HorarioIndisponivel');

    // US64 (mesmo padrão de POST/PATCH /api/agendamentos) — o agendamento e o
    // lançamento financeiro precisam nascer/atualizar juntos, atomicamente.
    // Sem isso, agendamentos criados pela IA nunca apareciam em
    // /api/financeiro/resumo (que soma lancamentos_financeiros, não
    // agendamentos direto) — bug relatado em produção.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (intent === 'reagendar') {
        const { rows: candidatos } = await client.query(
          `SELECT a.id, a.status, s.nome AS servico_nome, s.preco AS servico_preco, a.data_hora
             FROM agendamentos a
             LEFT JOIN servicos s ON s.id = a.servico_id
            WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status IN ('confirmado', 'a_confirmar') AND a.data_hora > now()
            ORDER BY a.data_hora ASC`,
          [tenantId, clienteId]
        );
        const existente = escolherAgendamentoAlvoIA(candidatos, params.dataHoraAlvoISO);
        if (existente) {
          await client.query('UPDATE agendamentos SET data_hora = $1, profissional_id = $2, updated_at = now() WHERE id = $3', [params.dataHoraISO, profissional.id, existente.id]);
          // Reagendar mantém o status que o atendimento já tinha
          // ('a_confirmar' ou 'confirmado') — não força pra 'confirmado' (a
          // remarcação por si só não é uma confirmação do cliente).
          await sincronizarLancamentoFinanceiro(client, {
            tenantId,
            agendamentoId: existente.id,
            servicoNome: existente.servico_nome,
            servicoPreco: existente.servico_preco,
            dataHora: params.dataHoraISO,
            statusAgendamento: existente.status,
          });
          await client.query('COMMIT');
          // Configurações > Notificações ("Agendamento remarcado") —
          // best-effort, não bloqueia a resposta ao cliente no WhatsApp.
          dispararNotificacaoEvento(pool, tenant.id, 'agenda_remarcada', {
            titulo: 'Agendamento remarcado pelo WhatsApp',
            detalhe: `${existente.servico_nome || 'Serviço'} com ${profissional.nome} — ${new Date(params.dataHoraISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
            referenciaDataHora: params.dataHoraISO,
          }).catch(() => {});
          return { ok: true, agendamentoId: existente.id };
        }
        // candidatos.length === 0: nenhum atendimento existente pra
        // reagendar — segue pro INSERT abaixo, mesmo comportamento de
        // "agendar" (já era assim antes desta revisão).
      }

      // Nasce 'confirmado' direto (não 'a_confirmar'/migration 086) — ao
      // contrário de um agendamento criado pelo painel, aqui o próprio
      // cliente já confirmou tudo na conversa (a IA só cria depois de
      // reunir serviço/profissional/data-hora e o cliente confirmar
      // explicitamente, ver montarContextoIA) — mandar OUTRO "Confirme seu
      // horário" pelo WhatsApp logo em seguida seria redundante.
      const { rows: novo } = await client.query(
        `INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status, origem)
         VALUES ($1, $2, $3, $4, $5, 'confirmado', 'whatsapp')
         RETURNING id`,
        [tenantId, clienteId, profissional.id, servico ? servico.id : null, params.dataHoraISO]
      );
      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId: novo[0].id,
        servicoNome: servico ? servico.nome : null,
        servicoPreco: servico ? servico.preco : null,
        dataHora: params.dataHoraISO,
        statusAgendamento: 'confirmado',
      });
      await client.query('COMMIT');
      // Configurações > Notificações ("Novo agendamento criado") —
      // best-effort, não bloqueia a resposta ao cliente no WhatsApp.
      dispararNotificacaoEvento(pool, tenant.id, 'agenda_criada', {
        titulo: `Novo agendamento pelo WhatsApp: ${servico ? servico.nome : 'serviço'}`,
        detalhe: `${profissional.nome} — ${new Date(params.dataHoraISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
        referenciaDataHora: params.dataHoraISO,
      }).catch(() => {});
      return { ok: true, agendamentoId: novo[0].id };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  }

  if (intent === 'cancelar') {
    const { rows: candidatos } = await pool.query(
      `SELECT a.id, a.data_hora, s.nome AS servico_nome, s.preco AS servico_preco
         FROM agendamentos a
         LEFT JOIN servicos s ON s.id = a.servico_id
        WHERE a.tenant_id = $1 AND a.cliente_id = $2 AND a.status IN ('confirmado', 'a_confirmar') AND a.data_hora > now()
        ORDER BY a.data_hora ASC`,
      [tenantId, clienteId]
    );
    if (!candidatos.length) throw new Error('NenhumAgendamentoParaCancelar');
    const existente = escolherAgendamentoAlvoIA(candidatos, params.dataHoraAlvoISO);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE agendamentos SET status = 'cancelado', updated_at = now() WHERE id = $1", [existente.id]);
      // Sincroniza o lançamento pra 'cancelado' (sai da soma de previsto/
      // realizado) — mesmo padrão de PATCH /api/agendamentos ao cancelar.
      await sincronizarLancamentoFinanceiro(client, {
        tenantId,
        agendamentoId: existente.id,
        servicoNome: existente.servico_nome,
        servicoPreco: existente.servico_preco,
        dataHora: existente.data_hora,
        statusAgendamento: 'cancelado',
      });
      await client.query('COMMIT');
      return { ok: true, agendamentoId: existente.id };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  }

  // Data de nascimento é opcional e de baixo risco — nunca lança erro pro
  // cliente ver; data ausente/mal formatada (a IA "inventou" algo fora do
  // padrão AAAA-MM-DD) só fica sem salvar, silenciosamente.
  if (intent === 'informar_nascimento') {
    if (params.dataNascimento && /^\d{4}-\d{2}-\d{2}$/.test(params.dataNascimento)) {
      await pool.query('UPDATE clientes SET data_nascimento = $1 WHERE id = $2', [params.dataNascimento, clienteId]);
    } else {
      fastify.log.warn({ params }, 'Executor de ação IA — dataNascimento ausente/inválida em informar_nascimento');
    }
    // Bug real em produção (2026-09-26): o prompt pede a data de nascimento
    // como último gate antes de agendar/reagendar, e o cliente costuma
    // responder tudo junto na mesma mensagem (data de nascimento + confirma o
    // agendamento). A IA classifica o turno como "informar_nascimento" (regra
    // do prompt) e já responde como se o agendamento estivesse confirmado —
    // mas sem isto aqui, o agendamento em si nunca era criado, porque cada
    // turno só executava UMA ação. `params` já veio com tudo que o
    // agendamento precisa (mesmo JSON que a IA teria mandado com intent
    // "agendar"/"reagendar"); `dataHoraAlvoISO` só existe quando é
    // reagendamento de um atendimento específico.
    if (params.dataHoraISO) {
      return executarAcaoIA({ intent: params.dataHoraAlvoISO ? 'reagendar' : 'agendar', params, tenant, clienteId });
    }
    return { ok: true };
  }

  // 'consultar', 'unknown' e 'fallback_humano' não têm efeito no banco —
  // a resposta da IA já é suficiente (ou o handler de fallback, à parte).
  return { ok: true };
}

// US68/CA06 — fallback humano: marca a conversa e notifica o salão via
// WhatsApp (número do responsável já cadastrado em tenants.telefone).
// `enviarResposta` é o mesmo canal (Meta Cloud API ou Evolution API,
// conforme o webhook que originou a mensagem) usado pra responder o
// cliente — reaproveitado aqui pra notificar o salão. Nunca lança — uma
// falha aqui não pode derrubar a resposta já dada ao cliente.
async function acionarFallbackHumanoIA(tenant, cliente, enviarResposta) {
  // aguardando_humano_desde marca o início do handoff pro worker de retorno
  // automático (lib/worker-handoff.js) saber quando devolver a conversa.
  await pool.query("UPDATE clientes SET status_conversa = 'aguardando_humano', aguardando_humano_desde = now() WHERE id = $1", [cliente.id]);
  if (!tenant.telefone) return;
  try {
    await enviarResposta(
      tenant.telefone,
      `⚠️ Atendimento assumido pela IA precisa da sua ajuda.\nCliente: ${cliente.nome || cliente.telefone}\nEntre em contato direto pelo WhatsApp do salão pra continuar o atendimento.`
    );
  } catch (erro) {
    fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha ao notificar salão sobre fallback humano (US68.6)');
  }
}

// US68 — orquestra uma mensagem recebida de um tenant com tecnologia='ia':
// busca/cria o cliente, monta contexto+histórico, chama Claude, valida a
// intenção, executa a ação (com fallback textual se der conflito) e persiste
// a conversa. Sempre responde algo ao cliente — mesmo em erro.
// `enviarResposta(numeroDestino, texto)` abstrai o canal de envio (Meta Cloud
// API ou Evolution API) — quem decide qual usar é o roteador, conforme o
// formato do webhook recebido; a lógica da IA em si é a mesma pros dois.
async function processarMensagemIA({ tenant, telefone, mensagem, pushName, enviarResposta }) {
  // Antes de qualquer coisa (nem resolve/cria o cliente ainda): tenant sem
  // horário confirmado ou sem serviço ativo não está pronto pra atender de
  // verdade — corta aqui em vez de deixar a IA seguir com dado incompleto/
  // padrão (montarContextoIA só avisava "(nenhum serviço cadastrado ainda)"
  // no prompt e a resposta ficava ao critério da IA, sem garantia nenhuma).
  if (!tenant.onboarding_horario_revisado) {
    await enviarResposta(telefone, MENSAGEM_TENANT_NAO_PRONTO_IA);
    return;
  }
  const { rows: servicosAtivos } = await pool.query(
    'SELECT 1 FROM servicos WHERE tenant_id = $1 AND ativo = true AND excluido_em IS NULL LIMIT 1',
    [tenant.id]
  );
  if (servicosAtivos.length === 0) {
    await enviarResposta(telefone, MENSAGEM_TENANT_NAO_PRONTO_IA);
    return;
  }

  let { rows: clienteRows } = await pool.query(
    'SELECT id, nome, status_conversa, data_nascimento, excluido_em FROM clientes WHERE tenant_id = $1 AND telefone = $2 LIMIT 1',
    [tenant.id, telefone]
  );
  let cliente = clienteRows[0];
  if (!cliente) {
    const { rows: criado } = await pool.query(
      'INSERT INTO clientes (tenant_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id, nome, status_conversa, data_nascimento, excluido_em',
      [tenant.id, pushName || null, telefone]
    );
    cliente = criado[0];
  } else if (cliente.excluido_em) {
    // Cliente que tinha sido excluído (soft delete, menu Clientes) e volta a
    // mandar mensagem reaparece na listagem — mesma lógica do ON CONFLICT em
    // POST /api/agendamentos.
    await pool.query('UPDATE clientes SET excluido_em = NULL WHERE id = $1', [cliente.id]);
  }

  // Calculado ANTES de salvar a mensagem atual — senão a mensagem atual
  // viraria "a última", e o intervalo seria sempre zero.
  const { rows: ultimaMensagemRows } = await pool.query(
    'SELECT criado_em FROM conversas_ia WHERE tenant_id = $1 AND cliente_id = $2 ORDER BY criado_em DESC LIMIT 1',
    [tenant.id, cliente.id]
  );
  const gapDesdeUltimaMensagemMs = ultimaMensagemRows[0]
    ? Date.now() - new Date(ultimaMensagemRows[0].criado_em).getTime()
    : Infinity;
  const janelaEncerramentoMs = (tenant.ia_janela_encerramento_minutos ?? IA_JANELA_ENCERRAMENTO_MINUTOS_PADRAO) * 60 * 1000;
  const primeiraMensagem = gapDesdeUltimaMensagemMs > janelaEncerramentoMs;

  // Sempre salva a mensagem do cliente, mesmo durante atendimento humano —
  // o atendente precisa ver na janela de atendimento ao vivo
  // (atendimento.html) o que o cliente escreveu; só a resposta automática da
  // IA que fica suspensa enquanto aguardando_humano, não o registro em si
  // (antes desse ajuste, o `return` abaixo saía cedo demais e a mensagem
  // nunca chegava a ser gravada).
  await salvarMensagemIA(tenant.id, cliente.id, 'user', mensagem);

  // US68/CA06 — não processa via IA enquanto aguarda retomada humana.
  if (cliente.status_conversa === 'aguardando_humano') return;

  const historico = await buscarHistoricoIA(tenant.id, cliente.id);
  const system = await montarContextoIA(tenant, cliente, primeiraMensagem);
  const { texto: respostaBruta, tokensEntrada, tokensSaida } = await anthropicService.chamarClaude({ system, mensagens: [...historico, { role: 'user', content: mensagem }] });
  const { intent, params, resposta } = parsearIntentIA(respostaBruta, { log: (obj, msg) => fastify.log.warn(obj, msg) });

  let textoFinal = resposta;
  if (intent === 'fallback_humano') {
    await acionarFallbackHumanoIA(tenant, cliente, enviarResposta);
  } else if (intent === 'agendar' || intent === 'reagendar' || intent === 'cancelar' || intent === 'informar_nascimento') {
    try {
      await executarAcaoIA({ intent, params, tenant, clienteId: cliente.id });
    } catch (erro) {
      const mensagensErro = {
        HorarioIndisponivel: 'Poxa, esse horário acabou de ficar indisponível. Pode escolher outro dos que te passei?',
        HorarioNaoInformado: 'Não peguei direito o horário — pode me dizer de novo, por favor?',
        // Achado numa avaliação do bot (2026-08-19): antes não existia essa
        // validação (só a instrução no prompt) — ver executarAcaoIA.
        HorarioForaDoFuncionamento: 'Esse horário ficou fora do nosso expediente. Pode escolher um dos horários que te passei certinho?',
        SemProfissionalDisponivel: 'No momento não temos profissional disponível pra esse atendimento. Posso te ajudar de outra forma?',
        NenhumAgendamentoParaCancelar: 'Não encontrei nenhum agendamento seu pra cancelar. Confere pra mim o que você gostaria?',
        // Achado numa avaliação do bot (2026-08-19): cliente com mais de 1
        // atendimento confirmado (possível com a recorrência de
        // agendamento) e a IA não conseguiu identificar qual — ver
        // escolherAgendamentoAlvoIA.
        AgendamentoAmbiguo: 'Vi que você tem mais de um agendamento marcado — pode me dizer a data ou o serviço de qual você quer, pra eu ter certeza?',
      };
      textoFinal = mensagensErro[erro.message] || 'Tive um problema pra confirmar isso agora. Pode tentar de novo em instantes?';
      if (!mensagensErro[erro.message]) {
        fastify.log.warn({ erro: erro.message, intent, params, tenantId: tenant.id }, 'Executor de ação IA (US68.5) falhou com erro não mapeado');
      }
    }
  }

  // Salva o turno do assistente sempre no MESMO formato JSON que o system
  // prompt exige da IA — nunca o texto final em linguagem natural. Motivo:
  // esse histórico é replayed de volta pra Claude nas próximas mensagens
  // (buscarHistoricoIA); se salvássemos texto puro aqui, a IA veria seus
  // próprios turnos passados em linguagem natural e passaria a imitar esse
  // padrão nas respostas seguintes, ignorando a instrução de responder só em
  // JSON — foi exatamente esse loop que causou a IA "esquecer" o formato
  // depois do primeiro turno em produção.
  await salvarMensagemIA(tenant.id, cliente.id, 'assistant', JSON.stringify({ intent, params, resposta: textoFinal }), intent, tokensEntrada, tokensSaida);

  try {
    await enviarResposta(telefone, textoFinal);
  } catch (erro) {
    // Falha no envio (ex.: token expirado, instância desconectada) não pode
    // apagar o que já foi persistido (agendamento criado, conversa salva) —
    // só loga.
    fastify.log.error({ erro: erro.message, tenantId: tenant.id }, 'Falha ao enviar resposta da IA (US68)');
  }
}

module.exports = { init, processarMensagemIA };
