// Retorno automático de handoff — devolve ao atendimento por IA as conversas
// que entraram em 'aguardando_humano' e o salão não retomou dentro do limite
// (configuracoes_sistema.whatsapp_handoff_retorno_horas, 2h por padrão).
// Sem isso, um handoff esquecido trava a conversa pra sempre — a IA nunca
// mais responde aquele cliente — e ninguém percebe (bug real, produção
// 2026-09-10).
//
// Reset silencioso: não manda nada pro cliente — a próxima mensagem dele já
// volta a ser atendida pela IA. `handoff_devolvido_em` fica marcado pro
// painel de atendimento mostrar que a devolução foi automática (o salão
// retomar manualmente via POST /api/whatsapp/conversas/:id/liberar limpa
// esse marcador).
//
// O Studio não tinha worker até aqui — este roda como um setInterval dentro
// do próprio processo do painel, iniciado só no boot real (index.js, depois
// do listen); o index.js não é importado pelos testes, então isso nunca
// dispara em teste.

const INTERVALO_MS = 5 * 60 * 1000;

// Testável sem Postgres real: só usa pool.query. `horasLimite` vem de
// configSistema.config.handoffRetornoHoras (já passou por parseInt) — mas
// revalida aqui porque um valor quebrado (0, NaN) não pode virar
// "now() - interval '0 hour'" e devolver conversa que acabou de ser assumida.
async function devolverHandoffsExpirados(pool, horasLimite) {
  const horas = Number(horasLimite);
  if (!Number.isFinite(horas) || horas <= 0) return [];
  const { rows } = await pool.query(
    `UPDATE clientes
        SET status_conversa = 'ativo',
            aguardando_humano_desde = NULL,
            handoff_devolvido_em = now()
      WHERE status_conversa = 'aguardando_humano'
        AND aguardando_humano_desde IS NOT NULL
        AND aguardando_humano_desde < now() - ($1 * interval '1 hour')
    RETURNING id, tenant_id`,
    [horas]
  );
  return rows;
}

function iniciarWorkerHandoff(pool, configSistema, log) {
  const ciclo = async () => {
    try {
      const horas = configSistema.config.handoffRetornoHoras;
      const devolvidos = await devolverHandoffsExpirados(pool, horas);
      if (devolvidos.length) {
        log.info(
          { quantidade: devolvidos.length, horasLimite: horas, clienteIds: devolvidos.map((r) => r.id) },
          '[worker-handoff] conversas devolvidas ao atendimento por IA (timeout de handoff)'
        );
      }
    } catch (erro) {
      log.error({ erro: erro.message }, '[worker-handoff] falha no ciclo');
    }
  };
  const timer = setInterval(ciclo, INTERVALO_MS);
  if (timer.unref) timer.unref();
  ciclo();
  return timer;
}

module.exports = { devolverHandoffsExpirados, iniciarWorkerHandoff, INTERVALO_MS };
