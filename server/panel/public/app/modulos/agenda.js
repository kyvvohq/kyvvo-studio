// Fase 6a da modularização (2026-10-16): fundação da Agenda — helpers
// compartilhados por todas as visões (Início/Dia/Semana/Quadro/Mês, ainda em
// app.js até as próximas sub-fases 6b-6f), os 6 modais de ação sobre um
// agendamento e o menu de ações inline (renderAgendamentoItem). Os listeners
// globais que abrem esses modais a partir de clique em qualquer tela
// (conteudo.addEventListener('click', ...) e o listener de 'ds-acoes-escolher')
// continuam em app.js — são wiring compartilhado com Clientes/Financeiro/
// Automações/Serviços/Profissionais/Bloqueios, não pertencem só à Agenda.
//
// `render()` (dispatcher genérico de app.js) não pode ser chamado direto
// daqui — os 6 modais abrem a partir de QUALQUER visão (Início/Dia/Semana/
// Quadro/Mês/Clientes), então um `renderX()` fixo não serviria. Em vez
// disso, dispara o evento 'kyvvo:atualizar' (mesmo padrão de 'kyvvo:navegar'
// já usado desde a fase 4b) — app.js tem o único listener que chama `render()`.
import { api } from '../core/api.js';
import {
  mostrarToast, abrirModal, fecharModal, formatarDataISO, formatarHora,
  validarObrigatorios, contaStatus, formatarDataCurta, configuracao,
} from '../core/shell.js';

// Cor por profissional na agenda (avatar/borda de acento) — determinística
// por profissional_id, pra cada um manter sempre a mesma cor em qualquer
// tela/sessão sem precisar guardar nada no backend. 6 tons distintos entre
// si e sobre --card/--sunken nos dois temas (não são os tokens semânticos
// --success/--danger/etc, pra não confundir cor-de-profissional com
// cor-de-status).
const PALETA_PROFISSIONAL = ['#7C5CFC', '#22C7F2', '#12B76A', '#F79009', '#F04438', '#9578FF'];
export function corProfissional(profissionalId) {
  if (!profissionalId) return PALETA_PROFISSIONAL[0];
  let hash = 0;
  const chave = String(profissionalId);
  for (let i = 0; i < chave.length; i++) hash = (hash * 31 + chave.charCodeAt(i)) >>> 0;
  return PALETA_PROFISSIONAL[hash % PALETA_PROFISSIONAL.length];
}

