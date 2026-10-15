// Equipe (US62) — extraído de app.js (fase 3 da modularização, 2026-10-15).
import { api } from '../core/api.js';
import { conteudo, mostrarToast, abrirModal, fecharModal, escapeHtml, validarObrigatorios } from '../core/shell.js';

const EQUIPE_ROLE_LABEL = { administrador: 'Administrador', operador: 'Operador', profissional: 'Profissional' };
const EQUIPE_CONVITE_STATUS_LABEL = { pendente: 'Pendente', expirado: 'Expirado', aceito: 'Aceito', cancelado: 'Cancelado' };
const EQUIPE_CONVITE_STATUS_BADGE = { pendente: 'badge-status-nao-ativado', expirado: 'badge-status-suspenso', aceito: 'badge-status-ativo', cancelado: 'badge-status-inativo' };

export async function renderEquipe() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const dados = await api('/api/equipe');
  if (!dados) return;

  let html = `
    <div class="nav-periodo">
      <strong>Equipe</strong>
      <button class="btn-novo-agendamento" id="btn-convidar-membro">+ Convidar membro</button>
    </div>
    <h4 class="pagamento-historico-titulo">Membros</h4>
    <div class="tabela-wrapper tabela-equipe-wrapper">
      <table class="tabela-tenants tabela-equipe">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${dados.membros.length ? dados.membros.map(renderEquipeMembroLinha).join('') : '<tr><td colspan="5">Nenhum membro cadastrado.</td></tr>'}
        </tbody>
      </table>
    </div>
    <h4 class="pagamento-historico-titulo">Convites</h4>
    <div class="tabela-wrapper tabela-equipe-wrapper">
      <table class="tabela-tenants tabela-equipe">
        <thead><tr><th>E-mail</th><th>Perfil</th><th>Status</th><th>Expira em</th><th></th></tr></thead>
        <tbody>
          ${dados.convites.length ? dados.convites.map(renderEquipeConviteLinha).join('') : '<tr><td colspan="5">Nenhum convite pendente.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  conteudo.innerHTML = html;
  document.getElementById('btn-convidar-membro').addEventListener('click', abrirModalConvidarMembro);

  conteudo.querySelectorAll('[data-acao-membro]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const membro = dados.membros.find((m) => m.id === btn.dataset.id);
      if (!membro) return;
      if (btn.dataset.acaoMembro === 'desativar' || btn.dataset.acaoMembro === 'reativar') {
        abrirModalAlterarAtivoMembro(membro);
      }
      if (btn.dataset.acaoMembro === 'remover') abrirModalRemoverMembro(membro);
    });
  });
  conteudo.querySelectorAll('[data-acao-convite]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.acaoConvite !== 'cancelar') return;
      btn.disabled = true;
      const resultado = await api(`/api/equipe/convites/${btn.dataset.id}`, { method: 'DELETE' });
      if (resultado && !resultado.error) {
        mostrarToast('Convite cancelado.', 'sucesso');
        renderEquipe();
      } else {
        mostrarToast((resultado && resultado.error) || 'Erro ao cancelar convite.', 'erro');
        btn.disabled = false;
      }
    });
  });
}

function renderEquipeMembroLinha(m) {
  return `
    <tr>
      <td>${m.nome || '—'}</td>
      <td>${m.email}</td>
      <td>${EQUIPE_ROLE_LABEL[m.role] || m.role}</td>
      <td><span class="badge badge-status ${m.ativo ? 'badge-status-ativo' : 'badge-status-inativo'}">${m.ativo ? 'Ativo' : 'Desativado'}</span></td>
      <td>
        <button class="btn-secundario btn-tabela" data-acao-membro="${m.ativo ? 'desativar' : 'reativar'}" data-id="${m.id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="btn-secundario btn-tabela acao-perigo" data-acao-membro="remover" data-id="${m.id}">Remover</button>
      </td>
    </tr>
  `;
}

function renderEquipeConviteLinha(c) {
  return `
    <tr>
      <td>${c.email}</td>
      <td>${EQUIPE_ROLE_LABEL[c.role] || c.role}</td>
      <td><span class="badge badge-status ${EQUIPE_CONVITE_STATUS_BADGE[c.status] || 'badge-status-inativo'}">${EQUIPE_CONVITE_STATUS_LABEL[c.status] || c.status}</span></td>
      <td>${formatarDataCurtaISO(c.expires_at.slice(0, 10))}</td>
      <td>${c.status === 'pendente' ? `<button class="btn-secundario btn-tabela acao-perigo" data-acao-convite="cancelar" data-id="${c.id}">Cancelar</button>` : ''}</td>
    </tr>
  `;
}

function abrirModalConvidarMembro() {
  abrirModal(
    '<h3>Convidar membro</h3>',
    `
      <form id="form-convidar-membro">
        <div class="modal-erro" id="convidar-membro-erro"></div>
        <label for="convite-email">E-mail *</label>
        <input type="email" id="convite-email" data-obrigatorio>
        <label for="convite-role">Perfil de acesso *</label>
        <select id="convite-role" data-obrigatorio>
          <option value="operador">Operador — acesso operacional (agenda, clientes, cadastros)</option>
          <option value="administrador">Administrador — acesso completo</option>
          <option value="profissional">Profissional — só a própria agenda e financeiro, sem senha</option>
        </select>
        <div id="bloco-convite-profissional" hidden>
          <label for="convite-profissional-id">Profissional vinculado *</label>
          <select id="convite-profissional-id" data-obrigatorio>
            <option value="">Selecione...</option>
          </select>
        </div>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-convite">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-enviar-convite">Enviar convite</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-convite').addEventListener('click', fecharModal);

  const form = document.getElementById('form-convidar-membro');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  // Select de profissional só aparece (e só é obrigatório) pro perfil
  // 'profissional' — populado sob demanda, na primeira vez que o perfil é
  // escolhido, pra não disparar a chamada à toa pros outros dois perfis.
  const blocoProfissional = document.getElementById('bloco-convite-profissional');
  const selectProfissional = document.getElementById('convite-profissional-id');
  let profissionaisCarregados = false;
  document.getElementById('convite-role').addEventListener('change', async (e) => {
    const ehProfissional = e.target.value === 'profissional';
    blocoProfissional.hidden = !ehProfissional;
    selectProfissional.removeAttribute('data-obrigatorio');
    if (!ehProfissional) return;
    selectProfissional.setAttribute('data-obrigatorio', '');
    if (profissionaisCarregados) return;
    const dados = await api('/api/profissionais');
    if (dados && dados.profissionais) {
      selectProfissional.innerHTML = '<option value="">Selecione...</option>'
        + dados.profissionais.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
    }
    profissionaisCarregados = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('convidar-membro-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-enviar-convite');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const role = document.getElementById('convite-role').value;
    const resultado = await api('/api/equipe/convites', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('convite-email').value.trim(),
        role,
        ...(role === 'profissional' ? { profissional_id: selectProfissional.value } : {}),
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Convite enviado com sucesso.', 'sucesso');
      renderEquipe();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao enviar convite.';
      btn.disabled = false;
      btn.textContent = 'Enviar convite';
    }
  });
}

