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
//
// Fase 6b (2026-10-16): acrescenta a visão Início (dashboard). formatarPreco
// continua global (window), definida em /pagamento-form.js — mesma
// convenção já usada em cadastro.js/financeiro.js/pagamentos.js.
import { api } from '../core/api.js';
import {
  mostrarToast, abrirModal, fecharModal, formatarDataISO, formatarHora,
  validarObrigatorios, contaStatus, formatarDataCurta, configuracao,
  escapeHtml, conteudo, textoSaudacao, iconeSvgHtml, iniciaisNome, nomeDiaSemana, inicioDaSemana, NOMES_DIAS,
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

// ---------- Início (dashboard, 5 seções) ----------
// Pendências de configuração (sem serviço, sem WhatsApp etc.) e o aviso de
// trial já aparecem globalmente (#avisos-painel/#trial-banner, US59,
// disparados em verificarStatusConta() pra toda tela) — não duplica mais
// isso aqui dentro do conteúdo do Início.
export let inicioProximosAtuais = [];

function textoDataHoje() {
  const t = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Status do atendimento no Início: verde = confirmado/concluído, amarelo = a
// confirmar, vermelho = faltou/cancelou (a cor sozinha não basta — o rótulo
// vai escrito dentro da pílula).
const STATUS_INICIO = {
  confirmado: { rotulo: 'Confirmado', classe: 'inicio-status-ok' },
  concluido: { rotulo: 'Concluído', classe: 'inicio-status-ok' },
  a_confirmar: { rotulo: 'A confirmar', classe: 'inicio-status-aviso' },
  falta: { rotulo: 'Faltou', classe: 'inicio-status-erro' },
  cancelado: { rotulo: 'Cancelado', classe: 'inicio-status-erro' },
  reagendado: { rotulo: 'Reagendado', classe: 'inicio-status-neutro' },
};

// Menu "⋯" do atendimento (componente .ds-acoes do DS) — "Ver cliente" abre o
// cadastro, "Conversa" abre o WhatsApp. Tratado em ds-acoes-escolher
// (data-inicio-agendamento-id).
function renderInicioAtendimentoItem(ag) {
  const status = STATUS_INICIO[ag.status] || { rotulo: ag.status || '—', classe: 'inicio-status-neutro' };
  const nome = ag.cliente || ag.cliente_telefone || '';
  return `
    <div class="inicio-atendimento-item" data-id="${ag.id}">
      <div class="inicio-atendimento-topo">
        <strong class="inicio-atendimento-hora">${formatarHora(ag.data_hora)}</strong>
        <span class="inicio-status ${status.classe}">${status.rotulo}</span>
        <span class="ds-acoes" data-inicio-agendamento-id="${ag.id}">
          <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações do atendimento">⋯</button>
          <div class="ds-acoes-menu" role="menu" hidden>
            <button type="button" role="menuitem" class="ds-acoes-item" data-acao="perfil">${iconeSvgHtml('users')} Ver cliente</button>
            ${ag.cliente_telefone ? `<button type="button" role="menuitem" class="ds-acoes-item" data-acao="conversa">${iconeSvgHtml('message-circle')} Conversa no WhatsApp</button>` : ''}
          </div>
        </span>
      </div>
      <div class="inicio-atendimento-cliente" title="${escapeHtml(nome)}">${escapeHtml(nome)}</div>
      <div class="inicio-atendimento-servico" title="${escapeHtml(ag.servico || '')}">${escapeHtml(ag.servico || '')}</div>
    </div>
  `;
}

// Próximos 3 atendimentos POR PROFISSIONAL, em colunas lado a lado (pedido
// explícito 2026-09-17 — antes era uma lista única paginada, sem separar
// por quem vai atender). `inicioProximosAtuais` já vem ordenado por
// data_hora (mesma ordem da API de agendamentos), então só agrupar e cortar
// nos 3 primeiros de cada profissional preserva "os PRÓXIMOS 3". Até 5
// colunas por linha (a largura mínima de cada uma é 1/5 do espaço — ver
// .inicio-proximos-colunas no CSS); a partir do 6º profissional quebra linha.
function renderInicioProximosCorpo() {
  if (!inicioProximosAtuais.length) {
    return `<div class="vazio"><span class="vazio-icone">${iconeSvgHtml('calendar-days')}</span><span>Nenhum agendamento para o restante de hoje.</span></div>`;
  }

  const colunasPorProfissional = new Map();
  for (const ag of inicioProximosAtuais) {
    const chave = ag.profissional_id || 'sem-profissional';
    if (!colunasPorProfissional.has(chave)) {
      colunasPorProfissional.set(chave, { nome: ag.profissional || 'Sem profissional', itens: [] });
    }
    const coluna = colunasPorProfissional.get(chave);
    if (coluna.itens.length < 3) coluna.itens.push(ag);
  }
  const colunas = [...colunasPorProfissional.values()];

  return `
    <div class="inicio-proximos-colunas">
      ${colunas.map((coluna) => `
        <div class="inicio-proximos-coluna">
          <div class="inicio-proximos-coluna-titulo">${escapeHtml(coluna.nome)}</div>
          <div class="inicio-atendimentos-lista">
            ${coluna.itens.map(renderInicioAtendimentoItem).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Cartão de número do Início — ícone opcional à esquerda, rótulo em caixa
// alta e o valor grande. (Antes reaproveitava .financeiro-resumo-card, que é
// centralizado e compartilhado com o Financeiro; agora é próprio do Início.)
function inicioCard(label, valorHtml, icone) {
  return `
    <div class="inicio-kpi${icone ? '' : ' inicio-kpi-sem-icone'}">
      ${icone ? `<span class="inicio-kpi-icone">${iconeSvgHtml(icone)}</span>` : ''}
      <div class="inicio-kpi-textos">
        <div class="inicio-kpi-rotulo">${label}</div>
        <div class="inicio-kpi-valor">${valorHtml}</div>
      </div>
    </div>
  `;
}

// Olho "ocultar valores" do Início — esconde tudo que é dinheiro (Previsto,
// Financeiro e a variação). Preferência por navegador (localStorage, com
// try/catch: modo privado/bloqueado cai pra "visível"). Os valores reais
// ficam em data-valor; só o texto é trocado, sem refazer as chamadas à API.
const CHAVE_INICIO_VALORES_OCULTOS = 'kyvvo_inicio_valores_ocultos';
const TEXTO_VALOR_OCULTO = 'R$ ••••';

function inicioValoresOcultos() {
  try { return localStorage.getItem(CHAVE_INICIO_VALORES_OCULTOS) === '1'; } catch (_) { return false; }
}

function inicioValorHtml(texto, classeExtra = '') {
  return `<span class="inicio-valor ${classeExtra}" data-valor="${escapeHtml(texto)}">${escapeHtml(texto)}</span>`;
}

function aplicarInicioValoresOcultos(raiz) {
  const ocultos = inicioValoresOcultos();
  raiz.classList.toggle('valores-ocultos', ocultos);
  raiz.querySelectorAll('.inicio-valor').forEach((el) => {
    el.textContent = ocultos ? TEXTO_VALOR_OCULTO : el.dataset.valor;
  });
  raiz.querySelectorAll('[data-inicio-oculta-com-valores]').forEach((el) => { el.hidden = ocultos; });
  const btn = raiz.querySelector('#btn-inicio-olho');
  if (btn) {
    btn.setAttribute('aria-pressed', ocultos ? 'true' : 'false');
    btn.setAttribute('aria-label', ocultos ? 'Mostrar valores' : 'Ocultar valores');
    btn.title = ocultos ? 'Mostrar valores' : 'Ocultar valores';
    btn.innerHTML = iconeSvgHtml(ocultos ? 'eye-off' : 'eye');
  }
}

export async function renderInicio() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const iso = formatarDataISO(new Date());
  const [data, resumo] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/inicio/resumo'),
  ]);
  if (!data || !resumo) return;

  const agora = Date.now();
  const proximos = data.agendamentos.filter((ag) => ag.status !== 'cancelado' && new Date(ag.data_hora).getTime() >= agora);
  definirAgendamentosAtuais(proximos);
  inicioProximosAtuais = proximos;

  const textoProximo = proximos.length ? ` · Próximo atendimento às ${formatarHora(proximos[0].data_hora)}` : '';

  // Financeiro — só pra quem tem o módulo ativo e pode ver dinheiro (mesma
  // restrição do endpoint /api/inicio/resumo); o backend já devolve null
  // nesse caso, então o resto da tela funciona normalmente sem essa seção.
  let financeiroHtml = '';
  if (resumo.financeiro) {
    const variacao = resumo.financeiro.variacao_pct;
    financeiroHtml = `
      <section class="inicio-secao inicio-secao-financeiro">
        <h3 class="inicio-secao-titulo">Financeiro</h3>
        <div class="inicio-financeiro-mes">
          ${inicioValorHtml(formatarPreco(resumo.financeiro.faturado_mes), 'financeiro-entrada inicio-financeiro-mes-valor')}
          <div class="inicio-financeiro-mes-rodape">
            <span class="inicio-financeiro-mes-legenda">faturado este mês</span>
            ${variacao != null ? `<span data-inicio-oculta-com-valores class="badge ${variacao >= 0 ? 'badge-variacao-positiva' : 'badge-variacao-negativa'}">${variacao >= 0 ? '+' : ''}${variacao.toFixed(0)}%</span>` : ''}
          </div>
        </div>
      </section>
    `;
  }

  // Detalhe por profissional dos horários livres de amanhã (hora cheia) —
  // só mostra a lista quando há mais de 1 profissional (com 1 só, o total
  // já diz tudo).
  const porProfissionalAmanha = resumo.oportunidades.horarios_livres_amanha_por_profissional || [];
  const detalheHorariosAmanha = porProfissionalAmanha.length > 1
    ? `<div class="inicio-oportunidade-detalhe">${porProfissionalAmanha.map((p) => `${escapeHtml(p.profissional_nome)}: ${p.livres}`).join(' · ')}</div>`
    : '';

  const oportunidadesHtml = `
    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Oportunidades</h3>
      <div class="inicio-oportunidade-item">
        <span class="inicio-oportunidade-icone">${iconeSvgHtml('users')}</span>
        <div class="inicio-oportunidade-texto">
          <span>${resumo.oportunidades.clientes_sem_retorno} clientes sem retorno há mais de ${resumo.oportunidades.cliente_inativo_dias} dias</span>
        </div>
        <button class="btn-secundario btn-pequeno" data-acao-atalho-inicio="clientes">Ver clientes</button>
      </div>
      <div class="inicio-oportunidade-item">
        <span class="inicio-oportunidade-icone">${iconeSvgHtml('calendar-days')}</span>
        <div class="inicio-oportunidade-texto">
          <span>${resumo.oportunidades.horarios_livres_amanha} horários livres amanhã</span>
          ${detalheHorariosAmanha}
        </div>
        <button class="btn-secundario btn-pequeno" data-acao-atalho-inicio="agendamento">Preencher agenda</button>
      </div>
    </section>
  `;

  // Atendimento agente Kyvvo — só existe pra tecnologia='ia' (o bot de menu
  // no n8n não grava conversas_ia); o backend já devolve null nesse caso.
  const agenteHtml = resumo.atendimento_ia ? `
    <section class="inicio-secao">
      <h3 class="inicio-secao-titulo">Atendimento agente Kyvvo</h3>
      <div class="inicio-cards inicio-cards-4">
        ${inicioCard('Conversas hoje', resumo.atendimento_ia.conversas_hoje)}
        ${inicioCard('Não concluíram', resumo.atendimento_ia.nao_concluiram_hoje)}
        ${inicioCard('Concluídos', resumo.atendimento_ia.concluidos_hoje)}
        ${inicioCard('Min. economizados', resumo.atendimento_ia.minutos_economizados_hoje)}
      </div>
    </section>
  ` : '';

  // Faixas da tela, de cima pra baixo: [Seu dia | Financeiro], os próximos
  // atendimentos em até 5 colunas e [Oportunidades | Agente Kyvvo].
  conteudo.innerHTML = `
    <div class="inicio-pagina">
      <div class="inicio-cabecalho">
        <div class="inicio-cabecalho-textos">
          <h2 id="inicio-saudacao">${textoSaudacao()}</h2>
          <p class="inicio-data">${textoDataHoje()}${textoProximo}</p>
        </div>
        <div class="inicio-cabecalho-acoes">
          <button type="button" class="inicio-olho" id="btn-inicio-olho"></button>
          <button class="btn-novo-agendamento" id="btn-inicio-novo-agendamento">+ Novo agendamento</button>
        </div>
      </div>

      <div class="inicio-faixa inicio-faixa-topo${financeiroHtml ? ' com-financeiro' : ''}">
        <section class="inicio-secao">
          <h3 class="inicio-secao-titulo">Seu dia</h3>
          <div class="inicio-cards inicio-cards-3">
            ${inicioCard('Atendimentos', resumo.atendimentos_hoje, 'calendar-days')}
            ${inicioCard('Horários livres', resumo.horarios_livres_hoje, 'clock')}
            ${inicioCard('Previsto', inicioValorHtml(formatarPreco(resumo.previsto_hoje), 'inicio-kpi-previsto'), 'wallet')}
          </div>
        </section>
        ${financeiroHtml}
      </div>

      <section class="inicio-secao">
        <h3 class="inicio-secao-titulo">Próximos atendimentos</h3>
        <div id="inicio-secao-proximos-corpo">${renderInicioProximosCorpo()}</div>
      </section>

      <div class="inicio-faixa inicio-faixa-base">
        ${oportunidadesHtml}
        ${agenteHtml}
      </div>
    </div>
  `;
  document.getElementById('btn-inicio-novo-agendamento').addEventListener('click', () => abrirModalNovoAgendamento());
  const paginaInicio = conteudo.querySelector('.inicio-pagina');
  aplicarInicioValoresOcultos(paginaInicio);
  document.getElementById('btn-inicio-olho').addEventListener('click', () => {
    try { localStorage.setItem(CHAVE_INICIO_VALORES_OCULTOS, inicioValoresOcultos() ? '0' : '1'); } catch (_) { /* sem storage: vale só até recarregar */ }
    aplicarInicioValoresOcultos(paginaInicio);
  });
}

// Fase 6c (2026-10-16): acrescenta a visão Dia. `dataRef` (dia/semana/mês
// selecionado nas visões da Agenda) também muda de dono aqui — era estado
// de app.js (ao lado de menuAtual/abaAtual), mas Semana/Quadro/Mês (ainda em
// app.js até 6d-6f) e Dia (agora aqui) e o próprio router (selecionarMenu,
// wiring de abas/"+N mais") todos precisam reatribuí-lo — mesmo problema de
// estado compartilhado de `agendamentosAtuais` na fase 6a, só que na direção
// inversa (o dono vira este módulo, app.js importa a reatribuição).
export let dataRef = new Date();
export function definirDataRef(d) {
  dataRef = d;
}

// Filtro de coluna/profissional da view Dia — null = "Todos". Client-side:
// renderDia já busca o dia inteiro, o chip só filtra o que desenha.
let filtroProfissionalDia = null;

// Tom de cor por status do agendamento (borda esquerda + fundo sutil +
// pílula). Enum real: a_confirmar/confirmado/concluido/falta/cancelado/
// reagendado (migrations 001/042/060/086) — o mock do canvas tinha
// "aguardando"/"em atendimento" que não existem no nosso modelo.
// a_confirmar (migration 086) — estágio inicial, amarelo, até o cliente
// confirmar pelo botão do WhatsApp (ver lib/automacoes.js); ao confirmar
// vira 'confirmado', verde — pedido explícito (antes 'confirmado' não tinha
// cor/pílula própria, ficava neutro).
export const TOM_STATUS_AGENDA = {
  a_confirmar: { classe: 'agenda-tom-warn', pill: 'A confirmar', pillClasse: 'badge-a-confirmar' },
  confirmado: { classe: 'agenda-tom-ok', pill: 'Confirmado', pillClasse: 'badge-confirmado' },
  concluido: { classe: 'agenda-tom-ok', pill: 'Concluído', pillClasse: 'badge-concluido' },
  falta: { classe: 'agenda-tom-warn', pill: 'Falta', pillClasse: 'badge-falta' },
  cancelado: { classe: 'agenda-tom-bad', pill: 'Cancelado', pillClasse: 'badge-cancelado' },
  reagendado: { classe: 'agenda-tom-neutro', pill: 'Reagendado', pillClasse: 'badge-status-inativo' },
};
export const AG_STATUS_SEM_ACOES = ['cancelado', 'concluido', 'falta'];

function menuAcoesAgendamentoHtml(id) {
  return `
    <div class="menu-acoes" id="menu-acoes-${id}">
      <button data-acao="concluir" data-id="${id}">Concluir</button>
      <button data-acao="reagendar" data-id="${id}">Reagendar</button>
      <button data-acao="encaixar" data-id="${id}">Encaixar</button>
      <button data-acao="falta" data-id="${id}">Marcar falta</button>
      <button data-acao="cancelar" data-id="${id}" class="acao-perigo">Cancelar</button>
    </div>
  `;
}

// Horários da grade Dia — pedido explícito: horário de intervalo não aparece
// em NENHUMA view da agenda (antes essa função mantinha o slot do almoço e a
// grade desenhava uma linha "Intervalo"; agora só reaproveita
// gerarHorariosGrade, que já pula o almoço, igual Semana/Mês).
function gerarHorariosGradeDia() {
  return gerarHorariosGrade().map((hora) => ({ hora, intervalo: false }));
}
function minutosIntervaloAlmoco() {
  if (!configuracao.horario_almoco_ativo) return 0;
  return horarioParaMinutosFrontend(configuracao.horario_almoco_fim) - horarioParaMinutosFrontend(configuracao.horario_almoco_inicio);
}

// Card horizontal da view Dia (1 agendamento no horário) — hora · avatar do
// profissional · cliente · serviço … meta · pílula de status. Reaproveita
// data-acoes-toggle / .menu-acoes / data-id do resto da agenda (o handler
// delegado em #conteudo já cobre).
function renderDiaCardHorizontal(ag) {
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  return `
    <div class="agenda-card agenda-card-h ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-card-h-linha" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="agenda-card-hora">${formatarHora(ag.data_hora)}</span>
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(ag.profissional_id)};color:#fff">${iniciaisNome(ag.profissional || '')}</span>
        <span class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</span>
        <span class="agenda-card-servico">${ag.servico}</span>
        <span class="agenda-card-meta">${ag.duracao_minutos}min · ${formatarPreco(ag.preco)} · ${ag.profissional}</span>
        ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
        ${tom.pill ? `<span class="badge ${tom.pillClasse}">${tom.pill}</span>` : ''}
        ${semAcoes ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${semAcoes ? '' : menuAcoesAgendamentoHtml(ag.id)}
    </div>
  `;
}

// Card compacto lado a lado (2+ no mesmo horário). Sem kebab (não cabe) — o
// clique abre o mesmo .menu-acoes, posicionado por baixo via CSS.
function renderDiaCardCompacto(ag) {
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  return `
    <div class="agenda-card agenda-card-c ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-card-c-linha" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(ag.profissional_id)};color:#fff">${iniciaisNome(ag.profissional || '')}</span>
        <div class="agenda-card-c-txt">
          <div class="agenda-card-hora">${formatarHora(ag.data_hora)}</div>
          <div class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="agenda-card-servico">${ag.servico}</div>
        </div>
      </div>
      ${semAcoes ? '' : menuAcoesAgendamentoHtml(ag.id)}
    </div>
  `;
}

// PR (2026-09-27) — blocos espichados na view Dia: altura/posição em px a
// partir da duração real (`ag.duracao_minutos`), em vez de "o agendamento só
// ocupa a hora em que começa" (bug real em produção: uma Micro Pigmentação
// de 240min aparecia como se ocupasse só 1 hora, e as 3 horas seguintes
// ficavam mostrando "Livre"). ALTURA_LINHA_DIA_PX precisa bater com o CSS
// (.agenda-grade-blocos .agenda-linha { height: 60px }) — 60px pros 60min de
// SLOT_INTERVALO_MINUTOS, 1px por minuto, matemática simples de top/height.
export const ALTURA_LINHA_DIA_PX = 60;

// Minutos desde a ABERTURA, já descontando o intervalo de almoço pra quem
// vem depois dele — o mesmo espaço "comprimido" que gerarHorariosGradeDia já
// usa pra decidir quais linhas existem (o almoço nunca vira linha, então o
// overlay de blocos não pode deixar um buraco ali também). Nunca precisa
// lidar com um bloco atravessando o almoço: dentroDoHorarioFuncionamento (a
// mesma validação do backend, lib/horario-funcionamento.js) já rejeita
// qualquer agendamento cujo horário+duração invada o intervalo.
export function minutoAjustadoDia(dataHoraISO) {
  const minutoBruto = horarioParaMinutosFrontend(horaChave24h(dataHoraISO));
  const aberturaMin = horarioParaMinutosFrontend(configuracao.horario_abertura || '08:00');
  const almocoFimMin = configuracao.horario_almoco_ativo ? horarioParaMinutosFrontend(configuracao.horario_almoco_fim) : null;
  const descontoAlmoco = (almocoFimMin != null && minutoBruto >= almocoFimMin) ? minutosIntervaloAlmoco() : 0;
  return minutoBruto - aberturaMin - descontoAlmoco;
}

// Layout de colunas por sobreposição REAL de horário (não mais "mesma hora
// cheia") — algoritmo clássico de "salas de reunião": ordena por início,
// agrupa em clusters que se sobrepõem transitivamente entre si, e dentro de
// cada cluster distribui em colunas (greedy: reaproveita a primeira coluna já
// livre). totalColunas de cada item é o tamanho do cluster em que ele caiu,
// não o total do dia inteiro — dois agendamentos que nunca se cruzam no
// tempo continuam ocupando a largura inteira, cada um na sua vez.
export function calcularBlocosDia(agendamentos) {
  const itens = agendamentos
    .map((ag) => {
      const inicio = horarioParaMinutosFrontend(horaChave24h(ag.data_hora));
      const fim = inicio + Number(ag.duracao_minutos || 0);
      return { ag, inicio, fim };
    })
    .sort((a, b) => a.inicio - b.inicio);

  const resultado = [];
  let grupo = [];
  let fimGrupo = -Infinity;
  const fecharGrupo = () => {
    if (!grupo.length) return;
    const colunas = [];
    for (const item of grupo) {
      let coluna = colunas.findIndex((fimColuna) => fimColuna <= item.inicio);
      if (coluna === -1) coluna = colunas.length;
      colunas[coluna] = item.fim;
      resultado.push({ ...item, coluna });
    }
    const totalColunas = colunas.length;
    for (let i = resultado.length - grupo.length; i < resultado.length; i++) resultado[i].totalColunas = totalColunas;
  };
  for (const item of itens) {
    if (grupo.length && item.inicio >= fimGrupo) { fecharGrupo(); grupo = []; fimGrupo = -Infinity; }
    grupo.push(item);
    fimGrupo = Math.max(fimGrupo, item.fim);
  }
  fecharGrupo();
  return resultado;
}

function renderDiaGrade(diaISO, agendamentos) {
  const linhas = gerarHorariosGradeDia();
  if (linhas.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  // Cancelado continua contando pra ocupação visual do bucket (mesma
  // paridade de antes — só ganhava o tom "agendamento-cancelado" no card,
  // nunca sumia da grade).
  const blocos = calcularBlocosDia(agendamentos);

  const ehHoje = diaISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;

  const corpo = linhas.map(({ hora, intervalo }) => {
    const horaMin = horarioParaMinutosFrontend(hora);
    const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
    // "Ocupada" agora é sobreposição real (início < fim do bucket E início do
    // bucket < fim do agendamento) — um serviço de 240min começando às 11h
    // ocupa 11h/12h/13h/14h inteiras, não só a linha das 11h.
    const ocupada = !intervalo && blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
    const conteudoLinha = intervalo
      ? '<span class="agenda-livre agenda-intervalo">Intervalo</span>'
      : (ocupada ? '' : '<span class="agenda-livre">Livre</span>');
    return `
      <div class="agenda-linha${hora === horaAtualBucket ? ' agenda-linha-agora' : ''}${intervalo ? ' agenda-linha-intervalo' : ''}">
        <div class="agenda-rail">
          <span class="agenda-rail-hora">${hora}</span>
        </div>
        <div class="agenda-conteudo">${conteudoLinha}</div>
        ${intervalo || ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora}">+</button>`}
      </div>
    `;
  }).join('');

  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;
  const alturaTotal = linhas.length * ALTURA_LINHA_DIA_PX;
  const camadaBlocos = blocos.map(({ ag, coluna, totalColunas }) => {
    const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
    const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
    const largura = 100 / totalColunas;
    const esquerda = largura * coluna;
    const card = totalColunas > 1 ? renderDiaCardCompacto(ag) : renderDiaCardHorizontal(ag);
    return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${card}</div>`;
  }).join('');

  return `
    <div class="agenda-grade agenda-grade-blocos" style="height:${alturaTotal}px">
      ${corpo}
      <div class="agenda-bloco-camada">${camadaBlocos}</div>
    </div>
  `;
}

export async function renderDia() {
  // Anterior/Próximo (e a primeira carga da aba) nunca param num dia fora
  // do horário de funcionamento configurado — pula direto pro próximo dia
  // aberto. Sem direção explícita (primeira carga), pula pra frente.
  dataRef = proximoDiaAberto(dataRef, 1);

  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [data, profs] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/profissionais'),
  ]);
  if (!data || !profs) return;

  definirAgendamentosAtuais(data.agendamentos);

  // Filtro de profissional é client-side (o dia inteiro já veio) — some se o
  // profissional filtrado não tem agendamento hoje? não: o chip continua,
  // mostra a coluna vazia. Só limpa se o profissional sumiu do cadastro.
  if (filtroProfissionalDia && !profs.profissionais.some((p) => p.id === filtroProfissionalDia)) {
    filtroProfissionalDia = null;
  }
  const agsVisiveis = filtroProfissionalDia
    ? data.agendamentos.filter((ag) => ag.profissional_id === filtroProfissionalDia)
    : data.agendamentos;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const validos = agsVisiveis.filter((ag) => ag.status !== 'cancelado');
  const totalDia = validos.reduce((soma, ag) => soma + Number(ag.preco || 0), 0);

  const chipsHtml = profs.profissionais.length > 1
    ? `
      <div class="agenda-filtros">
        ${profs.profissionais.map((p) => `
          <button class="agenda-chip${filtroProfissionalDia === p.id ? ' agenda-chip-ativo' : ''}" data-filtro-prof="${p.id}">
            <span class="agenda-chip-avatar" style="background:${corProfissional(p.id)};color:#fff">${iniciaisNome(p.nome)}</span>
            ${(p.nome || '').split(' ')[0]}
          </button>
        `).join('')}
        <button class="agenda-chip${!filtroProfissionalDia ? ' agenda-chip-ativo' : ''}" data-filtro-prof="">Todos</button>
      </div>
    `
    : '';

  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-1" aria-label="Dia anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="1" aria-label="Próximo dia">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${dataLabel}</strong>
        <span>${nomeDiaSemana(dataRef)} · ${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} · ${formatarPreco(totalDia)}</span>
      </div>
    </div>
    ${chipsHtml}
  `;

  html += renderDiaGrade(iso, agsVisiveis);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') {
        dataRef = new Date();
      } else {
        dataRef.setDate(dataRef.getDate() + Number(nav));
      }
      dataRef = proximoDiaAberto(dataRef, nav === '-1' ? -1 : 1);
      renderDia();
    });
  });
  conteudo.querySelectorAll('[data-filtro-prof]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filtroProfissionalDia = chip.dataset.filtroProf || null;
      renderDia();
    });
  });
}

// Fase 6d (2026-10-16): acrescenta a visão Semana.

// Card compacto de agendamento — visões Semana e Mês (componente
// .agenda-card-s/.agenda-ag do DS, README "Card compacto para semana e
// mês"). Diferente do card da Dia (menu local .menu-acoes/data-acoes-toggle):
// aqui o menu "..." é o .ds-acoes do DS, já ligado globalmente pelo
// components.js e tratado no listener `ds-acoes-escolher` acima. Sem slot
// próprio de hora no grid do DS — na Semana a linha já é a hora; no Mês
// (`comHora`) prefixamos no texto do serviço, já que a célula é o dia
// inteiro, não uma hora só.
export function renderAgendaCardCompacto(ag, opts) {
  const comHora = !!(opts && opts.comHora);
  const tom = TOM_STATUS_AGENDA[ag.status] || TOM_STATUS_AGENDA.confirmado;
  const semAcoes = AG_STATUS_SEM_ACOES.includes(ag.status);
  const multiProfissional = !!(contaStatus && contaStatus.mostrar_profissional);
  const iniciais = iniciaisNome(multiProfissional ? (ag.profissional || '') : (ag.cliente || ag.cliente_telefone || ''));
  const cor = multiProfissional ? corProfissional(ag.profissional_id) : 'var(--accent)';
  const servicoTexto = comHora ? `${formatarHora(ag.data_hora)} · ${ag.servico}` : ag.servico;
  return `
    <div class="agenda-card agenda-card-s ${tom.classe}${ag.status === 'cancelado' ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agenda-ag">
        <span class="agenda-avatar" aria-hidden="true" style="--agenda-avatar-bg:${cor};--agenda-avatar-fg:#fff">${iniciais}</span>
        <span class="agenda-card-cliente">${ag.cliente || ag.cliente_telefone}</span>
        ${semAcoes ? '' : `
          <span class="ds-acoes" data-agendamento-id="${ag.id}">
            <button type="button" class="ds-acoes-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Ações">⋯</button>
            <div class="ds-acoes-menu" role="menu" hidden>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="concluir">Concluir</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="reagendar">Reagendar</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="encaixar">Encaixar</button>
              <button type="button" role="menuitem" class="ds-acoes-item" data-acao="falta">Marcar falta</button>
              <button type="button" role="menuitem" class="ds-acoes-item ds-acoes-item-perigo" data-acao="cancelar">Cancelar</button>
            </div>
          </span>
        `}
        <span class="agenda-card-servico">${servicoTexto}</span>
      </div>
    </div>
  `;
}

export async function renderSemana() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=semana&data=${iso}`);
  if (!data) return;

  definirAgendamentosAtuais(data.agendamentos);

  // Bug real em produção (2026-09-27): `ag.data_hora` vem em UTC — um recorte
  // ingênuo dos 10 primeiros caracteres pega o dia UTC, não o de Brasília.
  // Perto da virada (ex.: 23h+ de Brasília = já é o dia seguinte em UTC, ou
  // de madrugada em UTC = ainda o dia anterior em Brasília) o agendamento
  // caía na coluna errada da semana. formatarDataISO já resolve isso em
  // todo o resto do arquivo — só faltava aqui.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = formatarDataISO(new Date(ag.data_hora));
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  // Uma coluna por dia da semana (segunda→domingo) que o negócio funciona —
  // dias fechados nem aparecem (diferente do Mês, que mostra desabilitado).
  const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const segunda = inicioDaSemana(dataRef);
  const diasAbertos = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(segunda);
    d.setDate(d.getDate() + i);
    if (diasFuncionamento.includes(d.getDay())) diasAbertos.push(d);
  }
  const domingo = new Date(segunda);
  domingo.setDate(domingo.getDate() + 6);
  const labelIntervalo = `${segunda.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })} – ${domingo.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' })}`;
  const validos = data.agendamentos.filter((ag) => ag.status !== 'cancelado');

  // Topo comum das 3 visões (componente .agenda-topo do DS, igual à Dia) —
  // o seletor Dia/Semana/Mês em si fica na barra fixa acima (#subtabs,
  // .agenda-visoes), não duplicado aqui.
  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-7" aria-label="Semana anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="7" aria-label="Próxima semana">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${labelIntervalo}</strong>
        <span>${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} na semana</span>
      </div>
    </div>
  `;

  html += diasAbertos.length === 0
    ? '<div class="vazio">Nenhum dia de funcionamento configurado nessa semana.</div>'
    : renderSemanaGrade(diasAbertos, porDia);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') definirDataRef(new Date());
      else dataRef.setDate(dataRef.getDate() + Number(nav));
      renderSemana();
    });
  });
}

// Grid único: UMA régua de hora compartilhada (não uma por coluna — era o
// que desalinhava a hora com o texto da coluna seguinte na versão antiga de
// N grades independentes lado a lado) + uma coluna por dia aberto — direto
// no componente `.agenda-semana` do DS (README "Agenda — Dia, Semana e
// Mês"): sem accordion próprio do Studio, a coluna de hoje já alarga
// sozinha via CSS (v2.10.0, lê `.agenda-semana-cab-hoje`). `--agenda-dias`
// informa quantas colunas o CSS deve desenhar.
//
// PR (bug real em produção, achado 2026-09-30): mesmo bug da view Dia antes
// do PR #75 — cada agendamento só ocupava a célula do horário em que
// COMEÇA. Agora todas as células (cabeçalho, régua, fundo dia×hora) usam
// posição EXPLÍCITA (grid-column/grid-row inline) em vez de depender da
// ordem de inserção no DOM — isso libera uma camada de blocos por dia
// (.grade-bloco-camada, mesma técnica calcularBlocosDia/minutoAjustadoDia da
// view Dia) que pode ocupar várias linhas (grid-row em span) sem brigar com
// o posicionamento automático das outras células. Precisa da altura de
// linha FIXA (.agenda-semana-celula a 60px, ver style.css/
// .agenda-semana-blocos) pra bater com a régua — por isso a linha da hora
// atual não ganha mais `.agenda-linha-alta` (só a cor de destaque
// `.agenda-rail-agora` continua).
function renderSemanaGrade(diasAbertos, porDia) {
  const hojeISO = formatarDataISO(new Date());
  const isoAbertos = diasAbertos.map(formatarDataISO);
  const horaAtualBucket = isoAbertos.includes(hojeISO) ? horaChaveGradeBucket(new Date().toISOString()) : null;

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;

  let html = `<div class="agenda-semana agenda-semana-blocos" style="--agenda-dias:${diasAbertos.length}">`;
  html += '<div class="agenda-semana-canto" style="grid-column:1;grid-row:1"></div>';
  diasAbertos.forEach((d, i) => {
    const diaISO = isoAbertos[i];
    const hoje = diaISO === hojeISO;
    const dataLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    html += `
      <div class="agenda-semana-cab${hoje ? ' agenda-semana-cab-hoje' : ''}" style="grid-column:${i + 2};grid-row:1">
        <span class="agenda-dia-num${hoje ? ' agenda-dia-num-hoje' : ''}">${d.getDate()}</span>
        <span>${nomeDiaSemana(d).slice(0, 3)} ${dataLabel}</span>
      </div>
    `;
  });

  horarios.forEach((hora, linha) => {
    const horaAtual = hora === horaAtualBucket;
    html += `<div class="agenda-rail${horaAtual ? ' agenda-rail-agora' : ''}" style="grid-column:1;grid-row:${linha + 2}"><span class="agenda-rail-hora">${hora}</span></div>`;
  });

  diasAbertos.forEach((d, i) => {
    const diaISO = isoAbertos[i];
    const hoje = diaISO === hojeISO;
    const blocos = calcularBlocosDia(porDia[diaISO] || []);
    horarios.forEach((hora, linha) => {
      const horaMin = horarioParaMinutosFrontend(hora);
      const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
      const ocupada = blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
      html += `
        <div class="agenda-semana-celula${hoje ? ' agenda-semana-celula-hoje' : ''}" style="grid-column:${i + 2};grid-row:${linha + 2}">
          ${ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora} em ${diaISO}">+</button>`}
        </div>
      `;
    });
    const camada = blocos.map(({ ag, coluna, totalColunas }) => {
      const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
      const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${renderAgendaCardCompacto(ag)}</div>`;
    }).join('');
    html += `<div class="grade-bloco-camada" style="grid-column:${i + 2};grid-row:2 / span ${horarios.length}">${camada}</div>`;
  });

  html += '</div>';
  return html;
}

