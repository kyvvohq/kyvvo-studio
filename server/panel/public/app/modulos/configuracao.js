// Configuração (Preferências) — extraído de app.js (fase 3 da modularização,
// 2026-10-15).
import { api } from '../core/api.js';
import {
  conteudo, mostrarToast, abrirModal, fecharModal,
  configuracao, carregarConfiguracao, definirConfiguracao, infoSegmento, ativarSalvarSoQuandoAlterado,
  NOMES_DIAS, FORMAS_PAGAMENTO_ORDEM, FORMAS_PAGAMENTO_LABEL, FORMAS_PAGAMENTO_SEM_TAXA,
} from '../core/shell.js';

function formasPagamentoConfigHtml(formasPagamento) {
  return FORMAS_PAGAMENTO_ORDEM.map((chave) => {
    const cfg = formasPagamento[chave] || {};
    const semTaxa = FORMAS_PAGAMENTO_SEM_TAXA.includes(chave);
    return `
      <div class="forma-pagamento-config-linha">
        <label class="toggle-linha" style="margin-top:0">
          <span class="toggle-switch">
            <input type="checkbox" class="forma-pagamento-ativo" data-chave="${chave}" ${cfg.ativo ? 'checked' : ''}>
            <span class="toggle-switch-trilho"></span>
          </span>
          ${FORMAS_PAGAMENTO_LABEL[chave]}
        </label>
        ${semTaxa ? '' : `
          <div class="forma-pagamento-taxa-campo">
            <input type="number" class="forma-pagamento-taxa" data-chave="${chave}" min="0" max="100" step="0.01" placeholder="Ex: 4,99" value="${cfg.taxa != null ? cfg.taxa : ''}" ${cfg.ativo ? '' : 'disabled'}>
            <span>%</span>
          </div>
        `}
      </div>
    `;
  }).join('');
}

// Confirmação antes de desabilitar um dia de funcionamento que estava
// marcado — o próprio PATCH /api/configuracao já move (sem checar colisão,
// decisão confirmada) os agendamentos futuros confirmados desse dia pro
// próximo dia que continua aberto, então essa confirmação só avisa a
// consequência antes de disparar o salvamento em si (mesmo padrão visual
// dos outros popups de confirmação desta sessão).
function abrirModalConfirmarDiasFechados(onContinuar) {
  abrirModal(
    '<h3>Desabilitar dia de funcionamento</h3>',
    `
      <p class="modal-texto">Se houver algum agendamento marcado nesse(s) dia(s), ele será movido automaticamente para o próximo dia útil disponível. Deseja continuar?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-cancelar-dias-fechados">Cancelar</button>
        <button class="btn-primario" id="btn-continuar-dias-fechados">Continuar</button>
      </div>
    `
  );

  document.getElementById('btn-cancelar-dias-fechados').addEventListener('click', fecharModal);
  document.getElementById('btn-continuar-dias-fechados').addEventListener('click', () => {
    fecharModal();
    onContinuar();
  });
}

