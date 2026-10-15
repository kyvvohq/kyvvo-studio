// Notificações (Regras + Histórico) — extraído de app.js (fase 2 da
// modularização, 2026-10-15). Diferente do balão de notificações do header
// (carregarNotificacoes, que mora em core/shell.js por ser usado desde o
// boot do app inteiro), esta é a TELA de configuração de quais canais
// disparam cada tipo de evento.
import { api } from '../core/api.js';
import { conteudo, mostrarToast, escapeHtml, configuracao, carregarConfiguracao, definirConfiguracao, carregarNotificacoes } from '../core/shell.js';

// Configurações > Notificações — liga/desliga cada tipo (lib/notificacoes.js
// no backend, mesma lista replicada aqui só com chave+título pra não
// precisar de um endpoint próprio só pra listar os tipos existentes). Salva
// na hora ao trocar o toggle (sem botão "Salvar" — cada linha já é a própria
// ação), reaproveitando o mesmo PATCH /api/configuracao de Preferências
// (campo notificacoesAtivas). Os 3 últimos são "orientados a evento"
// (disparados uma vez quando o fato acontece — não há "estado atual" pra
// recalcular como nos 2 primeiros); pra esta tela não faz diferença, todos
// aparecem como linha igual, só variando os canais que cada um oferece.
const TIPOS_NOTIFICACAO = [
  { chave: 'whatsapp_aguardando_humano', titulo: 'Conversas de WhatsApp aguardando atendimento humano' },
  {
    chave: 'disparos_acabando',
    titulo: 'Disparos de WhatsApp acabando',
    campoNumerico: { chave: 'limiar', label: 'Avisar quando restarem apenas', sufixo: 'disparos WhatsApp', padrao: 10 },
  },
  { chave: 'agenda_criada', titulo: 'Novo agendamento criado' },
  { chave: 'agenda_confirmada', titulo: 'Agendamento confirmado' },
  { chave: 'agenda_remarcada', titulo: 'Agendamento remarcado' },
];

function notificacaoConfigAtual(chave) {
  const cfg = (configuracao.notificacoes_ativas || {})[chave];
  return cfg && typeof cfg === 'object' ? cfg : {};
}

// Espelha lib/notificacoes.js#canaisAtivos no backend — formato novo
// ({canais:{studio,email,whatsapp}}) e formato antigo ({ativo: bool}, de
// antes desta tela existir, tratado como "só Studio", que é o que sempre foi
// até aqui) precisam ler igual dos dois lados.
function canaisAtivosNotificacao(cfg) {
  if (cfg && cfg.canais && typeof cfg.canais === 'object') {
    return { studio: cfg.canais.studio !== false, email: !!cfg.canais.email, whatsapp: !!cfg.canais.whatsapp };
  }
  return { studio: cfg ? cfg.ativo !== false : true, email: false, whatsapp: false };
}

function renderNotificacaoLinha(tipo) {
  const cfg = notificacaoConfigAtual(tipo.chave);
  const canais = canaisAtivosNotificacao(cfg);
  const toggleCanal = (canal) => `
    <span class="toggle-switch">
      <input type="checkbox" class="notificacao-canal" data-chave="${tipo.chave}" data-canal="${canal}" ${canais[canal] ? 'checked' : ''}>
      <span class="toggle-switch-trilho"></span>
    </span>
  `;
  return `
    <tr data-chave="${tipo.chave}">
      <td>
        <div>${escapeHtml(tipo.titulo)}</div>
        ${tipo.campoNumerico ? `
          <div class="notificacao-campo-numerico" style="margin-top:6px;font-size:13px;color:var(--muted-strong)">
            ${escapeHtml(tipo.campoNumerico.label)}
            <input type="number" min="1" step="1" class="notificacao-numerico" data-chave="${tipo.chave}" data-campo="${tipo.campoNumerico.chave}" value="${cfg[tipo.campoNumerico.chave] || tipo.campoNumerico.padrao}" style="width:70px;margin:0 6px">
            ${escapeHtml(tipo.campoNumerico.sufixo || '')}
          </div>
        ` : ''}
      </td>
      <td>${toggleCanal('email')}</td>
      <td>${toggleCanal('whatsapp')}</td>
      <td>${toggleCanal('studio')}</td>
    </tr>
  `;
}

// "Notificações" em 2 abas (Regras / Histórico), mesmo componente data-ds-abas
// já usado em Plano e cobrança — Regras é a tabela de canais que já existia
// (renomeada, comportamento igual); Histórico é novo: log de tudo que já foi
// disparado (lido ou não), pra auditoria — GET /api/notificacoes/historico.
let abaNotificacoesAtiva = 'regras';

