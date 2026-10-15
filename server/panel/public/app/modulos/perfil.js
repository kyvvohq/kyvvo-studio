// Meu Perfil + Minha Empresa — extraído de app.js (fase 2 da modularização,
// 2026-10-15). As duas telas salvam via PATCH /api/perfil, cada uma
// mandando só o grupo de campo que lhe cabe (o backend trata cada grupo
// como opcional) — por isso ficam no mesmo módulo, como já eram vizinhas no
// arquivo original.
import { api } from '../core/api.js';
import {
  conteudo, mostrarToast, atualizarSaudacao, preencherUserMenu, infoSegmento, ativarSalvarSoQuandoAlterado,
  formatarTelefoneMascara,
} from '../core/shell.js';

function formatarCepMascara(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

// Mesma regra validada no backend (index.js SENHA_REGEX) — mantida em
// sincronia. Reaproveita o checklist visual de requisitos já usado no
// cadastro (cadastro.html, página standalone, cópia própria) pra "Alterar
// senha" em Meu Perfil.
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const REQUISITOS_SENHA = {
  tamanho: (v) => v.length >= 8,
  maiuscula: (v) => /[A-Z]/.test(v),
  numero: (v) => /\d/.test(v),
};

function wireToggleSenha(inputId, botaoId) {
  const input = document.getElementById(inputId);
  const botao = document.getElementById(botaoId);
  botao.addEventListener('click', () => {
    const oculta = input.type === 'password';
    input.type = oculta ? 'text' : 'password';
    botao.textContent = oculta ? '🙈' : '👁';
    botao.setAttribute('aria-label', oculta ? 'Ocultar senha' : 'Mostrar senha');
  });
}

// Meu Perfil (dados pessoais, PR12) — Nome do Responsável, Telefone+WhatsApp,
// E-mail. Nome do negócio/Endereço saíram pra renderMinhaEmpresa() logo
// abaixo; as duas telas salvam via PATCH /api/perfil, cada uma enviando só
// o grupo de campo que lhe cabe (o backend trata cada grupo como opcional).
// "Alterar senha" é um terceiro formulário independente, próprio botão de
// salvar, salvando via PATCH /api/perfil/senha (exige senha atual).
export async function renderPerfil() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  // Telefone/WhatsApp continuam sendo colunas separadas no banco (ver PATCH
  // /api/perfil) — o checkbox só reflete se elas já batem, pra não obrigar o
  // dono a digitar o número duas vezes quando são o mesmo.
  const telefoneEhWhatsapp = !!perfil.whatsapp && perfil.whatsapp === perfil.telefone;

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-perfil" novalidate>
      <label for="nome_responsavel">Nome do Responsável <span class="obrigatorio">*</span></label>
      <input type="text" id="nome_responsavel" value="${perfil.nome_responsavel || ''}">
      <div class="field-error" id="erro-nome_responsavel"></div>

      <label for="telefone">Telefone <span class="obrigatorio">*</span></label>
      <div class="campo-com-toggle">
        <input type="tel" id="telefone" placeholder="(11) 99999-9999" value="${formatarTelefoneMascara(perfil.telefone)}">
        <label class="toggle-linha">
          <span class="toggle-switch">
            <input type="checkbox" id="telefone-e-whatsapp" ${telefoneEhWhatsapp ? 'checked' : ''}>
            <span class="toggle-switch-trilho"></span>
          </span>
          Também é WhatsApp?
        </label>
      </div>
      <div class="field-error" id="erro-telefone"></div>

      <label>E-mail</label>
      <input type="text" value="${perfil.email || ''}" disabled>

      <button type="submit" id="btn-salvar-perfil">Salvar alterações</button>
    </form>

    <div class="pagamento-secao-divisor"></div>
    <h3 class="inicio-secao-titulo">Alterar senha</h3>
    <form class="perfil-form" id="form-alterar-senha" novalidate>
      <label for="senha_atual">Senha atual <span class="obrigatorio">*</span></label>
      <div class="senha-wrapper">
        <input type="password" id="senha_atual" autocomplete="current-password">
        <button type="button" id="btn-toggle-senha_atual" class="toggle-senha" aria-label="Mostrar senha" tabindex="-1">👁</button>
      </div>
      <div class="field-error" id="erro-senha_atual"></div>

      <label for="senha_nova">Senha nova <span class="obrigatorio">*</span></label>
      <div class="senha-wrapper">
        <input type="password" id="senha_nova" autocomplete="new-password">
        <button type="button" id="btn-toggle-senha_nova" class="toggle-senha" aria-label="Mostrar senha" tabindex="-1">👁</button>
      </div>
      <ul class="senha-requisitos" id="senha-requisitos">
        <li id="req-tamanho" role="checkbox" aria-checked="false">Mínimo de 8 caracteres</li>
        <li id="req-maiuscula" role="checkbox" aria-checked="false">1 letra maiúscula</li>
        <li id="req-numero" role="checkbox" aria-checked="false">1 número</li>
      </ul>
      <div class="field-error" id="erro-senha_nova"></div>

      <label for="senha_repetir">Repetir senha nova <span class="obrigatorio">*</span></label>
      <div class="senha-wrapper">
        <input type="password" id="senha_repetir" autocomplete="new-password">
        <button type="button" id="btn-toggle-senha_repetir" class="toggle-senha" aria-label="Mostrar senha" tabindex="-1">👁</button>
      </div>
      <div class="field-error" id="erro-senha_repetir"></div>

      <button type="submit" id="btn-salvar-senha">Salvar</button>
    </form>
  `;

  const telefoneInput = document.getElementById('telefone');
  telefoneInput.addEventListener('input', () => {
    telefoneInput.value = formatarTelefoneMascara(telefoneInput.value);
  });

  document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeResponsavel = document.getElementById('nome_responsavel').value;
    const telefone = document.getElementById('telefone').value;

    const erros = {
      nome_responsavel: nomeResponsavel.trim().length >= 2 ? '' : 'Informe o nome do responsável.',
      telefone: telefone.replace(/\D/g, '').length >= 10 ? '' : 'Informe um telefone válido com DDD.',
    };

    let primeiroInvalido = null;
    ['nome_responsavel', 'telefone'].forEach((campo) => {
      document.getElementById(campo).classList.toggle('invalid', !!erros[campo]);
      document.getElementById('erro-' + campo).textContent = erros[campo];
      if (erros[campo] && !primeiroInvalido) primeiroInvalido = document.getElementById(campo);
    });

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-perfil');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome_responsavel: nomeResponsavel,
        telefone,
        telefone_e_whatsapp: document.getElementById('telefone-e-whatsapp').checked,
      }),
    });

    if (resultado && !resultado.error) {
      mostrarToast('Perfil atualizado com sucesso.', 'sucesso');
      preencherUserMenu(resultado);
      // US57 — sem isso, a saudação do topo ("Bom dia, {nome antigo}!")
      // ficava com o nome desatualizado até um novo login, mesmo com o
      // resto da tela (user menu) já refletindo o nome novo.
      localStorage.setItem('kyvvo_nome', resultado.nome_responsavel || '');
      atualizarSaudacao();
      renderPerfil();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });

  // ---------- Alterar senha ----------
  wireToggleSenha('senha_atual', 'btn-toggle-senha_atual');
  wireToggleSenha('senha_nova', 'btn-toggle-senha_nova');
  wireToggleSenha('senha_repetir', 'btn-toggle-senha_repetir');

  const senhaAtualInput = document.getElementById('senha_atual');
  const senhaNovaInput = document.getElementById('senha_nova');
  const senhaRepetirInput = document.getElementById('senha_repetir');

  function atualizarChecklistSenha(valor) {
    Object.keys(REQUISITOS_SENHA).forEach((chave) => {
      const atendido = REQUISITOS_SENHA[chave](valor);
      const item = document.getElementById('req-' + chave);
      item.classList.toggle('atendido', atendido);
      item.setAttribute('aria-checked', String(atendido));
    });
  }
  senhaNovaInput.addEventListener('input', () => atualizarChecklistSenha(senhaNovaInput.value));

  // As duas senhas são comparadas ao vivo (não só no submit) — mensagem some
  // assim que voltam a bater, sem esperar perder o foco.
  function validarRepeticaoSenha() {
    const erroEl = document.getElementById('erro-senha_repetir');
    if (!senhaRepetirInput.value) {
      erroEl.textContent = '';
      return true;
    }
    const bate = senhaRepetirInput.value === senhaNovaInput.value;
    erroEl.textContent = bate ? '' : 'As duas senhas estão diferentes.';
    return bate;
  }
  senhaRepetirInput.addEventListener('input', validarRepeticaoSenha);
  senhaNovaInput.addEventListener('input', validarRepeticaoSenha);

  document.getElementById('form-alterar-senha').addEventListener('submit', async (e) => {
    e.preventDefault();

    const erros = {
      senha_atual: senhaAtualInput.value ? '' : 'Informe sua senha atual.',
      senha_nova: SENHA_REGEX.test(senhaNovaInput.value) ? '' : 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      senha_repetir: senhaRepetirInput.value === senhaNovaInput.value ? '' : 'As duas senhas estão diferentes.',
    };

    let primeiroInvalido = null;
    Object.keys(erros).forEach((campo) => {
      document.getElementById('erro-' + campo).textContent = erros[campo];
      if (erros[campo] && !primeiroInvalido) primeiroInvalido = document.getElementById(campo);
    });

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btnSenha = document.getElementById('btn-salvar-senha');
    btnSenha.disabled = true;
    btnSenha.innerHTML = '<span class="spinner"></span>';

    const resultadoSenha = await api('/api/perfil/senha', {
      method: 'PATCH',
      body: JSON.stringify({
        senha_atual: senhaAtualInput.value,
        senha_nova: senhaNovaInput.value,
      }),
    });

    if (resultadoSenha && !resultadoSenha.error) {
      // token_version++ no backend já invalidou a sessão atual — desloga de
      // verdade em vez de deixar a SPA rodando com um JWT que vai cair em
      // 401 na próxima chamada qualquer.
      localStorage.removeItem('kyvvo_token');
      window.location.href = '/login?senha_redefinida=1';
    } else {
      document.getElementById('erro-senha_atual').textContent = (resultadoSenha && resultadoSenha.error) || 'Erro ao salvar. Tente novamente.';
      btnSenha.disabled = false;
      btnSenha.textContent = 'Salvar';
    }
  });
}

// Minha Empresa (dados do negócio, PR12) — Nome do [segmento] + Endereço
// completo. Reaproveita a mesma máscara de CEP/autocomplete ViaCEP que
// antes vivia em renderPerfil.
// Botão "Salvar" só habilita quando algum campo do form muda de verdade em
// relação ao estado carregado (pedido explícito pra Meu Negócio/Preferências:
// botão sempre fixo no topo à direita, desabilitado até haver alteração).
export async function renderMinhaEmpresa() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  const opcoesUF = UF_OPCOES.map((uf) => `<option value="${uf}" ${uf === perfil.endereco_uf ? 'selected' : ''}>${uf}</option>`).join('');
  const nomeCampoSegmento = infoSegmento(perfil.segmento).nomeCampo;

  conteudo.innerHTML = `
    <div class="inicio-cabecalho">
      <h2>Meu negócio</h2>
      <button type="submit" form="form-empresa" class="btn-novo-agendamento" id="btn-salvar-empresa">Salvar alterações</button>
    </div>
    <form class="perfil-form" id="form-empresa" novalidate>
      <label for="nome_segmento">${nomeCampoSegmento} <span class="obrigatorio">*</span></label>
      <input type="text" id="nome_segmento" value="${perfil.nome_segmento || ''}">
      <div class="field-error" id="erro-nome_segmento"></div>

      <label>Endereço</label>
      <div class="endereco-grid">
        <div>
          <label for="endereco-cep" class="endereco-sublabel">CEP <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-cep" placeholder="00000-000" value="${formatarCepMascara(perfil.endereco_cep)}">
        </div>
        <div>
          <label for="endereco-numero" class="endereco-sublabel">Número <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-numero" value="${perfil.endereco_numero || ''}">
        </div>
      </div>
      <label for="endereco-logradouro" class="endereco-sublabel">Rua / Logradouro <span class="obrigatorio">*</span></label>
      <input type="text" id="endereco-logradouro" value="${perfil.endereco_logradouro || ''}">
      <div class="endereco-grid">
        <div>
          <label for="endereco-complemento" class="endereco-sublabel">Complemento (opcional)</label>
          <input type="text" id="endereco-complemento" value="${perfil.endereco_complemento || ''}">
        </div>
        <div>
          <label for="endereco-bairro" class="endereco-sublabel">Bairro <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-bairro" value="${perfil.endereco_bairro || ''}">
        </div>
      </div>
      <div class="endereco-grid">
        <div>
          <label for="endereco-cidade" class="endereco-sublabel">Cidade <span class="obrigatorio">*</span></label>
          <input type="text" id="endereco-cidade" value="${perfil.endereco_cidade || ''}">
        </div>
        <div>
          <label for="endereco-uf" class="endereco-sublabel">Estado <span class="obrigatorio">*</span></label>
          <select id="endereco-uf">${opcoesUF}</select>
        </div>
      </div>
      <div class="field-error" id="erro-endereco"></div>
    </form>
  `;

  const formEmpresa = document.getElementById('form-empresa');
  const btnSalvarEmpresa = document.getElementById('btn-salvar-empresa');
  const controleSalvarEmpresa = ativarSalvarSoQuandoAlterado(formEmpresa, btnSalvarEmpresa);

  const cepInput = document.getElementById('endereco-cep');
  cepInput.addEventListener('input', () => {
    cepInput.value = formatarCepMascara(cepInput.value);
  });

  // CA04 — ao sair do campo CEP, autopreenche o resto do endereço via ViaCEP.
  cepInput.addEventListener('blur', async () => {
    const cep = cepInput.value.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await res.json();
      if (dados.erro) {
        document.getElementById('erro-endereco').textContent = 'CEP não encontrado. Preencha o endereço manualmente.';
        return;
      }
      document.getElementById('erro-endereco').textContent = '';
      document.getElementById('endereco-logradouro').value = dados.logradouro || '';
      document.getElementById('endereco-bairro').value = dados.bairro || '';
      document.getElementById('endereco-cidade').value = dados.localidade || '';
      document.getElementById('endereco-uf').value = dados.uf || '';
      // ViaCEP seta os campos direto (sem disparar 'input'/'change') — força
      // uma checagem manual do botão Salvar, que só escuta esses eventos.
      formEmpresa.dispatchEvent(new Event('input'));
    } catch (erro) {
      // Falha de rede na consulta ao ViaCEP: deixa o usuário preencher os
      // subcampos manualmente em vez de bloquear o formulário.
    }
  });

  document.getElementById('form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeSegmento = document.getElementById('nome_segmento').value;
    const cep = document.getElementById('endereco-cep').value;
    const logradouro = document.getElementById('endereco-logradouro').value;
    const numero = document.getElementById('endereco-numero').value;
    const complemento = document.getElementById('endereco-complemento').value;
    const bairro = document.getElementById('endereco-bairro').value;
    const cidade = document.getElementById('endereco-cidade').value;
    const uf = document.getElementById('endereco-uf').value;

    const erros = {
      nome_segmento: nomeSegmento.trim().length >= 2 ? '' : 'Informe o nome do seu negócio.',
      endereco:
        cep.replace(/\D/g, '').length === 8 && logradouro.trim() && numero.trim() && bairro.trim() && cidade.trim() && uf
          ? ''
          : 'Preencha todos os campos do endereço.',
    };

    let primeiroInvalido = null;
    document.getElementById('nome_segmento').classList.toggle('invalid', !!erros.nome_segmento);
    document.getElementById('erro-nome_segmento').textContent = erros.nome_segmento;
    if (erros.nome_segmento) primeiroInvalido = document.getElementById('nome_segmento');
    document.getElementById('erro-endereco').textContent = erros.endereco;
    if (erros.endereco && !primeiroInvalido) primeiroInvalido = document.getElementById('endereco-cep');

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-empresa');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome_segmento: nomeSegmento,
        endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf },
      }),
    });

    if (resultado && !resultado.error) {
      mostrarToast('Dados da empresa atualizados com sucesso.', 'sucesso');
      preencherUserMenu(resultado);
      renderMinhaEmpresa();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}
