// Bloqueios manuais de agenda — extraído de app.js (fase 4c da
// modularização, 2026-10-16). O "Menu ⋯" de cada linha (editar/desabilitar/
// excluir) e o clique na linha (abrir edição) são tratados pelos listeners
// globais `ds-acoes-escolher`/`click`, que ficam em app.js (precisam ficar
// no mesmo escopo de todas as outras telas que os usam) — por isso
// `bloqueiosAtuais`, `abrirModalBloqueio`, `abrirModalExcluirBloqueio` e
// `alternarAtivoBloqueio` são exportados.
import { api } from '../core/api.js';
import {
  conteudo, mostrarToast, abrirModal, fecharModal, escapeHtml, validarObrigatorios,
  formatarDataISO, formatarHora, formatarDataCurta, contaStatus,
} from '../core/shell.js';

export let bloqueiosAtuais = [];

// Linha de tabela no padrão CRUD compartilhado (mesmo de Serviços/
// Profissionais): clicar na linha abre a edição, o "⋯" é o componente
// .ds-acoes do design system.
function renderBloqueioLinha(b) {
  const periodo = `${formatarDataCurta(b.inicio)} ${formatarHora(b.inicio)} – ${formatarDataCurta(b.fim)} ${formatarHora(b.fim)}`;
  const desabilitado = b.ativo === false;
  return `
    <tr class="linha-clicavel" data-bloqueio-abrir="${b.id}">
      <td>
        <div>${periodo}</div>
        ${b.motivo ? `<div class="cliente-linha-telefone">${escapeHtml(b.motivo)}</div>` : ''}
      </td>
      <td>${b.profissional ? escapeHtml(b.profissional) : 'Toda a agenda'}</td>
      <td>${desabilitado ? '<span class="badge badge-status-inativo">Desabilitado</span>' : '<span class="badge badge-status-ativo">Ativo</span>'}</td>
      <td>
        <span class="ds-acoes" data-bloqueio-id="${b.id}">
          <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações">⋯</button>
          <div class="ds-acoes-menu" role="menu" hidden>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="editar">Editar</button>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="${desabilitado ? 'habilitar' : 'desabilitar'}">${desabilitado ? 'Habilitar' : 'Desabilitar'}</button>
            <button type="button" role="menuitem" class="ds-acoes-item ds-acoes-item-perigo" data-acao="excluir">Excluir</button>
          </div>
        </span>
      </td>
    </tr>
  `;
}