// Fase 6e (2026-10-16): acrescenta a visão Quadro. `quadroLinhaAgoraIntervalo`
// também muda de dono — era estado de app.js (ao lado de dataRef/abaCadastro
// antes da fase 6c), mas só é reatribuído dentro de renderQuadro (que migra
// agora); app.js só precisa LER o valor atual pra limpar o intervalo ao sair
// da tela (selecionarMenu) — por isso não precisa de setter, só do binding
// vivo exportado.
export let quadroLinhaAgoraIntervalo = null;

// Card de um agendamento dentro de uma linha da grade de horários (Dia e,
// no PR3, Semana) — mesmo conteúdo/ações de renderAgendamentoItem (kebab
// com Reagendar/Encaixar/Cancelar), só que compacto o bastante pra caber
// dividido em sub-colunas quando há mais de um profissional no mesmo
// horário (CA da grade: "dividir a coluna ou dois componentes").
function renderAgendamentoGradeCard(ag, opts) {
  const cancelado = ag.status === 'cancelado';
  const concluido = ag.status === 'concluido';
  const falta = ag.status === 'falta';
  const semAcoes = cancelado || concluido || falta;
  // Com mais de um profissional cadastrado, "quem atende" é a primeira
  // informação do card — avatar + nome do profissional (cor fixa por
  // profissional_id, corProfissional), antes do serviço/cliente. Com um só
  // profissional isso é óbvio, então o avatar volta a identificar o
  // cliente (mais útil pra reconhecer clientes recorrentes de relance).
  // ocultarProfissional (Quadro): a coluna já É o profissional, repetir o
  // nome em todo card seria redundante — mas cor/avatar continuam.
  const multiProfissional = !(opts && opts.ocultarProfissional) && !!(contaStatus && contaStatus.mostrar_profissional);
  const avatarIniciais = multiProfissional ? iniciaisNome(ag.profissional || '') : iniciaisNome(ag.cliente || '');
  const avatarEstilo = multiProfissional ? ` style="background:${corProfissional(ag.profissional_id)};color:#fff"` : '';
  return `
    <div class="grade-ag-card${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="grade-ag-linha-principal" ${semAcoes ? '' : `data-acoes-toggle="${ag.id}"`}>
        <span class="grade-ag-avatar" aria-hidden="true"${avatarEstilo}>${avatarIniciais}</span>
        <div class="grade-ag-textos">
          ${multiProfissional ? `<div class="grade-ag-profissional">${ag.profissional}</div>` : ''}
          <div class="grade-ag-servico">${ag.servico}</div>
          <div class="grade-ag-cliente">${ag.cliente || ag.cliente_telefone}</div>
          <div class="grade-ag-meta">
            ${formatarHora(ag.data_hora)} · ${ag.duracao_minutos}min · ${formatarPreco(ag.preco)}
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

// Grade de horários (abertura→fechamento, menos almoço) de um único dia —
// reaproveitada pela view Dia aqui e pela view Semana (PR3), uma coluna por
// dia. `agendamentos` já deve vir filtrado pro dia em questão.
function renderGradeHorariosDoDia(dataISO, agendamentos) {
  const porHorario = {};
  for (const ag of agendamentos) {
    const chave = horaChaveGradeBucket(ag.data_hora);
    if (!porHorario[chave]) porHorario[chave] = [];
    porHorario[chave].push(ag);
  }

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  // Destaque de "agora" (PR2) — só quando o dia da grade é hoje, marca a
  // linha cujo bucket de hora contém o horário atual em Brasília.
  const ehHoje = dataISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;

  return `
    <div class="grade-horarios">
      ${horarios
        .map((hora) => {
          const agsDoHorario = porHorario[hora] || [];
          const conteudoLinha = agsDoHorario.length
            ? `<div class="grade-ag-grupo" style="grid-template-columns:repeat(${agsDoHorario.length},1fr)">${agsDoHorario.map(renderAgendamentoGradeCard).join('')}</div>`
            : '<div class="grade-linha-vazia">Disponível</div>';
          const horaAtual = hora === horaAtualBucket;
          return `
            <div class="grade-linha${horaAtual ? ' grade-linha-hora-atual' : ''}">
              <div class="grade-linha-hora">${hora}</div>
              <div class="grade-linha-conteudo">${conteudoLinha}</div>
              <button class="grade-linha-add" data-add-horario="${hora}" data-data="${dataISO}" aria-label="Novo agendamento às ${hora}">+</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

// ---------- Quadro (kanban: colunas = profissionais, raias = horários) ----------
// Só visualização por ora (clique no card abre o mesmo menu de ações do
// resto da agenda — concluir/reagendar/encaixar/falta/cancelar); arrastar
// pra reagendar fica pra uma leva futura. Um dia por vez, mesma navegação
// ←/→ e mesmos horários de Preferências que a view Dia (gerarHorariosGrade
// já lê configuracao.horario_abertura/fechamento/almoço).
export async function renderQuadro() {
  definirDataRef(proximoDiaAberto(dataRef, 1));
  clearInterval(quadroLinhaAgoraIntervalo);

  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [data, profs] = await Promise.all([
    api(`/api/agendamentos?view=dia&data=${iso}`),
    api('/api/profissionais'),
  ]);
  if (!data || !profs) return;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Anterior</button>
      <div class="nav-periodo-data">
        <strong>${dataLabel}</strong>
        <div class="nav-periodo-dia-semana">${nomeDiaSemana(dataRef)}</div>
      </div>
      <button data-nav="1">Próximo →</button>
    </div>
  `;

  // agendamentosAtuais fica com a lista INTEIRA — é o que os menus de ação
  // dos cards (concluir/reagendar/etc.) usam pra achar o agendamento pelo
  // id. Sem filtro de profissional/serviço (removido — pedido explícito):
  // o Quadro sempre mostra todos os profissionais e todos os agendamentos.
  definirAgendamentosAtuais(data.agendamentos);
  html += renderQuadroGrade(iso, profs.profissionais, data.agendamentos);

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 1);
    definirDataRef(proximoDiaAberto(dataRef, -1));
    renderQuadro();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 1);
    definirDataRef(proximoDiaAberto(dataRef, 1));
    renderQuadro();
  });

  // Linha vermelha de "agora" — só faz sentido no dia de hoje. Recalcula na
  // hora (posição inicial) e a cada 30s depois (vai "correndo" ao longo do
  // dia sem precisar de nenhuma ação do usuário).
  if (iso === formatarDataISO(new Date())) {
    atualizarLinhaAgoraQuadro();
    quadroLinhaAgoraIntervalo = setInterval(atualizarLinhaAgoraQuadro, 30000);
  }
}

