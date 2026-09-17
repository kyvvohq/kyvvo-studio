// Configuração — extraído de index.js (fase 7 da modularização):
// GET/PATCH /api/configuracao, GET /api/tenant/modulos.
const planos = require('../lib/planos');
const { diaDaSemanaBrasilia } = require('../lib/datetime');

function registerConfiguracaoRoutes(fastify, pool) {
  fastify.get('/api/configuracao', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT dias_funcionamento, formato_hora, horario_abertura, horario_fechamento, segmento,
              horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, tecnologia, plano,
              cliente_inativo_dias, cliente_novo_dias
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const config = rows[0];
    if (!config) return config;
    // US69/CA06 — modo de atendimento é somente leitura no portal do salão;
    // o admin Kyvvo é quem altera (PATCH /admin/api/tenants/:id/modo).
    return { ...config, plano_atual: planos.nomeDoPlano(config.plano) };
  });

  const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

  // US62 — mudar horário/dias de funcionamento é configuração do negócio,
  // restrita ao administrador (leitura continua livre pra qualquer membro
  // logado, já que a agenda depende desses dados pra renderizar).
  fastify.patch('/api/configuracao', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    const {
      diasFuncionamento, formatoHora, horarioAbertura, horarioFechamento,
      horarioAlmocoAtivo, horarioAlmocoInicio, horarioAlmocoFim,
      clienteInativoDias, clienteNovoDias,
    } = request.body || {};

    if (formatoHora && !['24h', '12h'].includes(formatoHora)) {
      return reply.code(400).send({ error: 'formatoHora deve ser "24h" ou "12h"' });
    }
    // Limiar de "cliente inativo" (Preferências): mesmo intervalo do CHECK em
    // tenants (065_tenants_cliente_inativo_dias.sql), validado aqui também
    // pra devolver mensagem de erro clara em vez de estourar exceção de SQL,
    // mesmo padrão já usado pros horários abaixo.
    if (clienteInativoDias !== undefined && (!Number.isInteger(clienteInativoDias) || clienteInativoDias < 1 || clienteInativoDias > 365)) {
      return reply.code(400).send({ error: 'clienteInativoDias deve ser um número inteiro entre 1 e 365' });
    }
    // Limiar de "cliente novo" (Preferências) — mesmo padrão/validação do
    // clienteInativoDias acima (CHECK em 075_tenants_cliente_novo_dias.sql).
    if (clienteNovoDias !== undefined && (!Number.isInteger(clienteNovoDias) || clienteNovoDias < 1 || clienteNovoDias > 365)) {
      return reply.code(400).send({ error: 'clienteNovoDias deve ser um número inteiro entre 1 e 365' });
    }
    if (diasFuncionamento && (!Array.isArray(diasFuncionamento) || diasFuncionamento.some((d) => d < 0 || d > 6))) {
      return reply.code(400).send({ error: 'diasFuncionamento deve ser uma lista de números de 0 a 6' });
    }
    if (horarioAbertura !== undefined && !HORARIO_REGEX.test(horarioAbertura)) {
      return reply.code(400).send({ error: 'horarioAbertura deve estar no formato HH:MM' });
    }
    if (horarioFechamento !== undefined && !HORARIO_REGEX.test(horarioFechamento)) {
      return reply.code(400).send({ error: 'horarioFechamento deve estar no formato HH:MM' });
    }
    if (horarioAlmocoInicio !== undefined && horarioAlmocoInicio !== null && !HORARIO_REGEX.test(horarioAlmocoInicio)) {
      return reply.code(400).send({ error: 'horarioAlmocoInicio deve estar no formato HH:MM' });
    }
    if (horarioAlmocoFim !== undefined && horarioAlmocoFim !== null && !HORARIO_REGEX.test(horarioAlmocoFim)) {
      return reply.code(400).send({ error: 'horarioAlmocoFim deve estar no formato HH:MM' });
    }

    // Precisa validar abertura < fechamento (e início < fim do almoço) contra
    // o valor final (existente ou novo) de cada lado — não dá pra confiar só
    // no CHECK do banco pra dar uma mensagem de erro clara em vez de estourar
    // uma exceção de SQL. Também busca dias_funcionamento sempre que
    // diasFuncionamento vier no body, pra descobrir quais dias estão sendo
    // desabilitados (ver reagendamento em cascata abaixo).
    let diasRemovidos = [];
    if (horarioAbertura !== undefined || horarioFechamento !== undefined || horarioAlmocoAtivo !== undefined
      || horarioAlmocoInicio !== undefined || horarioAlmocoFim !== undefined || diasFuncionamento !== undefined) {
      const { rows: atuais } = await pool.query(
        `SELECT dias_funcionamento, horario_abertura, horario_fechamento, horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      // Normaliza pra "HH:MM" antes de comparar — o valor vindo do banco tem
      // segundos ("08:00:00") e o do request não, e comparação de string só
      // é confiável se os dois lados tiverem o mesmo formato.
      const aberturaFinal = (horarioAbertura ?? atuais[0].horario_abertura).slice(0, 5);
      const fechamentoFinal = (horarioFechamento ?? atuais[0].horario_fechamento).slice(0, 5);
      if (aberturaFinal >= fechamentoFinal) {
        return reply.code(400).send({ error: 'Horário de abertura precisa ser antes do horário de fechamento' });
      }

      const almocoAtivoFinal = horarioAlmocoAtivo ?? atuais[0].horario_almoco_ativo;
      if (almocoAtivoFinal) {
        const almocoInicioFinal = (horarioAlmocoInicio ?? atuais[0].horario_almoco_inicio ?? '').slice(0, 5);
        const almocoFimFinal = (horarioAlmocoFim ?? atuais[0].horario_almoco_fim ?? '').slice(0, 5);
        if (!almocoInicioFinal || !almocoFimFinal) {
          return reply.code(400).send({ error: 'Informe o horário de início e término do almoço.' });
        }
        if (almocoInicioFinal >= almocoFimFinal) {
          return reply.code(400).send({ error: 'Horário de início do almoço precisa ser antes do horário de término.' });
        }
      }

      if (diasFuncionamento) {
        const diasAtuais = atuais[0].dias_funcionamento || [1, 2, 3, 4, 5, 6];
        diasRemovidos = diasAtuais.filter((d) => !diasFuncionamento.includes(d));
      }
    }

    // Reagendamento em cascata (US "desabilitar dia move agendamentos"): só
    // agendamentos futuros e confirmados nos dias que estão sendo
    // desabilitados são movidos, pro mesmo horário no próximo dia que
    // continua aberto — sem checar colisão com outros agendamentos já
    // existentes nesse dia (decisão confirmada com o Bruno: comportamento
    // simples, equivalente a um reagendamento manual apressado). O usuário
    // já confirmou essa consequência num popup no frontend antes de chamar
    // esse PATCH.
    let agendamentosMovidos = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (diasRemovidos.length > 0) {
        const { rows: futuros } = await client.query(
          `SELECT id, data_hora FROM agendamentos WHERE tenant_id = $1 AND status = 'confirmado' AND data_hora > now()`,
          [tenantId]
        );
        for (const ag of futuros) {
          if (!diasRemovidos.includes(diaDaSemanaBrasilia(ag.data_hora))) continue;
          // Soma dias inteiros em ms (seguro porque o offset de Brasília é
          // fixo, sem horário de verão — preserva o horário local) até cair
          // num dia presente no diasFuncionamento novo. Mesmo limite de 14
          // tentativas usado no equivalente do frontend (proximoDiaAberto).
          let novaData = ag.data_hora;
          let tentativas = 0;
          while (!diasFuncionamento.includes(diaDaSemanaBrasilia(novaData)) && tentativas < 14) {
            novaData = new Date(novaData.getTime() + 86400000);
            tentativas++;
          }
          await client.query('UPDATE agendamentos SET data_hora = $1 WHERE id = $2', [novaData, ag.id]);
          agendamentosMovidos++;
        }
      }

      const { rows } = await client.query(
        `UPDATE tenants SET
           dias_funcionamento = COALESCE($2, dias_funcionamento),
           formato_hora = COALESCE($3, formato_hora),
           horario_abertura = COALESCE($4, horario_abertura),
           horario_fechamento = COALESCE($5, horario_fechamento),
           horario_almoco_ativo = COALESCE($6, horario_almoco_ativo),
           horario_almoco_inicio = CASE WHEN $6 = false THEN null ELSE COALESCE($7, horario_almoco_inicio) END,
           horario_almoco_fim = CASE WHEN $6 = false THEN null ELSE COALESCE($8, horario_almoco_fim) END,
           cliente_inativo_dias = COALESCE($9, cliente_inativo_dias),
           cliente_novo_dias = COALESCE($10, cliente_novo_dias),
           -- US56 — qualquer salvamento nesta tela conta como "horário
           -- revisado" pro checklist de onboarding, mesmo que o tenant só
           -- confirme os valores padrão sem alterar nada.
           onboarding_horario_revisado = true
         WHERE id = $1
         RETURNING dias_funcionamento, formato_hora, horario_abertura, horario_fechamento,
                   horario_almoco_ativo, horario_almoco_inicio, horario_almoco_fim, cliente_inativo_dias, cliente_novo_dias`,
        [
          tenantId, diasFuncionamento ? JSON.stringify(diasFuncionamento) : null, formatoHora, horarioAbertura, horarioFechamento,
          horarioAlmocoAtivo ?? null, horarioAlmocoInicio, horarioAlmocoFim, clienteInativoDias ?? null, clienteNovoDias ?? null,
        ]
      );
      await client.query('COMMIT');
      return { ...rows[0], agendamentos_movidos: agendamentosMovidos };
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    } finally {
      client.release();
    }
  });

  // ---------- Módulos ----------
  // CA04 — lista os módulos ativos do tenant logado (key, nome de exibição e
  // preço mensal). É o que o painel usa para montar o menu dinâmico (CA05).
  fastify.get('/api/tenant/modulos', { preHandler: [fastify.authenticate] }, async (request) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT m.key, m.nome, m.preco_mensal
       FROM tenant_modulos tm
       JOIN modulos m ON m.key = tm.modulo_key
       WHERE tm.tenant_id = $1 AND tm.ativo
       ORDER BY m.nome`,
      [tenantId]
    );
    return { modulos: rows };
  });
}

module.exports = { registerConfiguracaoRoutes };