// "HH:MM" em 24h de um data_hora ISO, sempre nesse formato independente da
// preferência de exibição (formatarHora abaixo) — usado só internamente,
// nunca pra exibir na tela.
export function horaChave24h(dataHoraISO) {
  return new Date(dataHoraISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
}

export function horarioParaMinutosFrontend(horario) {
  const [h, m] = horario.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// "HH:MM" do início do bucket de SLOT_INTERVALO_MINUTOS em que o horário de
// um agendamento cai — usado pra bater um agendamento com a linha certa da
// grade (Dia/Semana). Com a grade de hora em hora (PR8), um agendamento às
// 14:30 precisa cair na linha "14:00" (não existe linha "14:30"); igualdade
// exata de horaChave24h deixaria esse agendamento sem nenhuma linha pra
// entrar e ele sumiria da grade — a criação de agendamento continua em
// blocos de 30min no backend, só a granularidade de EXIBIÇÃO da grade mudou.
export function horaChaveGradeBucket(dataHoraISO) {
  const minutosNoDia = horarioParaMinutosFrontend(horaChave24h(dataHoraISO));
  const bucketMin = Math.floor(minutosNoDia / SLOT_INTERVALO_MINUTOS) * SLOT_INTERVALO_MINUTOS;
  return `${String(Math.floor(bucketMin / 60)).padStart(2, '0')}:${String(bucketMin % 60).padStart(2, '0')}`;
}

// Granularidade da grade de horários (Dia e Semana, PR8) — gera só os
// RÓTULOS "HH:MM" do intervalo abertura→fechamento configurado, excluindo o
// horário de almoço se ativo. Não depende de serviço/profissional (ao
// contrário da disponibilidade real de criação, que continua em blocos de
// 30min no backend), então dá pra montar a grade inteira só com o que já
// está em `configuracao`.
export const SLOT_INTERVALO_MINUTOS = 60;
export function gerarHorariosGrade() {
  const aberturaMin = horarioParaMinutosFrontend(configuracao.horario_abertura || '08:00');
  const fechamentoMin = horarioParaMinutosFrontend(configuracao.horario_fechamento || '20:00');
  const almocoAtivo = configuracao.horario_almoco_ativo;
  const almocoInicioMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_inicio) : null;
  const almocoFimMin = almocoAtivo ? horarioParaMinutosFrontend(configuracao.horario_almoco_fim) : null;

  const horarios = [];
  for (let m = aberturaMin; m < fechamentoMin; m += SLOT_INTERVALO_MINUTOS) {
    if (almocoAtivo && m >= almocoInicioMin && m < almocoFimMin) continue;
    horarios.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return horarios;
}

// Resumo do rodapé da grade Dia — livres/agendados/previsto, calculado no
// cliente a partir dos mesmos horários e agendamentos que a grade já usa
// (mesmo bucket de horaChaveGradeBucket), sem pedir nada novo ao backend.
export function resumoGradeDia(agendamentos) {
  const horarios = gerarHorariosGrade();
  const bucketsComItem = new Set(agendamentos.map((ag) => horaChaveGradeBucket(ag.data_hora)));
  const livres = horarios.filter((h) => !bucketsComItem.has(h)).length;
  const validos = agendamentos.filter((ag) => ag.status !== 'cancelado');
  const previsto = validos.reduce((soma, ag) => soma + Number(ag.preco || 0), 0);
  return { livres, agendados: validos.length, previsto };
}

// Anterior/Próximo na view Dia nunca param num dia fora de
// configuracao.dias_funcionamento — pula direto pro próximo dia aberto na
// direção da navegação (+1/-1). Limite de 14 tentativas é só uma trava de
// segurança contra loop infinito se dias_funcionamento vier vazio.
export function proximoDiaAberto(base, direcao) {
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const d = new Date(base);
  let tentativas = 0;
  while (!diasFuncionamento.includes(d.getDay()) && tentativas < 14) {
    d.setDate(d.getDate() + direcao);
    tentativas++;
  }
  return d;
}

// "DD/MM/YYYY" a partir de uma data pura "YYYY-MM-DD" (sem hora), ex.: as
// datas puladas de uma recorrência (POST /api/agendamentos). Não usa
// formatarDataCurta/Date aqui de propósito: `new Date('YYYY-MM-DD')` é
// interpretado como meia-noite UTC, e convertida de volta pra
// America/Sao_Paulo (-03:00) viraria o dia anterior — bug sutil de fuso que
// esse formatador evita simplesmente reordenando os componentes do texto.
function formatarDataSimples(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ---------- Modal: novo agendamento (ST09.1 a ST09.5) ----------
// Ponto de entrada do fluxo de cadastro manual (US09). A ST09.1 entregou o
// botão em destaque na agenda e a abertura do modal; a ST09.2 montou o
// formulário com todos os campos e a validação de obrigatórios com destaque
// visual em vermelho; a ST09.3 integra o dropdown de horário com
// GET /agendamentos/disponibilidade — slots ocupados desabilitados, skeleton
// loader durante a carga e aviso quando não há horário livre na data; a
// ST09.5 (submit) salva via POST /api/agendamentos (origem "portal", que a
// ST09.4 já faz upsert de cliente por telefone), fecha o modal, atualiza a
// agenda e exibe o toast de sucesso.

export function abrirModalNovoAgendamento(prefill) {
  const { data: dataPrefill, hora: horaPrefill, telefone: telefonePrefill, nome: nomePrefill } = prefill || {};
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo agendamento</h3>',
    `
      <form id="form-novo-agendamento" novalidate>
        <div class="modal-erro" id="novo-ag-erro"></div>

        <label for="novo-ag-telefone">Telefone *</label>
        <input type="tel" id="novo-ag-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off" value="${telefonePrefill || ''}">
        <div class="campo-aviso" id="novo-ag-cliente-aviso"></div>

        <label for="novo-ag-nome">Nome do cliente *</label>
        <input type="text" id="novo-ag-nome" data-obrigatorio autocomplete="off" value="${nomePrefill || ''}">

        <label for="novo-ag-servico">Serviço *</label>
        <select id="novo-ag-servico" data-obrigatorio><option value="">Carregando serviços...</option></select>

        <label for="novo-ag-profissional">Profissional *</label>
        <select id="novo-ag-profissional" data-obrigatorio><option value="">Carregando profissionais...</option></select>

        <label for="novo-ag-data">Data *</label>
        <input type="date" id="novo-ag-data" min="${hoje}" value="${dataPrefill || ''}" data-obrigatorio>

        <label for="novo-ag-horario">Horário *</label>
        <select id="novo-ag-horario" data-obrigatorio><option value="">Selecione serviço, profissional e data</option></select>
        <div class="skeleton-horario" id="novo-ag-horario-skeleton" hidden aria-hidden="true"></div>
        <div class="campo-aviso" id="novo-ag-horario-aviso"></div>

        <label for="novo-ag-observacoes">Observações</label>
        <textarea id="novo-ag-observacoes" rows="3" placeholder="Anotações internas sobre o agendamento"></textarea>

        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="novo-ag-recorrencia-switch">
            <span class="toggle-switch-trilho"></span>
          </span>
          Recorrência
        </label>

        <div id="novo-ag-recorrencia-campos" style="display:none">
          <label for="novo-ag-recorrencia-tipo">Repetir</label>
          <select id="novo-ag-recorrencia-tipo">
            <option value="">Selecione...</option>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="mensal">Mensal</option>
          </select>

          <div id="novo-ag-recorrencia-ate-wrapper" style="display:none">
            <label for="novo-ag-recorrencia-ate">Repetir até *</label>
            <input type="date" id="novo-ag-recorrencia-ate" min="${hoje}">
          </div>
        </div>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-ag">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-ag">Salvar agendamento</button>
        </div>
      </form>
    `
  );

  const form = document.getElementById('form-novo-agendamento');
  const erroEl = document.getElementById('novo-ag-erro');

  document.getElementById('btn-cancelar-novo-ag').addEventListener('click', fecharModal);

  // Recorrência: o switch revela "Repetir" (tipo); só depois de escolher um
  // tipo é que "Repetir até" aparece — mesma progressão descrita pelo Bruno
  // (habilitar > escolher frequência > só então informar o limite).
  document.getElementById('novo-ag-recorrencia-switch').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-campos').style.display = e.target.checked ? 'block' : 'none';
    if (!e.target.checked) {
      document.getElementById('novo-ag-recorrencia-tipo').value = '';
      document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = 'none';
      document.getElementById('novo-ag-recorrencia-ate').value = '';
    }
  });
  document.getElementById('novo-ag-recorrencia-tipo').addEventListener('change', (e) => {
    document.getElementById('novo-ag-recorrencia-ate-wrapper').style.display = e.target.value ? 'block' : 'none';
    if (!e.target.value) document.getElementById('novo-ag-recorrencia-ate').value = '';
  });

  // Ao corrigir um campo, remove o destaque vermelho imediatamente.
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const limpar = () => campo.classList.remove('campo-invalido');
    campo.addEventListener('input', limpar);
    campo.addEventListener('change', limpar);
  });

  // Telefone já é chave única por tenant na tabela clientes (001_init.sql) —
  // ao digitar um telefone já cadastrado, carrega o nome existente
  // automaticamente. Evita redigitar o nome de um cliente recorrente e evita
  // que um nome digitado errado sobrescreva o nome já salvo (POST
  // /api/agendamentos faz ON CONFLICT DO UPDATE do nome pelo telefone).
  const nomeInput = document.getElementById('novo-ag-nome');
  const telefoneInput = document.getElementById('novo-ag-telefone');
  const clienteAvisoEl = document.getElementById('novo-ag-cliente-aviso');
  let buscaClienteTimeout;
  let ultimoTelefoneBuscado = '';
  telefoneInput.addEventListener('input', () => {
    clearTimeout(buscaClienteTimeout);
    const digitos = telefoneInput.value.replace(/\D/g, '');
    if (digitos === ultimoTelefoneBuscado) return;
    clienteAvisoEl.textContent = '';
    if (digitos.length < 10) return;
    buscaClienteTimeout = setTimeout(async () => {
      ultimoTelefoneBuscado = digitos;
      const resultado = await api(`/api/clientes/buscar-por-telefone?telefone=${digitos}`);
      if (resultado && resultado.cliente) {
        nomeInput.value = resultado.cliente.nome || '';
        clienteAvisoEl.textContent = 'Cliente já cadastrado — nome carregado automaticamente.';
      }
    }, 400);
  });

  // Popula serviços (reutiliza GET /api/servicos, como no encaixe da ST08.6).
  // Serviços desabilitados (PR4/US17) continuam existindo mas não são
  // oferecidos pra novos agendamentos.
  let servicosCarregados = [];
  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('novo-ag-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    servicosCarregados = resultado.servicos;
    const disponiveis = servicosCarregados.filter((s) => s.ativo !== false);
    select.innerHTML = '<option value="">Selecione...</option>' +
      disponiveis.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  // Popula profissionais (GET /api/profissionais). Fora do plano Custom o
  // tenant tem 1 único profissional (garantido pelo backend) — nesse caso o
  // campo some do formulário: escolher entre uma única opção não é uma
  // decisão real do usuário. Só reaparece quando há 2+ (plano Custom).
  const labelProfissional = document.querySelector('label[for="novo-ag-profissional"]');
  const selectProfissional = document.getElementById('novo-ag-profissional');
  let profissionaisCarregados = [];

  // Profissional exclusivo (substituiu profissional_preferencial_id): quando
  // o serviço escolhido tem `profissionais_exclusivos` não-vazio, o campo
  // Profissional só oferece essas opções — servico "sem exclusividade"
  // (array vazio) continua mostrando todos, sem restringir.
  function popularSelectProfissional(idsPermitidos) {
    const valorAtual = selectProfissional.value;
    const lista = idsPermitidos && idsPermitidos.length
      ? profissionaisCarregados.filter((p) => idsPermitidos.includes(p.id))
      : profissionaisCarregados;
    selectProfissional.innerHTML = '<option value="">Selecione...</option>' +
      lista.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
    if (lista.some((p) => p.id === valorAtual)) selectProfissional.value = valorAtual;
  }

  api('/api/profissionais').then((resultado) => {
    if (!resultado || !resultado.profissionais) {
      selectProfissional.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    profissionaisCarregados = resultado.profissionais;
    popularSelectProfissional(null);
    if (profissionaisCarregados.length <= 1) {
      // `label { display: block }` (style.css) é regra de autor e vence o
      // `[hidden]` do user-agent stylesheet independente de especificidade
      // (mesma pegadinha já documentada em .cadastro-plano[hidden]) — por
      // isso o display:none precisa ser explícito aqui, não só o atributo.
      labelProfissional.hidden = true;
      labelProfissional.style.display = 'none';
      selectProfissional.hidden = true;
      selectProfissional.style.display = 'none';
      selectProfissional.removeAttribute('data-obrigatorio');
      if (profissionaisCarregados.length === 1) {
        selectProfissional.value = profissionaisCarregados[0].id;
        selectProfissional.dispatchEvent(new Event('change'));
      }
    }
  });

  // Registrado antes do listener de carregarSlotsNovoAgendamento (abaixo)
  // pra já valer na mesma mudança.
  document.getElementById('novo-ag-servico').addEventListener('change', () => {
    const servico = servicosCarregados.find((s) => s.id === document.getElementById('novo-ag-servico').value);
    popularSelectProfissional(servico ? servico.profissionais_exclusivos : null);
  });

  // ST09.3 — Carrega os slots reais de GET /agendamentos/disponibilidade sempre
  // que serviço, profissional e data estiverem selecionados (os três parâmetros
  // exigidos pelo endpoint; o serviço define a duração usada para montar os
  // slots). Reutiliza o mesmo endpoint da ST08.2 e o helper popularSelectHorarios
  // do reagendamento/encaixe. Slots ocupados ficam desabilitados com "(ocupado)".
  async function carregarSlotsNovoAgendamento() {
    const servicoId = document.getElementById('novo-ag-servico').value;
    const profissionalId = document.getElementById('novo-ag-profissional').value;
    const data = document.getElementById('novo-ag-data').value;
    const select = document.getElementById('novo-ag-horario');
    const skeleton = document.getElementById('novo-ag-horario-skeleton');
    const aviso = document.getElementById('novo-ag-horario-aviso');

    aviso.textContent = '';

    if (!servicoId || !profissionalId || !data) {
      select.hidden = false;
      skeleton.hidden = true;
      select.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    // Skeleton loader (CA08): esconde o select e mostra a barra de carregamento.
    select.hidden = true;
    select.innerHTML = '<option value="">Carregando horários...</option>';
    skeleton.hidden = false;

    // O select e o skeleton precisam voltar ao estado visível mesmo se a
    // chamada falhar (erro de rede, backend fora do ar etc.) — sem o
    // try/finally, uma falha aqui deixava o dropdown escondido pra sempre e o
    // formulário ficava impossível de preencher/salvar.
    let disponibilidade;
    try {
      disponibilidade = await api(
        `/api/agendamentos/disponibilidade?data=${data}&profissional=${profissionalId}&servico=${servicoId}`
      );
    } catch (erro) {
      disponibilidade = null;
    } finally {
      skeleton.hidden = true;
      select.hidden = false;
    }

    if (!disponibilidade || disponibilidade.error || !Array.isArray(disponibilidade.slots)) {
      select.innerHTML = '<option value="">Erro ao carregar horários</option>';
      aviso.textContent = (disponibilidade && disponibilidade.error) || 'Não foi possível carregar os horários. Tente novamente.';
      return;
    }

    // CA03: sem nenhum horário livre na data selecionada.
    if (!disponibilidade.slots.some((s) => s.disponivel)) {
      select.innerHTML = '<option value="">Nenhum horário disponível</option>';
      aviso.textContent = 'Nenhum horário disponível nesta data. Tente outra data.';
      return;
    }

    popularSelectHorarios(select, disponibilidade.slots);
    // Hover "+" na grade de Dia/Semana (PR2/PR3) pode pré-preencher um
    // horário específico — prefere esse horário se ele seguir disponível,
    // em vez do primeiro disponível que popularSelectHorarios já selecionou.
    if (horaPrefill) {
      const alvo = disponibilidade.slots.find((s) => s.disponivel && horaChave24h(s.hora) === horaPrefill);
      if (alvo) select.value = alvo.hora;
    }
    // O valor é definido programaticamente (não dispara "change"), então limpa
    // o destaque de erro manualmente caso a validação já o tivesse marcado.
    select.classList.remove('campo-invalido');
  }

  ['novo-ag-servico', 'novo-ag-profissional', 'novo-ag-data'].forEach((id) => {
    document.getElementById(id).addEventListener('change', carregarSlotsNovoAgendamento);
  });
  // O calendário nativo já dispara "change" ao escolher uma data. Para quem
  // prefere digitar a data direto no campo, o "input" garante que os horários
  // recarreguem assim que a data digitada ficar completa/válida, sem precisar
  // esperar o campo perder o foco.
  document.getElementById('novo-ag-data').addEventListener('input', carregarSlotsNovoAgendamento);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    // Recorrência: só entra no payload se o switch estiver ligado E um tipo
    // tiver sido escolhido — "Repetir até" é obrigatório nesse caso (CA do
    // Bruno), validado aqui porque não tem data-obrigatorio (só existe/é
    // exigido condicionalmente, ao contrário dos campos sempre obrigatórios
    // de cima que validarObrigatorios já cobre).
    let recorrencia;
    if (document.getElementById('novo-ag-recorrencia-switch').checked) {
      const tipo = document.getElementById('novo-ag-recorrencia-tipo').value;
      if (!tipo) {
        erroEl.textContent = 'Selecione a frequência da recorrência.';
        document.getElementById('novo-ag-recorrencia-tipo').focus();
        return;
      }
      const ateInput = document.getElementById('novo-ag-recorrencia-ate');
      const dataAgendamento = document.getElementById('novo-ag-data').value;
      if (!ateInput.value) {
        erroEl.textContent = 'Informe até quando a recorrência deve se repetir.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      if (ateInput.value <= dataAgendamento) {
        erroEl.textContent = 'A data de "Repetir até" deve ser depois da data do agendamento.';
        ateInput.classList.add('campo-invalido');
        ateInput.focus();
        return;
      }
      recorrencia = { tipo, ate: ateInput.value };
    }

    const btn = document.getElementById('btn-salvar-novo-ag');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('novo-ag-nome').value.trim(),
        cliente_telefone: document.getElementById('novo-ag-telefone').value.trim(),
        servico_id: document.getElementById('novo-ag-servico').value,
        profissional_id: document.getElementById('novo-ag-profissional').value,
        data_hora: document.getElementById('novo-ag-horario').value,
        observacoes: document.getElementById('novo-ag-observacoes').value.trim() || null,
        recorrencia,
        origem: 'portal',
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      // Recorrência (US: switch "Recorrência") — a resposta já vem com quantas
      // ocorrências extras foram criadas e quais foram puladas por conflito;
      // um segundo toast avisa isso separado do toast de sucesso, sem travar
      // o fluxo (as demais ocorrências já foram criadas normalmente).
      if (resultado.recorrencia) {
        const { criados, pulados, limite_atingido: limiteAtingido } = resultado.recorrencia;
        const repeticoesCriadas = criados === 1 ? '1 repetição criada' : `${criados} repetições criadas`;
        mostrarToast(`Agendamento cadastrado — ${repeticoesCriadas}.`, 'sucesso');
        if (pulados && pulados.length) {
          const datas = pulados.map((p) => formatarDataSimples(p.data)).join(', ');
          const repeticoesPuladas = pulados.length === 1 ? '1 repetição pulada' : `${pulados.length} repetições puladas`;
          mostrarToast(`${repeticoesPuladas} por conflito: ${datas}.`, 'erro');
        }
        if (limiteAtingido) {
          mostrarToast('Limite de repetições atingido — ajuste a data "Repetir até" se precisar de mais datas.', 'erro');
        }
      } else {
        mostrarToast('Agendamento cadastrado com sucesso.', 'sucesso');
      }
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar agendamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar agendamento';
    }
  });
}