// A régua de hora não tem altura fixa (cada linha cresce conforme quantos
// agendamentos cabem nela), então a posição da linha não dá pra calcular só
// com CSS/porcentagem — mede a altura REAL da célula da hora atual
// (.quadro-hora-atual, já calculada por renderQuadroGrade) e posiciona a
// linha proporcional aos minutos decorridos dela. Fora do horário comercial
// (ou durante o almoço) a hora atual não tem linha na grade — sem
// .quadro-hora-atual, a função só encerra o intervalo e não desenha nada.
function atualizarLinhaAgoraQuadro() {
  const grade = conteudo.querySelector('.quadro-grade');
  const horaCel = grade && grade.querySelector('.quadro-hora-atual');
  if (!grade || !horaCel) { clearInterval(quadroLinhaAgoraIntervalo); return; }
  let linha = grade.querySelector('.quadro-linha-agora');
  if (!linha) {
    linha = document.createElement('div');
    linha.className = 'quadro-linha-agora';
    grade.appendChild(linha);
  }
  const agora = new Date();
  const proporcaoHora = (agora.getMinutes() + agora.getSeconds() / 60) / 60;
  linha.style.top = `${horaCel.offsetTop + proporcaoHora * horaCel.offsetHeight}px`;
}

// Mesma técnica de grid da Semana (renderSemanaGrade) — régua de hora
// compartilhada (classes .semana-grade/.semana-grade-hora reaproveitadas,
// não é conceito exclusivo de "semana") — só que aqui as colunas são
// profissionais, fixas (não têm accordion: já é o recorte de um dia só,
// não precisa recolher nada pra caber).
//
// PR (bug real em produção, achado 2026-09-30): a correção de duração da
// view Dia (PR #75, 2026-09-27) nunca foi replicada aqui — cada agendamento
// só ocupava a célula do horário em que COMEÇA, então um atendimento de
// 240min continuava "contabilizando" só 1h: as horas seguintes apareciam
// como "Disponível" (permitindo agendar por cima) e o card não mostrava a
// duração real. Agora cada coluna de profissional usa a MESMA
// calcularBlocosDia/minutoAjustadoDia da view Dia — células de fundo (que
// só indicam "Disponível"/"+") viram uma camada, e os cards de agendamento
// (posicionados por cima, altura/posição em px pela duração real) viram
// outra, uma por profissional (.grade-bloco-camada, grid-row em span
// cobrindo todas as linhas de hora). Precisa da altura de linha FIXA
// (.semana-grade-hora/.semana-grade-cel a 60px, ver style.css) pra bater
// com a régua.
function renderQuadroGrade(diaISO, profissionais, agendamentos) {
  if (!profissionais.length) {
    return '<div class="vazio">Nenhum profissional encontrado — cadastre (ou ajuste o filtro) em Configurações → Cadastro → Profissionais.</div>';
  }

  const horarios = gerarHorariosGrade();
  if (horarios.length === 0) {
    return '<div class="vazio">Nenhum horário configurado (confira Abertura/Fechamento em Configuração).</div>';
  }

  const porProfissional = {};
  for (const ag of agendamentos) {
    if (!porProfissional[ag.profissional_id]) porProfissional[ag.profissional_id] = [];
    porProfissional[ag.profissional_id].push(ag);
  }

  const colunas = profissionais.map(() => 'minmax(160px,1fr)').join(' ');
  const ehHoje = diaISO === formatarDataISO(new Date());
  const horaAtualBucket = ehHoje ? horaChaveGradeBucket(new Date().toISOString()) : null;
  const pxPorMinuto = ALTURA_LINHA_DIA_PX / SLOT_INTERVALO_MINUTOS;

  let html = `<div class="semana-grade quadro-grade" style="grid-template-columns:62px ${colunas}">`;
  html += '<div class="semana-grade-canto" style="grid-column:1;grid-row:1"></div>';
  profissionais.forEach((p, i) => {
    html += `
      <div class="quadro-cab" style="grid-column:${i + 2};grid-row:1">
        <span class="grade-ag-avatar" aria-hidden="true" style="background:${corProfissional(p.id)};color:#fff">${iniciaisNome(p.nome)}</span>
        <strong>${p.nome}</strong>
      </div>
    `;
  });

  horarios.forEach((hora, linha) => {
    html += `<div class="semana-grade-hora${hora === horaAtualBucket ? ' quadro-hora-atual' : ''}" style="grid-column:1;grid-row:${linha + 2}">${hora}</div>`;
  });

  profissionais.forEach((p, i) => {
    const blocos = calcularBlocosDia(porProfissional[p.id] || []);
    horarios.forEach((hora, linha) => {
      const horaMin = horarioParaMinutosFrontend(hora);
      const horaFimMin = horaMin + SLOT_INTERVALO_MINUTOS;
      const ocupada = blocos.some((b) => b.inicio < horaFimMin && horaMin < b.fim);
      html += `
        <div class="semana-grade-cel" style="grid-column:${i + 2};grid-row:${linha + 2}">
          ${ocupada ? '' : '<span class="grade-linha-vazia">Disponível</span>'}
          ${ocupada ? '' : `<button class="grade-linha-add" data-add-horario="${hora}" data-data="${diaISO}" aria-label="Novo agendamento às ${hora}">+</button>`}
        </div>
      `;
    });
    const camada = blocos.map(({ ag, coluna, totalColunas }) => {
      const top = minutoAjustadoDia(ag.data_hora) * pxPorMinuto;
      const altura = Math.max(Number(ag.duracao_minutos || 0) * pxPorMinuto - 4, 24);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      return `<div class="agenda-bloco" style="top:${top}px;height:${altura}px;left:${esquerda}%;width:calc(${largura}% - 4px)">${renderAgendamentoGradeCard(ag, { ocultarProfissional: true })}</div>`;
    }).join('');
    html += `<div class="grade-bloco-camada" style="grid-column:${i + 2};grid-row:2 / span ${horarios.length}">${camada}</div>`;
  });

  html += '</div>';
  return html;
}

