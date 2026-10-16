// Cadastro — Serviços e Profissionais (abas de Config > Cadastro, junto com
// Bloqueios e Equipe) — extraído de app.js (fase 4 da modularização,
// 2026-10-16). `renderCadastro` (o despachante das abas) fica em app.js —
// lê/escreve `abaCadastro`, estado do roteador, no mesmo escopo de
// `selecionarMenu`. `servicosAtuais`/`profissionaisAtuais` e os
// `abrirModalX`/`alternarAtivoX` são exportados porque os dois listeners
// globais de clique de app.js (ds-acoes-escolher e o clique de linha) os
// chamam direto, igual `automacoesAtuais` na fase 3.
import { api } from '../core/api.js';
import { conteudo, mostrarToast, abrirModal, fecharModal, escapeHtml, validarObrigatorios, contaStatus } from '../core/shell.js';

// ---------- Serviços (US17/ST17.3) ----------
export let servicosAtuais = [];
// formatarPreco agora vive em pagamento-form.js (US52).

// Linha de tabela no padrão CRUD compartilhado (mesmo de Clientes): clicar
// na linha abre a edição (data-servico-abrir na <tr>), o "⋯" é o componente
// .ds-acoes do design system (tratado no listener global ds-acoes-escolher).
function renderServicoLinha(s, profissionaisPorId, mostrarProfissionais) {
  const desabilitado = s.ativo === false;
  const nomesProfissionais = (s.profissionais_exclusivos || [])
    .map((id) => profissionaisPorId.get(id))
    .filter(Boolean);
  return `
    <tr class="linha-clicavel" data-servico-abrir="${s.id}">
      <td>
        <div>${s.nome}</div>
        ${s.descricao ? `<div class="cliente-linha-telefone">${escapeHtml(s.descricao)}</div>` : ''}
      </td>
      <td>${s.duracao_minutos} min</td>
      <td>${formatarPreco(s.preco)}</td>
      ${mostrarProfissionais ? `<td>${nomesProfissionais.length ? escapeHtml(nomesProfissionais.join(', ')) : '—'}</td>` : ''}
      <td>${desabilitado ? '<span class="badge badge-status-inativo">Desabilitado</span>' : '<span class="badge badge-status-ativo">Ativo</span>'}</td>
      <td>
        <span class="ds-acoes" data-servico-id="${s.id}">
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

export async function alternarAtivoServico(servico) {
  const resultado = await api(`/api/servicos/${servico.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !servico.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(resultado.ativo ? 'Serviço habilitado.' : 'Serviço desabilitado.', 'sucesso');
    renderServicos();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar serviço.', 'erro');
  }
}