// ---------- Modal: concluir atendimento (US64) ----------
// Marca o agendamento como concluído — converte a receita prevista do
// lançamento financeiro vinculado em realizada (CA "Cenário 5"), feito no
// backend por sincronizarLancamentoFinanceiro dentro do mesmo PATCH.
export function abrirModalConcluir(ag) {
  abrirModal(
    '<h3>Concluir atendimento</h3>',
    `
      <p class="modal-texto">Confirmar que o atendimento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)} foi concluído?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-concluir">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-concluir">Confirmar conclusão</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-concluir').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-concluir').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-concluir');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'concluido' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao concluir agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar conclusão';
    }
  });
}

// ---------- Modal: marcar falta (no-show) ----------
// Distinto de cancelar: falta é quando o cliente simplesmente não apareceu,
// não uma decisão avisada com antecedência — sincronizarLancamentoFinanceiro
// (backend) trata os dois igual pro financeiro (a receita prevista não
// acontece de qualquer jeito), mas o status do agendamento fica separado
// pra medir taxa de comparecimento e faturamento perdido por no-show no
// menu Relatórios.
export function abrirModalMarcarFalta(ag) {
  abrirModal(
    '<h3>Marcar falta</h3>',
    `
      <p class="modal-texto">Confirmar que <strong>${ag.cliente || ag.cliente_telefone}</strong> não compareceu ao atendimento de ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-falta">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-falta">Confirmar falta</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-falta').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-falta').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-falta');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'falta' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Falta registrada.', 'sucesso');
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao registrar falta.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar falta';
    }
  });
}