// Fase 6f (2026-10-16): acrescenta a visão Mês — última sub-fase da fase 6
// (Agenda). Depois dela só resta em app.js o núcleo de roteador/boot/wiring.
export async function renderMes() {
  const mesISO = formatarDataISO(dataRef).slice(0, 7);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=mes&data=${mesISO}`);
  if (!data) return;

  definirAgendamentosAtuais(data.agendamentos);

  // Mesmo bug de fuso da Semana (ver comentário lá) — recorte ingênuo da
  // string UTC em vez de converter pra Brasília.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = formatarDataISO(new Date(ag.data_hora));
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  const ano = dataRef.getFullYear();
  const mes = dataRef.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const mesLabel = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  const validos = data.agendamentos.filter((ag) => ag.status !== 'cancelado');

  let html = `
    <div class="agenda-topo">
      <div class="agenda-topo-nav">
        <button class="agenda-nav-btn" data-nav="-1" aria-label="Mês anterior">‹</button>
        <button class="agenda-nav-hoje" data-nav="hoje">Hoje</button>
        <button class="agenda-nav-btn" data-nav="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="agenda-topo-data">
        <strong>${mesLabel}</strong>
        <span>${validos.length} ${validos.length === 1 ? 'atendimento' : 'atendimentos'} no mês</span>
      </div>
    </div>
  `;

  // Dia da semana sem funcionamento (Configuração > Dias de funcionamento)
  // nem vira coluna (README do DS: "Mês — também só com dias de trabalho") —
  // diferente da versão anterior, que mostrava uma coluna estreita e
  // desabilitada. diaSemana index bate com NOMES_DIAS/getDay() (0 = domingo).
  const diasFuncionamentoMes = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  html += diasFuncionamentoMes.length === 0
    ? '<div class="vazio">Nenhum dia de funcionamento configurado (confira Preferências).</div>'
    : renderMesGrade(ano, mes, primeiroDia, ultimoDia, diasFuncionamentoMes, porDia);

  conteudo.innerHTML = html;
  conteudo.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'hoje') definirDataRef(new Date());
      else dataRef.setMonth(dataRef.getMonth() + Number(nav));
      renderMes();
    });
  });
}

// Grade do componente `.agenda-mes` do DS — só colunas de dia de semana
// aberto; `.agenda-mes-fora` completa a 1ª/última linha com dias do mês
// anterior/seguinte (cosmético, só numeração sequencial). Até 3 cards por
// célula (`.agenda-mais` pro resto, leva pra visão Dia daquele dia).
function renderMesGrade(ano, mes, primeiroDia, ultimoDia, diasFuncionamentoMes, porDia) {
  const colunas = [0, 1, 2, 3, 4, 5, 6].filter((ds) => diasFuncionamentoMes.includes(ds));
  let offset = 0;
  for (let ds = 0; ds < primeiroDia.getDay(); ds++) {
    if (colunas.includes(ds)) offset++;
  }

  const hojeISO = formatarDataISO(new Date());
  const MAX_VISIVEIS = 3;
  const celulasDias = [];
  for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
    const diaSemana = new Date(ano, mes, dia).getDay();
    if (!diasFuncionamentoMes.includes(diaSemana)) continue;
    const diaISO = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const agsDoDia = porDia[diaISO] || [];
    const hoje = diaISO === hojeISO;
    const visiveis = agsDoDia.slice(0, MAX_VISIVEIS);
    const extra = agsDoDia.length - visiveis.length;
    celulasDias.push(`
      <div class="agenda-mes-celula${hoje ? ' agenda-mes-celula-hoje' : ''}">
        <span class="agenda-dia-num${hoje ? ' agenda-dia-num-hoje' : ''}">${dia}</span>
        ${visiveis.map((ag) => renderAgendaCardCompacto(ag, { comHora: true })).join('')}
        ${extra > 0 ? `<span class="agenda-mais" data-ver-dia="${diaISO}">+${extra} mais</span>` : ''}
        <button class="agenda-mes-celula-add" data-add-dia="${diaISO}" aria-label="Novo agendamento em ${dia}">+</button>
      </div>
    `);
  }

  const mesAnteriorUltimoDia = new Date(ano, mes, 0).getDate();
  const celulasAntes = Array.from({ length: offset }, (_, i) =>
    `<div class="agenda-mes-celula agenda-mes-fora"><span class="agenda-dia-num">${mesAnteriorUltimoDia - offset + 1 + i}</span></div>`
  );

  const restante = (offset + celulasDias.length) % colunas.length;
  const totalDepois = restante === 0 ? 0 : colunas.length - restante;
  const celulasDepois = Array.from({ length: totalDepois }, (_, i) =>
    `<div class="agenda-mes-celula agenda-mes-fora"><span class="agenda-dia-num">${i + 1}</span></div>`
  );

  return `
    <div class="agenda-mes" style="--agenda-dias:${colunas.length}">
      ${colunas.map((ds) => `<div class="agenda-mes-cab">${NOMES_DIAS[ds].slice(0, 3)}</div>`).join('')}
      ${celulasAntes.join('')}
      ${celulasDias.join('')}
      ${celulasDepois.join('')}
    </div>
  `;
}