function abrirModalAlterarAtivoMembro(membro) {
  const desativando = membro.ativo;
  abrirModal(
    `<h3>${desativando ? 'Desativar' : 'Reativar'} membro</h3>`,
    `
      <p class="modal-texto">${desativando
        ? `<strong>${membro.nome || membro.email}</strong> perderá o acesso ao Kyvvo imediatamente. Você pode reativar o acesso quando quiser.`
        : `<strong>${membro.nome || membro.email}</strong> volta a ter acesso ao Kyvvo.`}</p>
      <div class="modal-erro" id="alterar-ativo-membro-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-alterar-ativo">Voltar</button>
        <button class="${desativando ? 'btn-perigo' : 'btn-primario'}" id="btn-confirmar-alterar-ativo">Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-alterar-ativo').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-alterar-ativo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-alterar-ativo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/equipe/membros/${membro.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ativo: !desativando }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(`Membro ${desativando ? 'desativado' : 'reativado'} com sucesso.`, 'sucesso');
      renderEquipe();
    } else {
      document.getElementById('alterar-ativo-membro-erro').textContent = (resultado && resultado.error) || 'Erro ao atualizar membro.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

function abrirModalRemoverMembro(membro) {
  abrirModal(
    '<h3>Remover membro</h3>',
    `
      <p class="modal-texto">Remover <strong>${membro.nome || membro.email}</strong> da equipe? Esta ação não pode ser desfeita — a pessoa perde o acesso imediatamente e precisaria de um novo convite pra voltar.</p>
      <div class="modal-erro" id="remover-membro-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-remover-membro">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-remover-membro">Remover</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-remover-membro').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-remover-membro').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-remover-membro');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/equipe/membros/${membro.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Membro removido com sucesso.', 'sucesso');
      renderEquipe();
    } else {
      document.getElementById('remover-membro-erro').textContent = (resultado && resultado.error) || 'Erro ao remover membro.';
      btn.disabled = false;
      btn.textContent = 'Remover';
    }
  });
}