export async function renderConfiguracao() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  await carregarConfiguracao();
  const dias = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  // "time" do Postgres vem com segundos ("08:00:00"); <input type="time">
  // espera "HH:MM".
  const horarioAbertura = (configuracao.horario_abertura || '08:00').slice(0, 5);
  const horarioFechamento = (configuracao.horario_fechamento || '20:00').slice(0, 5);
  const almocoAtivo = !!configuracao.horario_almoco_ativo;
  const almocoInicio = (configuracao.horario_almoco_inicio || '12:00').slice(0, 5);
  const almocoFim = (configuracao.horario_almoco_fim || '13:00').slice(0, 5);
  const clienteInativoDias = configuracao.cliente_inativo_dias || 30;
  const clienteNovoDias = configuracao.cliente_novo_dias || 30;
  const formasPagamento = configuracao.formas_pagamento || {};

  const toggleDias = NOMES_DIAS.map((nome, idx) => `
    <label class="dia-toggle-cel">
      <span class="dia-toggle-nome">${nome.slice(0, 3)}</span>
      <span class="toggle-switch">
        <input type="checkbox" value="${idx}" ${dias.includes(idx) ? 'checked' : ''}>
        <span class="toggle-switch-trilho"></span>
      </span>
    </label>
  `).join('');

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <h2>Preferências</h2>
      <button type="submit" form="form-config" class="btn-novo-agendamento" id="btn-salvar-config">Salvar</button>
    </div>
    <form class="perfil-form" id="form-config">
      <label>Dias em que ${infoSegmento(configuracao.segmento).dias} funciona (aparecem na agenda)</label>
      <div class="dias-grid">${toggleDias}</div>

      <label>Horário de funcionamento</label>
      <div class="formato-hora-opcoes">
        <div>
          <label for="config-horario-abertura">Abertura</label>
          <input type="time" id="config-horario-abertura" value="${horarioAbertura}">
        </div>
        <div>
          <label for="config-horario-fechamento">Fechamento</label>
          <input type="time" id="config-horario-fechamento" value="${horarioFechamento}">
        </div>
      </div>
      <div class="modal-texto">Agendamentos só podem ser feitos dentro desse intervalo.</div>

      <label class="toggle-linha" style="margin-top:16px">
        <span class="toggle-switch">
          <input type="checkbox" id="config-almoco-ativo" ${almocoAtivo ? 'checked' : ''}>
          <span class="toggle-switch-trilho"></span>
        </span>
        Habilitar horário de almoço
      </label>
      <div class="formato-hora-opcoes" id="config-almoco-campos" style="${almocoAtivo ? '' : 'display:none'}">
        <div>
          <label for="config-almoco-inicio">Início</label>
          <input type="time" id="config-almoco-inicio" value="${almocoInicio}">
        </div>
        <div>
          <label for="config-almoco-fim">Término</label>
          <input type="time" id="config-almoco-fim" value="${almocoFim}">
        </div>
      </div>

      <label for="config-cliente-inativo-dias" style="margin-top:16px">Considerar cliente inativo após quantos dias sem retorno?</label>
      <input type="number" id="config-cliente-inativo-dias" min="1" max="365" step="1" value="${clienteInativoDias}" style="max-width:120px">
      <div class="modal-texto">Usado na tela Clientes (quadro "Para retornar") e no card "Clientes sem retorno" do Início.</div>

      <label for="config-cliente-novo-dias" style="margin-top:16px">Considerar cliente Novo até quantos dias?</label>
      <input type="number" id="config-cliente-novo-dias" min="1" max="365" step="1" value="${clienteNovoDias}" style="max-width:120px">
      <div class="modal-texto">Usado na tela Clientes (quadro "Novos clientes") — contado a partir da data de cadastro.</div>

      <label style="margin-top:16px">Formas de pagamento</label>
      <div class="modal-texto" style="margin-top:0">Habilite as formas aceitas no salão e a taxa (%) que a maquininha/gateway cobra em cada uma — usada pra calcular o valor líquido do atendimento ao confirmar o pagamento. Dinheiro nunca tem taxa.</div>
      <div class="formas-pagamento-config">${formasPagamentoConfigHtml(formasPagamento)}</div>
    </form>
  `;

  const controleSalvarConfig = ativarSalvarSoQuandoAlterado(document.getElementById('form-config'), document.getElementById('btn-salvar-config'));

  const almocoAtivoInput = document.getElementById('config-almoco-ativo');
  const almocoCampos = document.getElementById('config-almoco-campos');
  almocoAtivoInput.addEventListener('change', () => {
    almocoCampos.style.display = almocoAtivoInput.checked ? '' : 'none';
  });

  document.querySelectorAll('.forma-pagamento-ativo').forEach((chk) => {
    chk.addEventListener('change', () => {
      const taxaInput = document.querySelector(`.forma-pagamento-taxa[data-chave="${chk.dataset.chave}"]`);
      if (taxaInput) taxaInput.disabled = !chk.checked;
    });
  });

  // Feedback de salvamento via toast (US...) — mesmo padrão do resto do
  // app (renderPerfil, renderPagamentos etc.); esta tela usava uma mensagem
  // de texto inline própria (#config-msg), inconsistente com todas as
  // outras telas de configuração/formulário do painel.
  async function salvarConfiguracao(payload) {
    const btn = document.getElementById('btn-salvar-config');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/configuracao', { method: 'PATCH', body: JSON.stringify(payload) });

    if (resultado && !resultado.error) {
      definirConfiguracao(resultado);
      mostrarToast(
        resultado.agendamentos_movidos > 0
          ? `Salvo com sucesso! ${resultado.agendamentos_movidos} agendamento(s) movido(s) para o próximo dia disponível.`
          : 'Salvo com sucesso!',
        'sucesso'
      );
      btn.textContent = 'Salvar';
      // Depois de salvar com sucesso os campos já refletem o que acabou de
      // ser persistido — sem isso o botão continuaria "sujo" (habilitado)
      // comparando com o snapshot de ANTES da edição, mesmo já salvo.
      controleSalvarConfig.resetar();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar configuração.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  }

  document.getElementById('form-config').addEventListener('submit', (e) => {
    e.preventDefault();

    const diasFuncionamento = Array.from(document.querySelectorAll('.dias-grid input:checked')).map((el) => parseInt(el.value, 10));
    const horarioAbertura = document.getElementById('config-horario-abertura').value;
    const horarioFechamento = document.getElementById('config-horario-fechamento').value;
    const horarioAlmocoAtivo = almocoAtivoInput.checked;
    const horarioAlmocoInicio = horarioAlmocoAtivo ? document.getElementById('config-almoco-inicio').value : null;
    const horarioAlmocoFim = horarioAlmocoAtivo ? document.getElementById('config-almoco-fim').value : null;
    const clienteInativoDias = parseInt(document.getElementById('config-cliente-inativo-dias').value, 10);
    if (!Number.isInteger(clienteInativoDias) || clienteInativoDias < 1 || clienteInativoDias > 365) {
      mostrarToast('Informe um número de dias entre 1 e 365 pra considerar cliente inativo.', 'erro');
      return;
    }
    const clienteNovoDias = parseInt(document.getElementById('config-cliente-novo-dias').value, 10);
    if (!Number.isInteger(clienteNovoDias) || clienteNovoDias < 1 || clienteNovoDias > 365) {
      mostrarToast('Informe um número de dias entre 1 e 365 pra considerar cliente novo.', 'erro');
      return;
    }

    const formasPagamentoPayload = {};
    let erroFormaPagamento = null;
    document.querySelectorAll('.forma-pagamento-ativo').forEach((chk) => {
      const chave = chk.dataset.chave;
      const ativo = chk.checked;
      const taxaInput = document.querySelector(`.forma-pagamento-taxa[data-chave="${chave}"]`);
      const cfg = { ativo };
      if (taxaInput) {
        const taxaValor = taxaInput.value.trim();
        if (ativo) {
          const taxa = parseFloat(taxaValor);
          if (!taxaValor || Number.isNaN(taxa) || taxa < 0 || taxa > 100) {
            erroFormaPagamento = `Informe uma taxa válida (0 a 100) pra ${FORMAS_PAGAMENTO_LABEL[chave]}.`;
          }
          cfg.taxa = taxa;
        } else {
          cfg.taxa = taxaValor ? parseFloat(taxaValor) : null;
        }
      }
      formasPagamentoPayload[chave] = cfg;
    });
    if (erroFormaPagamento) {
      mostrarToast(erroFormaPagamento, 'erro');
      return;
    }

    const payload = {
      diasFuncionamento, horarioAbertura, horarioFechamento,
      formasPagamento: formasPagamentoPayload,
      horarioAlmocoAtivo, horarioAlmocoInicio, horarioAlmocoFim,
      clienteInativoDias, clienteNovoDias,
    };

    // Só avisa/confirma quando algum dia que ANTES estava marcado foi
    // desmarcado agora — adicionar dia ou salvar sem mexer nos dias segue
    // direto pro salvamento, sem popup.
    const diasAtuais = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
    const desmarcouAlgumDia = diasAtuais.some((d) => !diasFuncionamento.includes(d));

    if (desmarcouAlgumDia) {
      abrirModalConfirmarDiasFechados(() => salvarConfiguracao(payload));
    } else {
      salvarConfiguracao(payload);
    }
  });
}