function renderHistoricoNotificacaoLinha(item) {
  const dataLabel = new Date(item.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `
    <tr>
      <td>${dataLabel}</td>
      <td>${escapeHtml(item.tipoTitulo)}</td>
      <td>
        <div>${escapeHtml(item.titulo)}</div>
        ${item.detalhe ? `<div class="notificacao-historico-detalhe">${escapeHtml(item.detalhe)}</div>` : ''}
      </td>
      <td>
        ${item.lida
          ? '<span class="badge badge-status-inativo">Lida</span>'
          : `<button type="button" class="btn-secundario btn-pequeno notificacao-historico-marcar-lida" data-id="${item.id}">Marcar como lida</button>`}
      </td>
    </tr>
  `;
}

export async function renderNotificacoes() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [, historicoResp] = await Promise.all([carregarConfiguracao(), api('/api/notificacoes/historico')]);
  const historico = (historicoResp && historicoResp.historico) || [];

  const regrasHtml = `
    <div class="tabela-wrapper">
      <table class="tabela-tenants tabela-crud-compacta">
        <thead>
          <tr>
            <th>Descrição</th>
            <th>E-mail</th>
            <th>WhatsApp</th>
            <th>Studio</th>
          </tr>
        </thead>
        <tbody>
          ${TIPOS_NOTIFICACAO.map(renderNotificacaoLinha).join('')}
        </tbody>
      </table>
    </div>
  `;
  const historicoHtml = `
    <div class="tabela-wrapper">
      <table class="tabela-tenants tabela-crud-compacta">
        <thead>
          <tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${historico.length ? historico.map(renderHistoricoNotificacaoLinha).join('') : '<tr><td colspan="4">Nenhuma notificação registrada ainda.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  conteudo.innerHTML = `
    <div class="inicio-cabecalho"><h2>Notificações</h2></div>
    <div class="ds-abas" data-ds-abas>
      <div class="ds-abas-lista">
        <button type="button" class="ds-aba" id="aba-notificacoes-regras" aria-controls="painel-notificacoes-regras" aria-selected="${abaNotificacoesAtiva === 'regras' ? 'true' : 'false'}">Regras</button>
        <button type="button" class="ds-aba" id="aba-notificacoes-historico" aria-controls="painel-notificacoes-historico" aria-selected="${abaNotificacoesAtiva === 'historico' ? 'true' : 'false'}">Histórico</button>
      </div>
      <div class="ds-abas-painel" id="painel-notificacoes-regras" aria-labelledby="aba-notificacoes-regras" ${abaNotificacoesAtiva === 'regras' ? '' : 'hidden'}>${regrasHtml}</div>
      <div class="ds-abas-painel" id="painel-notificacoes-historico" aria-labelledby="aba-notificacoes-historico" ${abaNotificacoesAtiva === 'historico' ? '' : 'hidden'}>${historicoHtml}</div>
    </div>
  `;
  conteudo.querySelector('.ds-abas').addEventListener('ds-abas-alterar', (e) => {
    abaNotificacoesAtiva = e.detail.id === 'painel-notificacoes-historico' ? 'historico' : 'regras';
  });

  // Cada mudança (canal ou número) manda o objeto INTEIRO daquela chave já
  // mesclado — mesmo padrão de formas_pagamento (PATCH substitui o objeto
  // completo, não mescla parcial no backend). `canais` sempre vai completo
  // (os 3 booleanos), nunca só o que mudou — e sem `ativo` sobrando do
  // formato antigo, migrando pro formato novo na primeira mudança.
  async function salvar(chave, novoCfgParcial) {
    const cfgAtual = notificacaoConfigAtual(chave);
    const { ativo, ...resto } = cfgAtual;
    const notificacoesAtivas = { ...configuracao.notificacoes_ativas, [chave]: { ...resto, ...novoCfgParcial } };
    const resultado = await api('/api/configuracao', { method: 'PATCH', body: JSON.stringify({ notificacoesAtivas }) });
    if (resultado && !resultado.error) {
      definirConfiguracao(resultado);
      mostrarToast('Salvo com sucesso!', 'sucesso');
      carregarNotificacoes();
      return true;
    }
    mostrarToast((resultado && resultado.error) || 'Erro ao salvar.', 'erro');
    return false;
  }

  conteudo.querySelectorAll('.notificacao-canal').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const chave = chk.dataset.chave;
      const canaisAtuais = canaisAtivosNotificacao(notificacaoConfigAtual(chave));
      const ok = await salvar(chave, { canais: { ...canaisAtuais, [chk.dataset.canal]: chk.checked } });
      if (!ok) chk.checked = !chk.checked;
    });
  });

  conteudo.querySelectorAll('.notificacao-numerico').forEach((input) => {
    input.addEventListener('change', async () => {
      const valor = parseInt(input.value, 10);
      if (!Number.isInteger(valor) || valor < 1) {
        mostrarToast('Informe um número inteiro maior que zero.', 'erro');
        return;
      }
      const chave = input.dataset.chave;
      const canaisAtuais = canaisAtivosNotificacao(notificacaoConfigAtual(chave));
      await salvar(chave, { canais: canaisAtuais, [input.dataset.campo]: valor });
    });
  });

  conteudo.querySelectorAll('.notificacao-historico-marcar-lida').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const resultado = await api(`/api/notificacoes/${btn.dataset.id}/lida`, { method: 'PATCH' });
      if (resultado && !resultado.error) {
        renderNotificacoes();
        carregarNotificacoes();
      }
    });
  });
}