export async function renderServicos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [dataServicos, dataProfissionais] = await Promise.all([api('/api/servicos'), api('/api/profissionais')]);
  if (!dataServicos) return;
  servicosAtuais = dataServicos.servicos;
  const profissionaisPorId = new Map((dataProfissionais?.profissionais || []).map((p) => [p.id, p.nome]));
  const mostrarProfissionais = !!(contaStatus && contaStatus.mostrar_profissional);

  let html = `
    <div class="inicio-cabecalho">
      <h2>Serviços</h2>
      <button class="btn-novo-agendamento" id="btn-novo-servico">+ Novo serviço</button>
    </div>
  `;

  if (!servicosAtuais.length) {
    html += '<div class="vazio">Nenhum serviço cadastrado ainda.</div>';
  } else {
    html += `
      <div class="tabela-wrapper">
        <table class="tabela-tenants tabela-crud-compacta">
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Duração</th>
              <th>Valor</th>
              ${mostrarProfissionais ? '<th>Profissionais</th>' : ''}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${servicosAtuais.map((s) => renderServicoLinha(s, profissionaisPorId, mostrarProfissionais)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-servico').addEventListener('click', () => abrirModalServico(null));
}

export async function abrirModalServico(servico) {
  const editando = !!servico;
  const mostrarProfissionais = !!(contaStatus && contaStatus.mostrar_profissional);
  let checkboxesProfissionais = '';
  if (mostrarProfissionais) {
    const resultadoProfissionais = await api('/api/profissionais');
    const listaProfissionais = (resultadoProfissionais && resultadoProfissionais.profissionais) || [];
    const exclusivosAtuais = editando ? servico.profissionais_exclusivos || [] : [];
    checkboxesProfissionais = listaProfissionais.length
      ? listaProfissionais
          .map(
            (p) => `
        <label class="dia-checkbox">
          <input type="checkbox" value="${p.id}" ${exclusivosAtuais.includes(p.id) ? 'checked' : ''}>
          ${escapeHtml(p.nome)}
        </label>
      `
          )
          .join('')
      : '<div class="modal-texto">Nenhum profissional cadastrado ainda.</div>';
  }

  abrirModal(
    `<h3>${editando ? 'Editar serviço' : 'Novo serviço'}</h3>`,
    `
      <form id="form-servico">
        <div class="modal-erro" id="servico-erro"></div>
        <label for="servico-nome">Nome *</label>
        <input type="text" id="servico-nome" data-obrigatorio value="${editando ? servico.nome : ''}">
        <label for="servico-duracao">Duração (minutos) *</label>
        <input type="number" id="servico-duracao" data-obrigatorio min="1" value="${editando ? servico.duracao_minutos : ''}">
        <label for="servico-preco">Preço em R$ *</label>
        <input type="number" id="servico-preco" data-obrigatorio min="0" step="0.01" value="${editando && servico.preco != null ? servico.preco : ''}">
        <label for="servico-descricao">Descrição curta (opcional)</label>
        <textarea id="servico-descricao" rows="2" maxlength="280" placeholder="Ex: inclui lavagem e finalização">${editando && servico.descricao ? servico.descricao : ''}</textarea>
        ${mostrarProfissionais ? `
        <label>Profissional exclusivo (opcional)</label>
        <div class="profissional-servicos-lista" id="servico-profissionais">${checkboxesProfissionais}</div>
        ` : ''}
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-servico">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-servico">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-servico').addEventListener('click', fecharModal);

  const form = document.getElementById('form-servico');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('servico-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const precoValor = document.getElementById('servico-preco').value;
    const payload = {
      nome: document.getElementById('servico-nome').value.trim(),
      duracao_minutos: parseInt(document.getElementById('servico-duracao').value, 10),
      preco: precoValor ? parseFloat(precoValor) : null,
      descricao: document.getElementById('servico-descricao').value.trim() || null,
    };
    if (mostrarProfissionais) {
      payload.profissionais_exclusivos = Array.from(document.querySelectorAll('#servico-profissionais input:checked')).map((el) => el.value);
    }

    const resultado = await api(editando ? `/api/servicos/${servico.id}` : '/api/servicos', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Serviço atualizado com sucesso.' : 'Serviço criado com sucesso.', 'sucesso');
      renderServicos();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar serviço.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

export function abrirModalExcluirServico(servico) {
  abrirModal(
    '<h3>Excluir serviço</h3>',
    `
      <p class="modal-texto">Ao confirmar essa exclusão, este serviço não estará mais disponível para novos agendamentos. Deseja excluir mesmo assim?</p>
      <div class="modal-erro" id="excluir-servico-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-servico">Cancelar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-servico">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-servico').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-servico').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/servicos/${servico.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Serviço excluído com sucesso.', 'sucesso');
      renderServicos();
    } else {
      document.getElementById('excluir-servico-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir serviço.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

// ---------- Profissionais (US17/ST17.4) ----------
export let profissionaisAtuais = [];

// Linha de tabela no padrão CRUD compartilhado (mesmo de Serviços/Clientes):
// clicar na linha abre a edição, o "⋯" é o componente .ds-acoes do design
// system (tratado no listener global ds-acoes-escolher).
function renderProfissionalLinha(p) {
  const qtd = (p.servicos || []).length;
  const desabilitado = p.ativo === false;
  return `
    <tr class="linha-clicavel" data-profissional-abrir="${p.id}">
      <td>${escapeHtml(p.nome)}</td>
      <td>${qtd} serviço${qtd === 1 ? '' : 's'} atendido${qtd === 1 ? '' : 's'}</td>
      <td>${desabilitado ? '<span class="badge badge-status-inativo">Desabilitado</span>' : '<span class="badge badge-status-ativo">Ativo</span>'}</td>
      <td>
        <span class="ds-acoes" data-profissional-id="${p.id}">
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

export async function alternarAtivoProfissional(profissional) {
  const resultado = await api(`/api/profissionais/${profissional.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: !profissional.ativo }),
  });
  if (resultado && !resultado.error) {
    mostrarToast(resultado.ativo ? 'Profissional habilitado.' : 'Profissional desabilitado.', 'sucesso');
    renderProfissionais();
  } else {
    mostrarToast((resultado && resultado.error) || 'Erro ao atualizar profissional.', 'erro');
  }
}

export async function renderProfissionais() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api('/api/profissionais');
  if (!data) return;
  profissionaisAtuais = data.profissionais;

  let html = `
    <div class="inicio-cabecalho">
      <h2>Profissionais</h2>
      <button class="btn-novo-agendamento" id="btn-novo-profissional">+ Novo profissional</button>
    </div>
  `;

  if (!profissionaisAtuais.length) {
    html += '<div class="vazio">Nenhum profissional cadastrado ainda.</div>';
  } else {
    html += `
      <div class="tabela-wrapper">
        <table class="tabela-tenants tabela-crud-compacta">
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Serviços atendidos</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${profissionaisAtuais.map(renderProfissionalLinha).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-profissional').addEventListener('click', () => abrirModalProfissional(null));
}

export async function abrirModalProfissional(profissional) {
  const editando = !!profissional;
  const listaServicosResultado = await api('/api/servicos');
  const listaServicos = (listaServicosResultado && listaServicosResultado.servicos) || [];
  const servicosVinculados = editando ? profissional.servicos || [] : [];

  const checkboxesServicos = listaServicos.length
    ? listaServicos
        .map(
          (s) => `
        <label class="dia-checkbox">
          <input type="checkbox" value="${s.id}" ${servicosVinculados.includes(s.id) ? 'checked' : ''}>
          ${s.nome}
        </label>
      `
        )
        .join('')
    : '<div class="modal-texto">Nenhum serviço cadastrado ainda — cadastre um serviço primeiro.</div>';

  abrirModal(
    `<h3>${editando ? 'Editar profissional' : 'Novo profissional'}</h3>`,
    `
      <form id="form-profissional">
        <div class="modal-erro" id="profissional-erro"></div>
        <label for="profissional-nome">Nome *</label>
        <input type="text" id="profissional-nome" data-obrigatorio value="${editando ? profissional.nome : ''}">
        <label for="profissional-email">E-mail</label>
        <input type="email" id="profissional-email" value="${editando ? (profissional.email || '') : ''}">
        <label for="profissional-telefone">Telefone</label>
        <input type="text" id="profissional-telefone" value="${editando ? (profissional.telefone || '') : ''}" placeholder="(00) 00000-0000">
        <label for="profissional-pix">Chave Pix</label>
        <input type="text" id="profissional-pix" maxlength="77" value="${editando ? (profissional.pix || '') : ''}">
        <label>Serviços atendidos</label>
        <div class="profissional-servicos-lista" id="profissional-servicos">${checkboxesServicos}</div>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-profissional">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-profissional">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-profissional').addEventListener('click', fecharModal);

  const form = document.getElementById('form-profissional');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('profissional-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const servicosSelecionados = Array.from(document.querySelectorAll('#profissional-servicos input:checked')).map((el) => el.value);
    const payload = {
      nome: document.getElementById('profissional-nome').value.trim(),
      email: document.getElementById('profissional-email').value.trim(),
      telefone: document.getElementById('profissional-telefone').value.trim(),
      pix: document.getElementById('profissional-pix').value.trim(),
      servicos: servicosSelecionados,
    };

    const resultado = await api(editando ? `/api/profissionais/${profissional.id}` : '/api/profissionais', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Profissional atualizado com sucesso.' : 'Profissional criado com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar profissional.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

export function abrirModalExcluirProfissional(profissional) {
  abrirModal(
    '<h3>Excluir profissional</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir <strong>${profissional.nome}</strong>? Essa ação não pode ser desfeita.</p>
      <div class="modal-erro" id="excluir-profissional-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-profissional">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-profissional">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-profissional').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-profissional').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/profissionais/${profissional.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Profissional excluído com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      document.getElementById('excluir-profissional-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir profissional.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}