// ---------- Modal: cancelamento (ST08.4) ----------
export function abrirModalCancelar(ag) {
  abrirModal(
    '<h3>Cancelar agendamento</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja cancelar o agendamento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-cancelar">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-cancelar').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// ---------- Modal: reagendamento (ST08.5) ----------
function popularSelectHorarios(select, slots, bloquearOcupado = true) {
  select.innerHTML = slots
    .map((s) => `<option value="${s.hora}" ${!s.disponivel && bloquearOcupado ? 'disabled' : ''}>${formatarHora(s.hora)}${!s.disponivel ? ' (ocupado)' : ''}</option>`)
    .join('');
  const primeiraSelecionavel = bloquearOcupado ? slots.find((s) => s.disponivel) : slots[0];
  if (primeiraSelecionavel) select.value = primeiraSelecionavel.hora;
  return !!primeiraSelecionavel;
}

export function abrirModalReagendar(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Reagendar</h3>',
    `
      <div class="modal-erro" id="reagendar-erro"></div>
      <label for="reagendar-data">Nova data</label>
      <input type="date" id="reagendar-data" min="${hoje}" value="${formatarDataISO(new Date(ag.data_hora))}">
      <label for="reagendar-horario">Novo horário</label>
      <select id="reagendar-horario"><option>Carregando horários...</option></select>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-reagendar">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-reagendar" disabled>Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-reagendar').addEventListener('click', fecharModal);

  async function carregarSlots() {
    const data = document.getElementById('reagendar-data').value;
    const select = document.getElementById('reagendar-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-reagendar');
    select.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${ag.servico_id}`);
    if (!disponibilidade || disponibilidade.error) {
      select.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(select, disponibilidade.slots);
  }

  document.getElementById('reagendar-data').addEventListener('change', carregarSlots);
  document.getElementById('reagendar-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-reagendar').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-reagendar').addEventListener('click', async () => {
    const erroEl = document.getElementById('reagendar-erro');
    erroEl.textContent = '';
    const btn = document.getElementById('btn-confirmar-reagendar');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data_hora: document.getElementById('reagendar-horario').value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao reagendar.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });

  carregarSlots();
}

