// Relatórios (menu "Relatórios", modulo_key='dashboards') — extraído de
// app.js (fase 3 da modularização, 2026-10-15). Dashboard mensal de negócio
// — GET /api/relatorios/resumo devolve tudo de uma vez (KPIs, gráfico
// diário, agenda, serviços, clientes, financeiro, insights); o frontend só
// formata e distribui num grid multi-coluna (não uma pilha vertical —
// pedido explícito do Bruno, com uma imagem de dashboard como referência de
// estrutura, não de paleta).
import { api } from '../core/api.js';
import { conteudo, formatarDataISO } from '../core/shell.js';

let mesRelatorioRef = new Date();
let relatoriosDados = null;

function referenciaRelatorioAtiva() {
  return formatarDataISO(mesRelatorioRef).slice(0, 7);
}

function navPeriodoRelatoriosHtml() {
  const mesLabel = `${mesRelatorioRef.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'America/Sao_Paulo' }).toUpperCase()} ${mesRelatorioRef.getFullYear()}`;
  return `
    <div class="nav-periodo">
      <button data-nav-relatorios="-1" aria-label="Mês anterior">←</button>
      <strong>${mesLabel}</strong>
      <button data-nav-relatorios="1" aria-label="Próximo mês">→</button>
    </div>
  `;
}

function bindNavPeriodoRelatorios() {
  conteudo.querySelector('[data-nav-relatorios="-1"]').addEventListener('click', () => {
    mesRelatorioRef.setMonth(mesRelatorioRef.getMonth() - 1);
    renderRelatorios();
  });
  conteudo.querySelector('[data-nav-relatorios="1"]').addEventListener('click', () => {
    mesRelatorioRef.setMonth(mesRelatorioRef.getMonth() + 1);
    renderRelatorios();
  });
}

// Seta + porcentagem coloridas (verde/vermelho, reaproveitando .financeiro-
// entrada/.financeiro-saida) — "—" quando não há mês anterior pra comparar
// (variacao_pct null: tenant novo, sem dado no mês anterior).
function relatoriosVariacaoHtml(pct) {
  if (pct == null) return '<div class="relatorios-kpi-variacao vazio-inline">sem comparação</div>';
  const seta = pct >= 0 ? '↑' : '↓';
  const classe = pct >= 0 ? 'financeiro-entrada' : 'financeiro-saida';
  return `<div class="relatorios-kpi-variacao ${classe}">${seta} ${Math.abs(pct).toFixed(1)}%</div>`;
}

function relatoriosKpiCard(label, valor, variacaoPct, formato) {
  const valorHtml = valor == null
    ? '—'
    : (formato === 'moeda' ? formatarPreco(valor) : Number(valor).toLocaleString('pt-BR'));
  return `
    <div class="financeiro-resumo-card">
      <div class="financeiro-resumo-label">${label}</div>
      <div class="financeiro-previsto">${valorHtml}</div>
      ${relatoriosVariacaoHtml(variacaoPct)}
    </div>
  `;
}