export async function alternarAtivoBloqueio(bloqueio) {
  const resultado = await api(`/api/bloqueios/${bloqueio.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !bloqueio.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(resultado.ativo ? 'Bloqueio habilitado.' : 'Bloqueio desabilitado.', 'sucesso');
    renderBloqueios();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar bloqueio.', 'erro');
  }
}

export async function renderBloqueios() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [dataBloqueios, dataFeriados] = await Promise.all([
    api('/api/bloqueios'),
    api('/api/feriados'),
  ]);
  if (!dataBloqueios || !dataFeriados) return;
  bloqueiosAtuais = dataBloqueios.bloqueios;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Bloqueio de agenda</h2>
      <button class="btn-novo-agendamento" id="btn-novo-bloqueio">+ Novo bloqueio</button>
    </div>

    <h3 class="inicio-secao-titulo">Feriados nacionais</h3>
    <div class="pagamento-plano-card" style="margin-bottom:16px">
      <div class="pagamento-plano-linha">
        <span>Bloquear feriados nacionais para agendamento</span>
        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="toggle-feriados" ${dataFeriados.habilitado ? 'checked' : ''}>
            <span class="toggle-switch-trilho"></span>
          </span>
          <span id="toggle-feriados-texto">${dataFeriados.habilitado ? 'Desabilitar' : 'Habilitar'}</span>
        </label>
      </div>
    </div>
    <div class="relatorios-status-lista" style="margin-bottom:24px">
      ${dataFeriados.feriados.map((f) => `
        <div class="relatorios-status-linha">
          <span>${escapeHtml(f.nome)}</span>
          <span>${String(f.dia).padStart(2, '0')}/${String(f.mes).padStart(2, '0')}</span>
        </div>
      `).join('')}
    </div>

    <div class="pagamento-secao-divisor"></div>
    <h3 class="inicio-secao-titulo">Bloqueios manuais</h3>
  `;

  if (!bloqueiosAtuais.length) {
    html += '<div class="vazio">Nenhum bloqueio cadastrado ainda.</div>';
  } else {
    html += `
      <div class="tabela-wrapper">
        <table class="tabela-tenants tabela-crud-compacta">
          <thead>
            <tr>
              <th>Período</th>
              <th>Profissional</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${bloqueiosAtuais.map(renderBloqueioLinha).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-bloqueio').addEventListener('click', () => abrirModalBloqueio());
  wireToggleFeriados();
}

// Feriados nacionais não são editáveis (calculados, ver listarFeriadosNacionais
// no backend) — só o switch. Habilitar pede confirmação num modal (não
// window.confirm nativo, pra ficar no mesmo visual do resto do app) porque
// move agendamentos já marcados num feriado pro primeiro dia útil seguinte;
// desabilitar não precisa de confirmação (não é destrutivo, só libera as
// datas de novo).
function wireToggleFeriados() {
  const toggle = document.getElementById('toggle-feriados');
  const textoToggle = document.getElementById('toggle-feriados-texto');

  async function salvarFeriados(habilitado) {
    toggle.disabled = true;
    const resultado = await api('/api/feriados', {
      method: 'PATCH',
      body: JSON.stringify({ habilitado }),
    });
    if (resultado && !resultado.error) {
      const mensagem = habilitado
        ? (resultado.agendamentos_movidos > 0
          ? `Feriados nacionais bloqueados. ${resultado.agendamentos_movidos} agendamento(s) movido(s) para o primeiro dia útil disponível.`
          : 'Feriados nacionais bloqueados para agendamento.')
        : 'Feriados nacionais liberados para agendamento novamente.';
      mostrarToast(mensagem, 'sucesso');
      textoToggle.textContent = habilitado ? 'Desabilitar' : 'Habilitar';
      toggle.disabled = false;
    } else {
      toggle.checked = !habilitado;
      toggle.disabled = false;
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
    }
  }

  toggle.addEventListener('change', () => {
    const vaiHabilitar = toggle.checked;
    if (!vaiHabilitar) {
      salvarFeriados(false);
      return;
    }
    abrirModal(
      '<h3>Bloquear feriados nacionais</h3>',
      `
        <p class="modal-texto">Nenhum cliente vai conseguir marcar horário em feriado nacional. Se já existir algum agendamento confirmado numa dessas datas, ele será movido automaticamente para o primeiro dia útil disponível, no mesmo horário.</p>
        <div class="modal-acoes">
          <button class="btn-secundario" id="btn-cancelar-feriados">Cancelar</button>
          <button class="btn-primario" id="btn-confirmar-feriados">Confirmar</button>
        </div>
      `
    );
    document.getElementById('btn-cancelar-feriados').addEventListener('click', () => {
      toggle.checked = false;
      fecharModal();
    });
    document.getElementById('btn-confirmar-feriados').addEventListener('click', async () => {
      fecharModal();
      await salvarFeriados(true);
    });
  });
}

export function abrirModalBloqueio(bloqueio) {
  const editando = !!bloqueio;
  const hoje = formatarDataISO(new Date());
  // Campo de profissional é uma diferenciação por plano (não pela contagem
  // de profissionais como em mostrar_profissional, usado no resto do app) —
  // decisão do Bruno: todo plano exceto o Essencial (chave 'starter') pode
  // bloquear a agenda de um profissional específico; no Essencial o bloqueio
  // sempre vale pra agenda inteira.
  const mostrarProfissional = contaStatus && contaStatus.plano !== 'starter';

  const horaInputValor = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
  const periodoInicioValor = editando ? formatarDataISO(new Date(bloqueio.inicio)) : hoje;
  const periodoFimValor = editando ? formatarDataISO(new Date(bloqueio.fim)) : hoje;
  const horaInicioValor = editando ? horaInputValor(bloqueio.inicio) : '';
  const horaFimValor = editando ? horaInputValor(bloqueio.fim) : '';
  const diaTodoChecked = editando && periodoInicioValor === periodoFimValor && horaInicioValor === '00:00' && horaFimValor === '23:59';

  abrirModal(
    `<h3>${editando ? 'Editar bloqueio' : 'Novo bloqueio'}</h3>`,
    `
      <form id="form-bloqueio">
        <div class="modal-erro" id="bloqueio-erro"></div>
        <label for="bloqueio-periodo-inicio">Período *</label>
        <div class="campo-periodo">
          <input type="date" id="bloqueio-periodo-inicio" data-obrigatorio min="${editando ? '' : hoje}" value="${periodoInicioValor}">
          <span class="periodo-separador">até</span>
          <input type="date" id="bloqueio-periodo-fim" data-obrigatorio min="${editando ? '' : hoje}" value="${periodoFimValor}">
        </div>
        <label for="bloqueio-hora-inicio">Hora de início *</label>
        <input type="time" id="bloqueio-hora-inicio" data-obrigatorio value="${diaTodoChecked ? '' : horaInicioValor}">
        <label for="bloqueio-hora-fim">Hora de fim *</label>
        <input type="time" id="bloqueio-hora-fim" data-obrigatorio value="${diaTodoChecked ? '' : horaFimValor}">
        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="bloqueio-dia-todo" ${diaTodoChecked ? 'checked' : ''}>
            <span class="toggle-switch-trilho"></span>
          </span>
          Dia todo
        </label>
        <div class="campo-aviso" id="bloqueio-horario-aviso"></div>
        <label for="bloqueio-profissional"${mostrarProfissional ? '' : ' hidden style="display:none"'}>Profissional (opcional)</label>
        <select id="bloqueio-profissional"${mostrarProfissional ? '' : ' hidden style="display:none"'}><option value="">Toda a agenda</option></select>
        <label for="bloqueio-motivo">Motivo (opcional)</label>
        <input type="text" id="bloqueio-motivo" placeholder="Ex: Férias, Feriado, Compromisso pessoal" value="${editando && bloqueio.motivo ? escapeHtml(bloqueio.motivo) : ''}">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-bloqueio">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-bloqueio">${editando ? 'Salvar' : 'Criar bloqueio'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-bloqueio').addEventListener('click', fecharModal);

  if (mostrarProfissional) {
    api('/api/profissionais').then((resultado) => {
      const select = document.getElementById('bloqueio-profissional');
      if (!resultado || !resultado.profissionais) return;
      select.innerHTML = '<option value="">Toda a agenda</option>' +
        resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
      if (editando && bloqueio.profissional_id) select.value = bloqueio.profissional_id;
    });
  }

  // Horário só faz sentido quando o período é um único dia — um bloqueio de
  // vários dias (ex: férias) cobre o dia inteiro em cada um deles. Fora
  // desse caso os campos de hora ficam desabilitados (e saem da validação
  // obrigatória); o payload usa 00:00–23:59:59 pro período inteiro.
  const periodoInicioEl = document.getElementById('bloqueio-periodo-inicio');
  const periodoFimEl = document.getElementById('bloqueio-periodo-fim');
  const horaInicioEl = document.getElementById('bloqueio-hora-inicio');
  const horaFimEl = document.getElementById('bloqueio-hora-fim');
  const horarioAvisoEl = document.getElementById('bloqueio-horario-aviso');
  const diaTodoEl = document.getElementById('bloqueio-dia-todo');

  function atualizarHabilitacaoHorario() {
    // Fim nunca pode ficar antes do início — ajusta o mínimo permitido e
    // empurra o valor pra frente se o usuário mudou o início pra depois do
    // fim já escolhido.
    periodoFimEl.min = periodoInicioEl.value || hoje;
    if (periodoFimEl.value && periodoInicioEl.value && periodoFimEl.value < periodoInicioEl.value) {
      periodoFimEl.value = periodoInicioEl.value;
    }

    const mesmoDia = periodoInicioEl.value && periodoInicioEl.value === periodoFimEl.value;
    // "Dia todo" (pedido explícito 2026-09-17) desabilita a hora igual um
    // período de vários dias já fazia — antes só dava pra bloquear o dia
    // inteiro criando um período multi-dia (mesmo início e fim), sem opção
    // explícita pra um único dia.
    const usaHorario = mesmoDia && !diaTodoEl.checked;
    [horaInicioEl, horaFimEl].forEach((campo) => {
      campo.disabled = !usaHorario;
      campo.classList.remove('campo-invalido');
      if (usaHorario) {
        campo.setAttribute('data-obrigatorio', '');
      } else {
        campo.removeAttribute('data-obrigatorio');
        campo.value = '';
      }
    });
    diaTodoEl.disabled = !mesmoDia;
    horarioAvisoEl.textContent = usaHorario
      ? ''
      : mesmoDia
        ? 'Bloqueia o dia inteiro, sem horário específico.'
        : 'Período de mais de um dia — o bloqueio vale o dia inteiro, sem horário específico.';
  }
  periodoInicioEl.addEventListener('change', atualizarHabilitacaoHorario);
  periodoFimEl.addEventListener('change', atualizarHabilitacaoHorario);
  diaTodoEl.addEventListener('change', atualizarHabilitacaoHorario);
  atualizarHabilitacaoHorario();

  const form = document.getElementById('form-bloqueio');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('bloqueio-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    // Ancorado em Brasília (-03:00), mesmo padrão do resto do sistema —
    // nunca deixar o fuso do navegador do usuário influenciar o horário.
    // Período de mais de um dia OU "Dia todo" marcado ignora os campos de
    // hora (desabilitados, ver atualizarHabilitacaoHorario) e cobre o dia
    // inteiro em cada ponta.
    const usaHorarioAoSalvar = periodoInicioEl.value === periodoFimEl.value && !diaTodoEl.checked;
    const horaInicio = usaHorarioAoSalvar ? `${horaInicioEl.value}:00` : '00:00:00';
    const horaFim = usaHorarioAoSalvar ? `${horaFimEl.value}:00` : '23:59:59';
    const inicioISO = new Date(`${periodoInicioEl.value}T${horaInicio}-03:00`).toISOString();
    const fimISO = new Date(`${periodoFimEl.value}T${horaFim}-03:00`).toISOString();

    if (fimISO <= inicioISO) {
      erroEl.textContent = 'O fim do bloqueio deve ser depois do início.';
      return;
    }

    const btn = document.getElementById('btn-salvar-bloqueio');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      inicio: inicioISO,
      fim: fimISO,
      profissional_id: document.getElementById('bloqueio-profissional').value || null,
      motivo: document.getElementById('bloqueio-motivo').value.trim() || null,
    };

    const resultado = await api(editando ? `/api/bloqueios/${bloqueio.id}` : '/api/bloqueios', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Bloqueio atualizado com sucesso.' : 'Bloqueio criado com sucesso.', 'sucesso');
      renderBloqueios();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar bloqueio.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar bloqueio';
    }
  });
}

export function abrirModalExcluirBloqueio(bloqueio) {
  abrirModal(
    '<h3>Excluir bloqueio</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir esse bloqueio? A agenda volta a ficar disponível nesse período.</p>
      <div class="modal-erro" id="excluir-bloqueio-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-bloqueio">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-bloqueio">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-bloqueio').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-bloqueio').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-bloqueio');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/bloqueios/${bloqueio.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Bloqueio excluído com sucesso.', 'sucesso');
      renderBloqueios();
    } else {
      document.getElementById('excluir-bloqueio-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir bloqueio.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}