// ---------- Modal: encaixe (ST08.6) ----------
export function abrirModalEncaixe(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    `<h3>Encaixe${contaStatus && contaStatus.mostrar_profissional ? ` — ${ag.profissional}` : ''}</h3>`,
    `
      <div class="modal-erro" id="encaixe-erro"></div>
      <label for="encaixe-nome">Nome do cliente (opcional)</label>
      <input type="text" id="encaixe-nome">
      <label for="encaixe-whatsapp">WhatsApp</label>
      <input type="tel" id="encaixe-whatsapp" placeholder="11999999999">
      <label for="encaixe-servico">Serviço</label>
      <select id="encaixe-servico"><option value="">Carregando serviços...</option></select>
      <label for="encaixe-data">Data</label>
      <input type="date" id="encaixe-data" min="${hoje}" value="${formatarDataISO(new Date(ag.data_hora))}">
      <label for="encaixe-horario">Horário</label>
      <select id="encaixe-horario"><option>Selecione um serviço primeiro</option></select>
      <p class="modal-texto">Encaixe pode sobrepor um horário já ocupado — os marcados "(ocupado)" continuam selecionáveis de propósito.</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-encaixe">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-encaixe" disabled>Confirmar encaixe</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-encaixe').addEventListener('click', fecharModal);

  async function carregarSlotsEncaixe() {
    const servicoId = document.getElementById('encaixe-servico').value;
    const data = document.getElementById('encaixe-data').value;
    const selectHorario = document.getElementById('encaixe-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-encaixe');
    if (!servicoId) {
      selectHorario.innerHTML = '<option>Selecione um serviço primeiro</option>';
      btnConfirmar.disabled = true;
      return;
    }
    selectHorario.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${servicoId}`);
    if (!disponibilidade || disponibilidade.error) {
      selectHorario.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(selectHorario, disponibilidade.slots, false);
  }

  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('encaixe-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.servicos.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  document.getElementById('encaixe-servico').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-data').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-encaixe').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-encaixe').addEventListener('click', async () => {
    const erroEl = document.getElementById('encaixe-erro');
    erroEl.textContent = '';
    const whatsapp = document.getElementById('encaixe-whatsapp').value.trim();
    if (!whatsapp) {
      erroEl.textContent = 'Informe o WhatsApp do cliente.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-encaixe');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('encaixe-nome').value.trim() || null,
        cliente_telefone: whatsapp,
        profissional_id: ag.profissional_id,
        servico_id: document.getElementById('encaixe-servico').value,
        data_hora: document.getElementById('encaixe-horario').value,
        encaixe: true,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      document.dispatchEvent(new CustomEvent('kyvvo:atualizar'));
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao criar encaixe.';
      btn.disabled = false;
      btn.textContent = 'Confirmar encaixe';
    }
  });

  carregarSlotsEncaixe();
}

// ---------- Menu de ações inline (ST08.3) ----------
export let agendamentosAtuais = [];
export function definirAgendamentosAtuais(lista) {
  agendamentosAtuais = lista;
}

export function renderAgendamentoItem(ag) {
  const cancelado = ag.status === 'cancelado';
  // US64 — concluído também não tem mais o que fazer (mesmo raciocínio do
  // cancelado): sem menu de ações, só o badge indicando o estado final.
  const concluido = ag.status === 'concluido';
  // Falta (no-show, migration 060) é estado final igual concluído/cancelado
  // — nada mais a fazer com um agendamento já marcado como falta.
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  return `
    <div class="agendamento-item${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agendamento-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">
            ${ag.cliente || ag.cliente_telefone}${contaStatus && contaStatus.mostrar_profissional ? ` · ${ag.profissional}` : ''} · ${ag.duracao_minutos}min
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
            ${concluido ? '<span class="badge badge-concluido">Concluído</span>' : ''}
            ${falta ? '<span class="badge badge-falta">Falta</span>' : ''}
          </div>
        </div>
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="concluir" data-id="${ag.id}">Concluir</button>
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="falta" data-id="${ag.id}">Marcar falta</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}