// Gráfico de tendência diária de faturamento — SVG puro (sem lib), uma
// polyline com um ponto por dia do mês (faturamento_diario já vem do
// backend com todos os dias preenchidos, zeros incluídos).
function renderGraficoFaturamentoDiario(faturamentoDiario) {
  const max = Math.max(1, ...faturamentoDiario.map((d) => d.valor));
  const totalDias = faturamentoDiario.length;
  const largura = 600;
  const altura = 140;
  const pontos = faturamentoDiario.map((d, i) => {
    const x = totalDias > 1 ? (i / (totalDias - 1)) * largura : 0;
    const y = altura - (d.valor / max) * (altura - 12) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Rótulos só em alguns dias (1, 5, 10, 15, 20, 25 e o último), pra não
  // poluir o eixo — mesmo espírito do mockup original.
  const diasRotulados = [...new Set([1, 5, 10, 15, 20, 25, totalDias].filter((d) => d <= totalDias))];
  return `
    <div class="relatorios-grafico-diario">
      <svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none" class="relatorios-svg-linha">
        <polyline points="${pontos}" fill="none" stroke="var(--accent)" stroke-width="2" />
      </svg>
      <div class="relatorios-grafico-eixo">
        ${diasRotulados.map((d) => `<span>${d}</span>`).join('')}
      </div>
    </div>
  `;
}

// "Agosto 2026: R$ 750,00 / Julho 2026: R$ 700,00 / ↓ 42,3%" numa linha só.
function relatoriosComparacaoMensalHtml(kpiFaturamento) {
  const mesAnteriorRef = new Date(mesRelatorioRef);
  mesAnteriorRef.setMonth(mesAnteriorRef.getMonth() - 1);
  const labelAtual = mesRelatorioRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const labelAnterior = mesAnteriorRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const variacaoHtml = kpiFaturamento.variacao_pct == null
    ? ''
    : ` · <span class="${kpiFaturamento.variacao_pct >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${kpiFaturamento.variacao_pct >= 0 ? '↑' : '↓'} ${Math.abs(kpiFaturamento.variacao_pct).toFixed(1)}%</span>`;
  return `<p class="relatorios-comparacao-mensal">${labelAtual}: <strong>${formatarPreco(kpiFaturamento.valor)}</strong> · ${labelAnterior}: ${formatarPreco(kpiFaturamento.anterior)}${variacaoHtml}</p>`;
}

const RELATORIOS_STATUS_AGENDA = [
  ['realizados', '🟢', 'Realizados'],
  ['agendados', '🔵', 'Agendados'],
  ['cancelados', '🟡', 'Cancelados'],
  ['faltas', '🔴', 'Faltas'],
];

function renderDesempenhoAgenda(agenda) {
  const perdidos = agenda.cancelados + agenda.faltas;
  return `
    <div class="relatorios-status-lista">
      ${RELATORIOS_STATUS_AGENDA.map(([chave, emoji, label]) => `
        <div class="relatorios-status-linha">
          <span>${emoji} ${label}</span>
          <strong>${agenda[chave]}</strong>
        </div>
      `).join('')}
    </div>
    <div class="relatorios-barra-bloco">
      <div class="relatorios-barra-label">Ocupação da agenda</div>
      ${agenda.ocupacao_pct == null
        ? '<div class="vazio-inline">Sem dados suficientes pra calcular (cadastre profissionais e horário de funcionamento).</div>'
        : `
          <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${Math.round(agenda.ocupacao_pct)}%"></div></div>
          <div class="relatorios-barra-valor">${Math.round(agenda.ocupacao_pct)}%</div>
        `}
    </div>
    ${agenda.taxa_comparecimento_pct != null ? `<p class="relatorios-comparacao-mensal">Taxa de comparecimento: <strong>${Math.round(agenda.taxa_comparecimento_pct)}%</strong></p>` : ''}
    ${perdidos > 0 ? `<p class="relatorios-aviso">Você teve ${perdidos} horário${perdidos === 1 ? '' : 's'} perdido${perdidos === 1 ? '' : 's'} este mês.</p>` : ''}
  `;
}

function renderTabelaServicosRelatorio(servicos) {
  if (!servicos.length) return '<div class="vazio">Nenhum atendimento registrado neste mês.</div>';
  return `
    <div class="tabela-wrapper">
      <table class="tabela-tenants">
        <thead><tr><th>Serviço</th><th>Atendimentos</th><th>Faturamento</th></tr></thead>
        <tbody>
          ${servicos.map((s) => `<tr><td>${s.nome}</td><td>${s.atendimentos}</td><td>${formatarPreco(s.faturamento)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSecaoClientesRelatorio(clientes, ticketMedio) {
  return `
    <p class="relatorios-comparacao-mensal"><strong>${clientes.total}</strong> cliente${clientes.total === 1 ? '' : 's'} atendido${clientes.total === 1 ? '' : 's'}</p>
    <div class="relatorios-status-lista">
      <div class="relatorios-status-linha"><span>Novos clientes</span><strong>${clientes.novos}</strong></div>
      <div class="relatorios-status-linha"><span>Clientes recorrentes</span><strong>${clientes.recorrentes}</strong></div>
    </div>
    <div class="relatorios-barra-bloco">
      <div class="relatorios-barra-label">Taxa de retorno</div>
      ${clientes.taxa_retorno_pct == null
        ? '<div class="vazio-inline">Sem dados suficientes.</div>'
        : `
          <div class="onboarding-progresso-barra"><div class="onboarding-progresso-preenchido" style="width:${Math.round(clientes.taxa_retorno_pct)}%"></div></div>
          <div class="relatorios-barra-valor">${Math.round(clientes.taxa_retorno_pct)}%</div>
        `}
    </div>
    <p class="relatorios-comparacao-mensal">Ticket médio: <strong>${clientes.total > 0 ? formatarPreco(ticketMedio) : '—'}</strong></p>
    ${clientes.sem_retorno_60d > 0 ? `<p class="relatorios-aviso">${clientes.sem_retorno_60d} cliente${clientes.sem_retorno_60d === 1 ? '' : 's'} ${clientes.sem_retorno_60d === 1 ? 'está' : 'estão'} há mais de 60 dias sem agendar.</p>` : ''}
  `;
}

// Resumo financeiro do mês — mesma fórmula já confirmada no Financeiro
// (Resultado = Faturamento − Despesas), só que aqui é texto corrido em vez
// dos 4 cards, seguindo o mockup: "não duplicaria toda a tela de
// Financeiro". Mini-gráfico de 2 barras (Receitas × Despesas) fecha a seção.
function renderSecaoFinanceiroRelatorio(financeiro) {
  const resultadoPositivo = financeiro.resultado >= 0;
  const maxBarra = Math.max(1, financeiro.faturamento, financeiro.despesas);
  return `
    <div class="relatorios-financeiro-linhas">
      <div class="relatorios-financeiro-linha"><span>Receita</span><strong class="financeiro-entrada">${formatarPreco(financeiro.faturamento)}</strong></div>
      <div class="relatorios-financeiro-linha"><span>Despesas</span><strong class="financeiro-saida">− ${formatarPreco(financeiro.despesas)}</strong></div>
      <div class="relatorios-financeiro-divisor"></div>
      <div class="relatorios-financeiro-linha relatorios-financeiro-resultado"><span>Resultado</span><strong class="${resultadoPositivo ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(financeiro.resultado)}</strong></div>
    </div>
    ${financeiro.margem_pct != null ? `<p class="relatorios-comparacao-mensal">Margem: <strong>${financeiro.margem_pct.toFixed(1)}%</strong></p>` : ''}
    <div class="relatorios-mini-grafico">
      <div class="relatorios-mini-barra-coluna">
        <div class="relatorios-mini-barra relatorios-mini-barra-entrada" style="height:${Math.round((financeiro.faturamento / maxBarra) * 100)}%"></div>
        <div class="relatorios-mini-barra-label">Receitas</div>
      </div>
      <div class="relatorios-mini-barra-coluna">
        <div class="relatorios-mini-barra relatorios-mini-barra-saida" style="height:${Math.round((financeiro.despesas / maxBarra) * 100)}%"></div>
        <div class="relatorios-mini-barra-label">Despesas</div>
      </div>
    </div>
  `;
}

// Insights — regra determinística no backend (nunca IA/LLM), o frontend só
// mapeia tipo → emoji e imprime o texto já pronto.
const RELATORIOS_INSIGHT_ICONE = {
  faturamento: '📈',
  perdas: '⚠️',
  clientes_inativos: '💜',
  ocupacao_semanal: '💡',
};

function renderInsightsRelatorio(insights) {
  if (!insights.length) return '<div class="vazio-inline">Sem observações pra este mês.</div>';
  return insights.map((i) => `
    <div class="relatorios-insight-item">
      <span class="relatorios-insight-icone">${RELATORIOS_INSIGHT_ICONE[i.tipo] || '✨'}</span>
      <span>${i.texto}</span>
    </div>
  `).join('');
}

export async function renderRelatorios() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/relatorios/resumo?mes=${referenciaRelatorioAtiva()}`);
  if (!data) return;
  relatoriosDados = data;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Relatórios</h2>
    </div>
  ` + navPeriodoRelatoriosHtml() + `
    <div class="relatorios-kpis">
      ${relatoriosKpiCard('Faturamento', data.kpis.faturamento.valor, data.kpis.faturamento.variacao_pct, 'moeda')}
      ${relatoriosKpiCard('Recebido', data.kpis.recebido.valor, data.kpis.recebido.variacao_pct, 'moeda')}
      ${relatoriosKpiCard('Atendimentos', data.kpis.atendimentos.valor, data.kpis.atendimentos.variacao_pct, 'numero')}
      ${relatoriosKpiCard('Clientes', data.kpis.clientes.valor, data.kpis.clientes.variacao_pct, 'numero')}
      ${relatoriosKpiCard('Ticket médio', data.kpis.ticket_medio.valor, data.kpis.ticket_medio.variacao_pct, 'moeda')}
    </div>

    <div class="relatorios-grid-2col">
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Faturamento</h3>
        ${renderGraficoFaturamentoDiario(data.faturamento_diario)}
        ${relatoriosComparacaoMensalHtml(data.kpis.faturamento)}
      </div>
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Desempenho da agenda — ${data.agenda.atendimentos_total} atendimento${data.agenda.atendimentos_total === 1 ? '' : 's'}</h3>
        ${renderDesempenhoAgenda(data.agenda)}
      </div>
    </div>

    <div class="relatorios-grid-2col">
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Faturamento por serviço</h3>
        ${renderTabelaServicosRelatorio(data.servicos)}
      </div>
      <div class="relatorios-secao">
        <h3 class="inicio-secao-titulo">Clientes</h3>
        ${renderSecaoClientesRelatorio(data.clientes, data.kpis.ticket_medio.valor)}
      </div>
    </div>

    <div class="relatorios-secao relatorios-secao-larga">
      <h3 class="inicio-secao-titulo">Resultado financeiro</h3>
      ${renderSecaoFinanceiroRelatorio(data.financeiro)}
    </div>

    <div class="relatorios-secao relatorios-secao-larga relatorios-insights">
      <h3 class="inicio-secao-titulo">✨ Insights da Kyvvo</h3>
      ${renderInsightsRelatorio(data.insights)}
    </div>
  `;

  conteudo.innerHTML = html;
  bindNavPeriodoRelatorios();
}
