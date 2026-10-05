let listaOSAtual = [];
let funcionarioSelecionadoId = null;
let dataSelecionada = null;
let listaFuncionariosCache = [];
let dadosGradeCache = null;
let listaTarefasCache = [];
let funcionariosOSSelecionados = [];
let usuarioSessao = null;

// Variáveis para Atendimentos Fixos
let abaAtendimentoAtual = 'FACILITIES';
let dataAtendimentoSelecionada = null;
let funcionariosDisponiveisAtendimento = [];
let atendimentosFixosCache = {};

document.addEventListener("DOMContentLoaded", async () => {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const dataHojeIso = hoje.toISOString().split('T')[0];
  
  if (document.getElementById("filtroMesAno")) document.getElementById("filtroMesAno").value = mesAtual;
  if (document.getElementById("filtroPendenciasMes")) document.getElementById("filtroPendenciasMes").value = mesAtual;
  if (document.getElementById("filtroDashboardMes")) document.getElementById("filtroDashboardMes").value = mesAtual;
  if (document.getElementById("filtroAtendimentosMes")) document.getElementById("filtroAtendimentosMes").value = mesAtual;
  if (document.getElementById("osData")) document.getElementById("osData").value = dataHojeIso;
  
  await verificarSessaoUsuario();
});

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("open");
}

async function verificarSessaoUsuario() {
  try {
    const res = await fetch('/api/usuario_atual');
    if (!res.ok) { window.location.href = '/'; return; }

    const data = await res.json();
    if (!data.logado) { window.location.href = '/'; return; }

    usuarioSessao = data.usuario;
    document.getElementById("nomeUsuarioLogado").innerText = `👤 ${usuarioSessao.nome} (${usuarioSessao.nivel.toUpperCase()})`;

    aplicarPermissoesMenu();
  } catch (err) {
    window.location.href = '/';
  }
}

function aplicarPermissoesMenu() {
  const todosModulos = ['paginaDashboard', 'paginaAtendimentos', 'paginaOS', 'paginaGrade', 'paginaPendencias', 'paginaTarefas', 'paginaCadastro', 'paginaUsuarios'];
  let primeiraPaginaDisponivel = null;

  todosModulos.forEach(modId => {
    const btn = document.getElementById(`btn-${modId}`);
    if (!btn) return;

    if (usuarioSessao.nivel === 'admin') {
      btn.style.display = 'block';
      if (!primeiraPaginaDisponivel) primeiraPaginaDisponivel = modId;
    } else {
      if (modId === 'paginaUsuarios') {
        btn.style.display = 'none';
      } else if (usuarioSessao.modulos.includes(modId)) {
        btn.style.display = 'block';
        if (!primeiraPaginaDisponivel) primeiraPaginaDisponivel = modId;
      } else {
        btn.style.display = 'none';
      }
    }
  });

  if (primeiraPaginaDisponivel) {
    mostrarPagina(primeiraPaginaDisponivel);
  }
}

async function efetuarLogout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}

function mostrarPagina(paginaId) {
  if (usuarioSessao.nivel !== 'admin' && paginaId !== 'paginaUsuarios' && !usuarioSessao.modulos.includes(paginaId)) {
    alert("Você não possui permissão para acessar este módulo.");
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav .nav-btn').forEach(b => b.classList.remove('active'));
  
  const pgEl = document.getElementById(paginaId);
  if (pgEl) pgEl.classList.add('active');

  const btnEl = document.getElementById(`btn-${paginaId}`);
  if (btnEl) btnEl.classList.add('active');

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("open");
  }

  if (paginaId === 'paginaDashboard') carregarDashboard();
  if (paginaId === 'paginaAtendimentos') carregarAtendimentosFixos();
  if (paginaId === 'paginaGrade') carregarGrade();
  if (paginaId === 'paginaCadastro') carregarListaCadastro();
  if (paginaId === 'paginaPendencias') carregarPendencias();
  if (paginaId === 'paginaTarefas') carregarTarefas();
  if (paginaId === 'paginaUsuarios') carregarUsuarios();
}

// TROCA DE SENHA
function abrirModalTrocaSenha() {
  document.getElementById("formTrocaSenha").reset();
  document.getElementById("modalTrocaSenha").style.display = "block";
}

function fecharModalTrocaSenha() {
  document.getElementById("modalTrocaSenha").style.display = "none";
}

async function salvarNovaSenha(e) {
  e.preventDefault();
  const senhaAtual = document.getElementById("senhaAtual").value;
  const novaSenha = document.getElementById("novaSenha").value;
  const confirmarNovaSenha = document.getElementById("confirmarNovaSenha").value;

  if (novaSenha !== confirmarNovaSenha) {
    alert("A confirmação da nova senha não confere com a nova senha digitada.");
    return;
  }

  const res = await fetch('/api/usuario/alterar_senha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha })
  });

  const resJson = await res.json();
  if (res.ok) {
    alert(resJson.mensagem);
    fecharModalTrocaSenha();
  } else {
    alert(resJson.erro || "Erro ao alterar a senha.");
  }
}

// PÁGINA DE ATENDIMENTOS FIXOS (5 ABAS & CALENDÁRIO VERTICAL)
function trocarAbaAtendimento(novaAba, btnElement) {
  abaAtendimentoAtual = novaAba;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btnElement.classList.add('active');
  carregarAtendimentosFixos();
}

async function carregarAtendimentosFixos() {
  const [ano, mes] = document.getElementById("filtroAtendimentosMes").value.split("-");
  const res = await fetch(`/api/atendimentos_fixos?aba=${abaAtendimentoAtual}&ano=${ano}&mes=${mes}`);
  const data = await res.json();

  atendimentosFixosCache = data.atendimentos || {};

  const resFunc = await fetch('/api/funcionarios');
  funcionariosDisponiveisAtendimento = await resFunc.json();

  const tbody = document.getElementById("tabelaAtendimentosFixos");
  tbody.innerHTML = "";

  const diasSemana = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"];

  for (let d = 1; d <= data.num_dias; d++) {
    const diaStr = String(d).padStart(2, '0');
    const dataIso = `${data.ano}-${String(data.mes).padStart(2, '0')}-${diaStr}`;
    const dtObj = new Date(data.ano, data.mes - 1, d);
    const nomeDia = diasSemana[dtObj.getDay() === 0 ? 6 : dtObj.getDay() - 1];

    const escalaDia = atendimentosFixosCache[dataIso] || [];
    let badgeEquipe = escalaDia.map(f => `<span class="func-tag-small">👤 ${f.nome}</span>`).join(" ");

    if (!badgeEquipe) {
      badgeEquipe = `<span style="color:#94a3b8; font-style:italic;">Nenhum funcionário escalado</span>`;
    }

    tbody.innerHTML += `
      <tr>
        <td><b>${diaStr}/${data.mes}/${data.ano}</b></td>
        <td><small>${nomeDia}</small></td>
        <td style="text-align:left;">${badgeEquipe}</td>
        <td>
          <button class="btn-secondary" onclick="abrirModalEscalarAtendimento('${dataIso}')">Escalar</button>
        </td>
      </tr>
    `;
  }
}

function abrirModalEscalarAtendimento(dataIso) {
  dataAtendimentoSelecionada = dataIso;
  const dataBr = dataIso.split('-').reverse().join('/');
  
  document.getElementById("tituloModalAtendimento").innerText = `Escala Fixa - ${abaAtendimentoAtual}`;
  document.getElementById("subtituloModalAtendimento").innerText = `Selecione os funcionários para o dia ${dataBr}`;

  document.getElementById("buscaFuncAtendimento").value = "";
  renderizarListaModalAtendimento();
  
  document.getElementById("modalSelecaoAtentimento").style.display = "block";
}

function fecharModalAtendimento() {
  document.getElementById("modalSelecaoAtentimento").style.display = "none";
}

function renderizarListaModalAtendimento() {
  const container = document.getElementById("listaCheckFuncionariosAtendimento");
  const termo = document.getElementById("buscaFuncAtendimento").value.toLowerCase().trim();
  container.innerHTML = "";

  const escaladosAtuais = atendimentosFixosCache[dataAtendimentoSelecionada] || [];
  const idsEscalados = escaladosAtuais.map(f => f.id);

  const filtrados = funcionariosDisponiveisAtendimento.filter(f => {
    return !termo || f.nome.toLowerCase().includes(termo) || (f.matricula && f.matricula.toLowerCase().includes(termo));
  });

  if (filtrados.length === 0) {
    container.innerHTML = `<div style="padding:10px; color:#94a3b8;">Nenhum funcionário encontrado.</div>`;
    return;
  }

  filtrados.forEach(f => {
    const isChecked = idsEscalados.includes(f.id) ? 'checked' : '';
    container.innerHTML += `
      <label class="check-item">
        <input type="checkbox" class="chk-atendimento" value="${f.id}" ${isChecked}>
        <span><b>${f.nome}</b> <small>(${f.matricula || '-'} | ${f.cargo || '-'})</small></span>
      </label>
    `;
  });
}

function filtrarListaModalAtendimento() {
  renderizarListaModalAtendimento();
}

async function salvarAtendimentoFixoData() {
  const chks = document.querySelectorAll('.chk-atendimento:checked');
  const idsSelecionados = Array.from(chks).map(c => parseInt(c.value));

  const payload = {
    aba: abaAtendimentoAtual,
    data: dataAtendimentoSelecionada,
    funcionarios_ids: idsSelecionados
  };

  const res = await fetch('/api/atendimentos_fixos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    fecharModalAtendimento();
    carregarAtendimentosFixos();
  } else {
    alert("Erro ao salvar escala fixa.");
  }
}

// 0. DASHBOARD
async function carregarDashboard() {
  const [ano, mes] = document.getElementById("filtroDashboardMes").value.split("-");
  const res = await fetch(`/api/dashboard?ano=${ano}&mes=${mes}`);
  const data = await res.json();

  document.getElementById("kpiPendencias").innerText = data.qtd_pendencias;
  document.getElementById("kpiHorasExtras").innerText = `${data.total_horas_extras}h`;
  document.getElementById("kpiTreinamento").innerText = data.total_func_treinamento;

  document.getElementById("dashFunc50").innerText = data.funcionarios_extras.extra_50;
  document.getElementById("dashFunc70").innerText = data.funcionarios_extras.extra_70;
  document.getElementById("dashFunc100").innerText = data.funcionarios_extras.extra_100;

  const tbody = document.getElementById("tabelaTreinamentosDiarios");
  tbody.innerHTML = "";

  if (data.treinamentos_diarios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" style="padding:10px; color:#64748b;">Nenhum registro de treinamento no mês.</td></tr>`;
    return;
  }

  data.treinamentos_diarios.forEach(item => {
    tbody.innerHTML += `
      <tr>
        <td><b>${item.data}</b></td>
        <td><span class="badge-info">${item.qtd} colaboradores</span></td>
      </tr>
    `;
  });
}

// LANÇAMENTO DE OS
async function pesquisarFuncionariosOS(termo) {
  const ul = document.getElementById("listaSugestoesOS");
  if (!termo.trim()) {
    ul.style.display = "none";
    return;
  }

  const res = await fetch(`/api/funcionarios/buscar?q=${encodeURIComponent(termo)}`);
  const lista = await res.json();

  ul.innerHTML = "";
  if (lista.length === 0) {
    ul.innerHTML = `<li style="color:#94a3b8; cursor:default;">Nenhum funcionário encontrado</li>`;
  } else {
    lista.forEach(f => {
      const jaSelecionado = funcionariosOSSelecionados.some(item => item.id === f.id);
      if (!jaSelecionado) {
        ul.innerHTML += `
          <li onclick="selecionarFuncionarioOS(${f.id}, '${f.nome}', '${f.matricula || ''}')">
            <b>${f.nome}</b> <small>(${f.matricula || 'Sem Matrícula'} - ${f.cargo})</small>
          </li>
        `;
      }
    });
  }
  ul.style.display = "block";
}

function selecionarFuncionarioOS(id, nome, matricula) {
  funcionariosOSSelecionados.push({ id, nome, matricula });
  document.getElementById("osPesquisaFuncionario").value = "";
  document.getElementById("listaSugestoesOS").style.display = "none";
  renderizarTagsFuncionariosOS();
}

function removerFuncionarioOS(id) {
  funcionariosOSSelecionados = funcionariosOSSelecionados.filter(f => f.id !== id);
  renderizarTagsFuncionariosOS();
}

function renderizarTagsFuncionariosOS() {
  const container = document.getElementById("containerTagFuncionariosOS");
  container.innerHTML = "";

  if (funcionariosOSSelecionados.length === 0) {
    container.innerHTML = `<span class="placeholder-text">Nenhum funcionário adicionado ainda.</span>`;
    return;
  }

  funcionariosOSSelecionados.forEach(f => {
    container.innerHTML += `
      <span class="func-tag">
        👤 ${f.nome} ${f.matricula ? '(' + f.matricula + ')' : ''}
        <button type="button" onclick="removerFuncionarioOS(${f.id})">&times;</button>
      </span>
    `;
  });
}

document.getElementById("formLancamentoOS")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (funcionariosOSSelecionados.length === 0) {
    alert("Adicione pelo menos um funcionário antes de lançar a OS.");
    return;
  }

  const dados = {
    ordem_servico: document.getElementById("osNumero").value,
    descricao: document.getElementById("osDescricao").value,
    data: document.getElementById("osData").value,
    horas: parseFloat(document.getElementById("osHoras").value),
    funcionarios_ids: funcionariosOSSelecionados.map(f => f.id)
  };

  const res = await fetch("/api/os/lancamento", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });

  const resultado = await res.json();

  if (res.ok) {
    alert(resultado.mensagem);
    document.getElementById("osNumero").value = "";
    document.getElementById("osDescricao").value = "";
    document.getElementById("osHoras").value = "";
    funcionariosOSSelecionados = [];
    renderizarTagsFuncionariosOS();
  } else {
    alert(resultado.erro || "Erro ao efetuar lançamento.");
  }
});

// 1. CARREGAR E FILTRAR GRADE MATRICIAL
async function carregarGrade() {
  const [ano, mes] = document.getElementById("filtroMesAno").value.split("-");
  const supervisor = document.getElementById("filtroSupervisor").value;

  const res = await fetch(`/api/grade?ano=${ano}&mes=${mes}&supervisor=${encodeURIComponent(supervisor)}`);
  dadosGradeCache = await res.json();

  const selectSup = document.getElementById("filtroSupervisor");
  const valSupAtual = selectSup.value;
  selectSup.innerHTML = `<option value="">Todos os Supervisores</option>`;
  dadosGradeCache.supervisores.forEach(sup => {
    selectSup.innerHTML += `<option value="${sup}" ${sup === valSupAtual ? 'selected' : ''}>${sup}</option>`;
  });

  const selectArea = document.getElementById("filtroArea");
  const valAreaAtual = selectArea ? selectArea.value : "";
  if (selectArea) {
    const areasUnicas = [...new Set(dadosGradeCache.funcionarios.map(f => f.atuacao).filter(Boolean))];
    selectArea.innerHTML = `<option value="">Todas as Áreas</option>`;
    areasUnicas.forEach(area => {
      selectArea.innerHTML += `<option value="${area}" ${area === valAreaAtual ? 'selected' : ''}>${area}</option>`;
    });
  }

  aplicarFiltrosGrade();
}

function aplicarFiltrosGrade() {
  if (!dadosGradeCache) return;

  const termoBusca = document.getElementById("filtroGradeBusca").value.toLowerCase().trim();
  const filtroSit = document.getElementById("filtroGradeSituacao").value;
  const filtroArea = document.getElementById("filtroArea") ? document.getElementById("filtroArea").value : "";

  const gridHeader = document.getElementById("gridHeader");
  const gridBody = document.getElementById("gridBody");

  gridHeader.innerHTML = `
    <th class="col-fixed">Funcionário</th>
    <th class="col-fixed col-cargo">Cargo</th>
    <th class="col-fixed col-atuacao">Atuação</th>
  `;

  for (let d = 1; d <= dadosGradeCache.num_dias; d++) {
    gridHeader.innerHTML += `<th>${String(d).padStart(2, '0')}/${dadosGradeCache.mes}</th>`;
  }

  gridBody.innerHTML = "";
  let areaAtual = "";

  const funcionariosFiltrados = dadosGradeCache.funcionarios.filter(f => {
    const atendeNomeMat = !termoBusca || f.nome.toLowerCase().includes(termoBusca) || (f.matricula && f.matricula.toLowerCase().includes(termoBusca));
    const atendeArea = !filtroArea || f.atuacao === filtroArea;

    if (!atendeNomeMat || !atendeArea) return false;
    if (!filtroSit) return true;

    let possuiSituacao = false;
    for (let d = 1; d <= dadosGradeCache.num_dias; d++) {
      const diaFormatado = String(d).padStart(2, '0');
      const dataIso = `${dadosGradeCache.ano}-${String(dadosGradeCache.mes).padStart(2, '0')}-${diaFormatado}`;
      const reg = (dadosGradeCache.lancamentos[f.id] && dadosGradeCache.lancamentos[f.id][dataIso]) ? dadosGradeCache.lancamentos[f.id][dataIso] : null;

      if (reg) {
        if (filtroSit === "COM_EXTRA" && reg.calc && (reg.calc.horas_50 > 0 || reg.calc.horas_70 > 0 || reg.calc.horas_100 > 0)) possuiSituacao = true;
        else if (filtroSit === "INCOMPLETO" && reg.calc && reg.calc.carga_padrao > 0 && reg.horas < reg.calc.carga_padrao) possuiSituacao = true;
        else if (reg.situacao === filtroSit) possuiSituacao = true;
      }
    }
    return possuiSituacao;
  });

  if (funcionariosFiltrados.length === 0) {
    gridBody.innerHTML = `<tr><td colspan="${dadosGradeCache.num_dias + 3}" style="padding:15px; color:#64748b;">Nenhum funcionário atende aos filtros informados.</td></tr>`;
    return;
  }

  funcionariosFiltrados.forEach(f => {
    if (f.atuacao !== areaAtual) {
      areaAtual = f.atuacao;
      gridBody.innerHTML += `<tr><td colspan="${dadosGradeCache.num_dias + 3}" class="area-header">ÁREA: ${areaAtual}</td></tr>`;
    }

    let linha = `
      <tr>
        <td class="col-fixed func-click" onclick="abrirModalInfoFuncionario(${f.id})">
          <b>${f.nome}</b><br><small>Mat: ${f.matricula || '-'} | Sup: ${f.supervisor || '-'}</small>
        </td>
        <td class="col-fixed col-cargo">${f.cargo}</td>
        <td class="col-fixed col-atuacao">${f.atuacao}</td>
    `;

    for (let d = 1; d <= dadosGradeCache.num_dias; d++) {
      const diaFormatado = String(d).padStart(2, '0');
      const dataIso = `${dadosGradeCache.ano}-${String(dadosGradeCache.mes).padStart(2, '0')}-${diaFormatado}`;
      const reg = (dadosGradeCache.lancamentos[f.id] && dadosGradeCache.lancamentos[f.id][dataIso]) ? dadosGradeCache.lancamentos[f.id][dataIso] : null;

      let classeStatus = "";
      let textoCel = "-";

      if (reg) {
        const isSanada = reg.status_pendencia === 'SANADA';

        if (reg.situacao === 'Presente') {
          const calc = reg.calc;
          const temExtra = calc && (calc.horas_50 > 0 || calc.horas_70 > 0 || calc.horas_100 > 0);
          
          if (isSanada) {
            classeStatus = "st-presente-ok"; textoCel = `${reg.horas}h`;
          } else if (temExtra) {
            classeStatus = "st-extra"; textoCel = `${reg.horas}h*`;
          } else if (calc && calc.carga_padrao > 0 && reg.horas < calc.carga_padrao) {
            classeStatus = "st-pendente"; textoCel = `${reg.horas}h`;
          } else {
            classeStatus = "st-presente-ok"; textoCel = `${reg.horas}h`;
          }
        } else if (reg.situacao === 'Deslocado') {
          if (isSanada) {
            classeStatus = "st-deslocado"; textoCel = reg.horas > 0 ? `${reg.horas}h` : "DES";
          } else if (reg.horas === 0) {
            classeStatus = "st-pendente"; textoCel = "DES!";
          } else {
            classeStatus = "st-deslocado"; textoCel = `${reg.horas}h`;
          }
        } else if (reg.situacao === 'Falta') {
          classeStatus = "st-falta"; textoCel = "F";
        } else if (reg.situacao === 'Folga') {
          classeStatus = "st-folga"; textoCel = "FOL";
        } else if (reg.situacao === 'Treinamento') {
          classeStatus = "st-treinamento"; textoCel = "TRE";
        }
      }

      linha += `<td class="cell-day ${classeStatus}" onclick="abrirModal('${f.id}', '${f.nome}', '${dataIso}')">${textoCel}</td>`;
    }

    linha += `</tr>`;
    gridBody.innerHTML += linha;
  });
}

// MODAL DE LANÇAMENTO DIÁRIO
async function abrirModal(fId, fNome, dataIso) {
  funcionarioSelecionadoId = fId;
  dataSelecionada = dataIso;
  listaOSAtual = [];

  document.getElementById("modalFuncionarioNome").innerText = fNome;
  document.getElementById("modalDataTitulo").innerText = dataIso.split('-').reverse().join('/');

  const res = await fetch(`/api/lancamento/detalhes?funcionario_id=${fId}&data=${dataIso}`);
  const dados = await res.json();

  document.getElementById("modalSituacao").value = dados.situacao || "Presente";
  document.getElementById("modalObs").value = dados.observacao || "";
  listaOSAtual = dados.apropriacoes || [];

  alternarApropriacaoModal();
  renderizarListaOSModal();

  document.getElementById("modalLancamento").style.display = "block";
}

function fecharModal() {
  document.getElementById("modalLancamento").style.display = "none";
}

function alternarApropriacaoModal() {
  const sit = document.getElementById("modalSituacao").value;
  const sec = document.getElementById("modalSecaoApropriacao");
  sec.style.display = (sit === "Presente" || sit === "Deslocado") ? "block" : "none";
}

function adicionarOSModal() {
  const osNum = document.getElementById("modalOS").value.trim();
  const hrs = parseFloat(document.getElementById("modalHoras").value);

  if (!osNum || isNaN(hrs) || hrs <= 0) {
    alert("Informe o número da OS e a quantidade de horas válida.");
    return;
  }

  listaOSAtual.push({ ordem_servico: osNum, horas: hrs });
  document.getElementById("modalOS").value = "";
  document.getElementById("modalHoras").value = "";
  renderizarListaOSModal();
}

function removerOSModal(idx) {
  listaOSAtual.splice(idx, 1);
  renderizarListaOSModal();
}

function renderizarListaOSModal() {
  const ul = document.getElementById("modalListaOS");
  ul.innerHTML = "";

  listaOSAtual.forEach((item, i) => {
    ul.innerHTML += `
      <li>
        <span>OS: <b>${item.ordem_servico}</b> - ${item.horas}h</span>
        <button type="button" class="btn-remove-os" onclick="removerOSModal(${i})">&times;</button>
      </li>
    `;
  });
}

document.getElementById("formModal")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    funcionario_id: funcionarioSelecionadoId,
    data: dataSelecionada,
    situacao: document.getElementById("modalSituacao").value,
    observacao: document.getElementById("modalObs").value,
    apropriacoes: listaOSAtual
  };

  const res = await fetch("/api/lancamento", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    fecharModal();
    carregarGrade();
  } else {
    alert("Erro ao salvar lançamento diário.");
  }
});

// 2. PAINEL DE PENDÊNCIAS
async function carregarPendencias() {
  const [ano, mes] = document.getElementById("filtroPendenciasMes").value.split("-");
  const supervisor = document.getElementById("filtroPendenciasSupervisor").value;
  const tipo = document.getElementById("filtroTipoPendencia").value;
  const func = document.getElementById("filtroPendenciasFuncionario").value;
  const dataInicio = document.getElementById("filtroPendenciasDataInicio").value;
  const dataFim = document.getElementById("filtroPendenciasDataFim").value;

  const url = `/api/pendencias?ano=${ano}&mes=${mes}&supervisor=${encodeURIComponent(supervisor)}&tipo=${encodeURIComponent(tipo)}&funcionario=${encodeURIComponent(func)}&data_inicio=${dataInicio}&data_fim=${dataFim}`;
  const res = await fetch(url);
  const data = await res.json();

  const selectSup = document.getElementById("filtroPendenciasSupervisor");
  const valAtual = selectSup.value;
  selectSup.innerHTML = `<option value="">Todos os Supervisores</option>`;
  data.supervisores.forEach(sup => {
    selectSup.innerHTML += `<option value="${sup}" ${sup === valAtual ? 'selected' : ''}>${sup}</option>`;
  });

  const tbody = document.getElementById("tabelaPendencias");
  tbody.innerHTML = "";

  if (data.pendencias.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:15px; color:#059669; font-weight:bold;">✅ Nenhuma pendência encontrada para o filtro informado.</td></tr>`;
    return;
  }

  data.pendencias.forEach(p => {
    const dataBr = p.data.split("-").reverse().join("/");
    const classeLinha = p.horas_extras > 0 ? "st-extra-row" : "st-pendente-row";

    tbody.innerHTML += `
      <tr class="${classeLinha}">
        <td><b>${dataBr}</b></td>
        <td><a href="#" onclick="abrirModalInfoFuncionario(${p.funcionario_id}); return false;">${p.funcionario}</a></td>
        <td>${p.supervisor}</td>
        <td>${p.horas_trabalhadas}h</td>
        <td>${p.carga_padrao > 0 ? p.carga_padrao + 'h' : 'Fora da Jornada'}</td>
        <td><span class="badge-extra">${p.adicional_tipo}</span></td>
        <td><b>⚠️ Pendente</b></td>
        <td>${p.mensagem}</td>
        <td>
          <button class="btn-secondary" onclick="sanarEsumir(${p.funcionario_id}, '${p.data}')">Marcar Sanada</button>
        </td>
      </tr>
    `;
  });
}

function exportarPendenciasExcel() {
  const [ano, mes] = document.getElementById("filtroPendenciasMes").value.split("-");
  const supervisor = document.getElementById("filtroPendenciasSupervisor").value;
  const tipo = document.getElementById("filtroTipoPendencia").value;
  const func = document.getElementById("filtroPendenciasFuncionario").value;
  const dataInicio = document.getElementById("filtroPendenciasDataInicio").value;
  const dataFim = document.getElementById("filtroPendenciasDataFim").value;

  const query = `ano=${ano}&mes=${mes}&supervisor=${encodeURIComponent(supervisor)}&tipo=${encodeURIComponent(tipo)}&funcionario=${encodeURIComponent(func)}&data_inicio=${dataInicio}&data_fim=${dataFim}`;
  window.location.href = `/api/pendencias/exportar_excel?${query}`;
}

async function sanarEsumir(fId, dataIso) {
  await fetch('/api/pendencias/sanar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ funcionario_id: fId, data: dataIso })
  });
  carregarPendencias();
}

// FICHA DO FUNCIONÁRIO
async function abrirModalInfoFuncionario(fId) {
  const res = await fetch(`/api/funcionarios/${fId}/detalhes`);
  const data = await res.json();
  const f = data.info;

  let html = `
    <div style="line-height:1.6;">
      <p><b>Nome:</b> ${f.nome}</p>
      <p><b>Matrícula:</b> ${f.matricula || '-'}</p>
      <p><b>Cargo:</b> ${f.cargo || '-'}</p>
      <p><b>Atuação:</b> ${f.atuacao || '-'}</p>
      <p><b>Supervisor:</b> ${f.supervisor || '-'}</p>
      <p><b>Início Atividades:</b> ${f.inicio_atividades ? f.inicio_atividades.split('-').reverse().join('/') : '-'}</p>
      <hr style="margin: 10px 0; border:0; border-top:1px solid #e2e8f0;">
      <h4>Histórico Recente de Lançamentos</h4>
      <ul style="padding-left:18px; font-size:0.9rem;">
  `;

  if (data.historico.length === 0) {
    html += `<li>Nenhum lançamento encontrado.</li>`;
  } else {
    data.historico.forEach(h => {
      html += `<li><b>${h.data.split('-').reverse().join('/')}</b>: ${h.situacao} (${h.horas}h) ${h.observacao ? '- ' + h.observacao : ''}</li>`;
    });
  }

  html += `</ul></div>`;

  document.getElementById("infoFuncionarioBody").innerHTML = html;
  document.getElementById("modalInfoFuncionario").style.display = "block";
}

function fecharModalInfoFuncionario() {
  document.getElementById("modalInfoFuncionario").style.display = "none";
}

// 3. QUADRO DE TAREFAS (COM EDIÇÃO)
async function carregarTarefas() {
  const res = await fetch('/api/tarefas');
  listaTarefasCache = await res.json();
  renderizarKanban();
}

function renderizarKanban() {
  const colTodo = document.getElementById('col-todo');
  const colDoing = document.getElementById('col-doing');
  const colDone = document.getElementById('col-done');

  colTodo.innerHTML = '';
  colDoing.innerHTML = '';
  colDone.innerHTML = '';

  let cTodo = 0, cDoing = 0, cDone = 0;

  listaTarefasCache.forEach(t => {
    const cardHtml = `
      <div class="kanban-card prio-${t.prioridade}" draggable="true" ondragstart="drag(event, ${t.id})" id="card-${t.id}">
        <div class="card-title">${t.titulo}</div>
        ${t.descricao ? `<div class="card-desc">${t.descricao}</div>` : ''}
        <div class="card-footer">
          <span class="card-user">👤 ${t.responsavel || 'Sem dono'}</span>
          <div style="display:flex; gap:4px;">
            <button class="btn-edit-task" onclick="editarTarefa(${t.id})">✏️</button>
            <button class="btn-remove-os" onclick="excluirTarefa(${t.id})">✕</button>
          </div>
        </div>
      </div>
    `;

    if (t.status === 'Em Andamento') {
      colDoing.innerHTML += cardHtml; cDoing++;
    } else if (t.status === 'Concluído') {
      colDone.innerHTML += cardHtml; cDone++;
    } else {
      colTodo.innerHTML += cardHtml; cTodo++;
    }
  });

  document.getElementById('cnt-todo').innerText = cTodo;
  document.getElementById('cnt-doing').innerText = cDoing;
  document.getElementById('cnt-done').innerText = cDone;
}

function allowDrop(ev) { ev.preventDefault(); }
function drag(ev, id) { ev.dataTransfer.setData("text/plain", id); }

async function drop(ev, novoStatus) {
  ev.preventDefault();
  const id = ev.dataTransfer.getData("text/plain");

  await fetch('/api/tarefas', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: parseInt(id), status: novoStatus })
  });

  carregarTarefas();
}

function abrirModalTarefa() {
  document.getElementById('tarId').value = '';
  document.getElementById('formTarefa').reset();
  document.getElementById('modalTarefaTituloHeader').innerText = "Nova Tarefa";
  document.getElementById('btnSalvarTarefa').innerText = "Salvar Tarefa";
  document.getElementById('modalTarefa').style.display = 'block';
}

function editarTarefa(id) {
  const t = listaTarefasCache.find(item => item.id === id);
  if (!t) return;

  document.getElementById('tarId').value = t.id;
  document.getElementById('tarTitulo').value = t.titulo || '';
  document.getElementById('tarDescricao').value = t.descricao || '';
  document.getElementById('tarResponsavel').value = t.responsavel || '';
  document.getElementById('tarPrioridade').value = t.prioridade || 'Média';

  document.getElementById('modalTarefaTituloHeader').innerText = "Editar Tarefa";
  document.getElementById('btnSalvarTarefa').innerText = "Atualizar Tarefa";
  document.getElementById('modalTarefa').style.display = 'block';
}

function fecharModalTarefa() { document.getElementById('modalTarefa').style.display = 'none'; }

async function salvarTarefa(e) {
  e.preventDefault();
  const id = document.getElementById('tarId').value;
  const payload = {
    id: id ? parseInt(id) : null,
    titulo: document.getElementById('tarTitulo').value,
    descricao: document.getElementById('tarDescricao').value,
    responsavel: document.getElementById('tarResponsavel').value,
    prioridade: document.getElementById('tarPrioridade').value
  };

  const method = id ? 'PUT' : 'POST';

  await fetch('/api/tarefas', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  fecharModalTarefa();
  carregarTarefas();
}

async function excluirTarefa(id) {
  if (confirm("Deseja realmente excluir esta tarefa?")) {
    await fetch(`/api/tarefas?id=${id}`, { method: 'DELETE' });
    carregarTarefas();
  }
}

// 4. CADASTROS DE FUNCIONÁRIOS
async function carregarListaCadastro() {
  const res = await fetch('/api/funcionarios');
  listaFuncionariosCache = await res.json();
  
  const selectArea = document.getElementById("filtroCadastroArea");
  if (selectArea) {
    const areas = [...new Set(listaFuncionariosCache.map(f => f.atuacao).filter(Boolean))];
    selectArea.innerHTML = `<option value="">Todas as Áreas</option>`;
    areas.forEach(a => selectArea.innerHTML += `<option value="${a}">${a}</option>`);
  }

  filtrarTabelaCadastros();
}

function filtrarTabelaCadastros() {
  const termo = document.getElementById("inputPesquisaFuncionario") ? document.getElementById("inputPesquisaFuncionario").value.toLowerCase().trim() : "";
  const area = document.getElementById("filtroCadastroArea") ? document.getElementById("filtroCadastroArea").value : "";
  const tbody = document.getElementById("tabelaFuncionariosCadastrados");
  tbody.innerHTML = "";

  const filtrados = listaFuncionariosCache.filter(f => {
    const batNomeMatCargo = !termo || f.nome.toLowerCase().includes(termo) || (f.matricula && f.matricula.toLowerCase().includes(termo)) || (f.cargo && f.cargo.toLowerCase().includes(termo));
    const batArea = !area || f.atuacao === area;
    return batNomeMatCargo && batArea;
  });

  filtrados.forEach(f => {
    tbody.innerHTML += `
      <tr>
        <td>${f.matricula || '-'}</td>
        <td><b>${f.nome}</b></td>
        <td>${f.cargo || '-'}</td>
        <td>${f.atuacao || '-'}</td>
        <td>${f.inicio_atividades ? f.inicio_atividades.split('-').reverse().join('/') : '-'}</td>
        <td>${f.supervisor || '-'}</td>
        <td>
          <button class="btn-secondary" onclick="editarFuncionario(${f.id})">Editar</button>
          <button class="btn-remove-os" onclick="excluirFuncionario(${f.id})">Excluir</button>
        </td>
      </tr>
    `;
  });
}

document.getElementById("formCadastro")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("cadId").value;
  const payload = {
    id: id ? parseInt(id) : null,
    matricula: document.getElementById("cadMatricula").value,
    nome: document.getElementById("cadNome").value,
    cargo: document.getElementById("cadCargo").value,
    atuacao: document.getElementById("cadAtuacao").value,
    inicio_atividades: document.getElementById("cadInicioAtividades").value,
    supervisor: document.getElementById("cadSupervisor").value
  };

  const method = id ? "PUT" : "POST";
  const res = await fetch("/api/funcionarios", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const resJson = await res.json();
  if (res.ok) {
    limparFormularioCadastro();
    carregarListaCadastro();
  } else {
    alert(resJson.erro || "Erro ao salvar funcionário.");
  }
});

function editarFuncionario(id) {
  const f = listaFuncionariosCache.find(item => item.id === id);
  if (!f) return;

  document.getElementById("cadId").value = f.id;
  document.getElementById("cadMatricula").value = f.matricula || "";
  document.getElementById("cadNome").value = f.nome || "";
  document.getElementById("cadCargo").value = f.cargo || "";
  document.getElementById("cadAtuacao").value = f.atuacao || "";
  document.getElementById("cadInicioAtividades").value = f.inicio_atividades || "";
  document.getElementById("cadSupervisor").value = f.supervisor || "";

  document.getElementById("tituloFormCadastro").innerText = "Editar Funcionário";
  document.getElementById("btnSalvarCad").innerText = "Atualizar Funcionário";
  document.getElementById("btnCancelarEdit").style.display = "inline-block";
}

function limparFormularioCadastro() {
  document.getElementById("cadId").value = "";
  document.getElementById("formCadastro").reset();
  document.getElementById("tituloFormCadastro").innerText = "Cadastrar Novo Funcionário";
  document.getElementById("btnSalvarCad").innerText = "Salvar Funcionário";
  document.getElementById("btnCancelarEdit").style.display = "none";
}

async function excluirFuncionario(id) {
  if (confirm("Tem certeza que deseja excluir este funcionário?")) {
    await fetch(`/api/funcionarios?id=${id}`, { method: "DELETE" });
    carregarListaCadastro();
  }
}

// 5. GESTÃO DE USUÁRIOS
async function carregarUsuarios() {
  const res = await fetch('/api/usuarios');
  if (!res.ok) return;
  const lista = await res.json();
  const tbody = document.getElementById("tabelaUsuariosCadastrados");
  tbody.innerHTML = "";

  lista.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td><b>${u.nome}</b></td>
        <td>${u.email}</td>
        <td><span class="badge-extra">${u.nivel.toUpperCase()}</span></td>
        <td>${u.nivel === 'admin' ? '<i>Acesso Total</i>' : (u.modulos || []).join(', ')}</td>
        <td>
          <button class="btn-remove-os" onclick="excluirUsuario(${u.id})">Excluir</button>
        </td>
      </tr>
    `;
  });
}

function alternarCheckboxModulos() {
  const nivel = document.getElementById("usrNivel").value;
  const grupo = document.getElementById("grupoModulosAcc");
  grupo.style.display = nivel === 'admin' ? 'none' : 'block';
}

document.getElementById("formUsuario")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const checkboxes = document.querySelectorAll('input[name="usrModulos"]:checked');
  const modulos = Array.from(checkboxes).map(cb => cb.value);

  const payload = {
    nome: document.getElementById("usrNome").value,
    email: document.getElementById("usrEmail").value,
    senha: document.getElementById("usrSenha").value,
    nivel: document.getElementById("usrNivel").value,
    modulos
  };

  const res = await fetch("/api/usuarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const resJson = await res.json();
  if (res.ok) {
    document.getElementById("formUsuario").reset();
    carregarUsuarios();
  } else {
    alert(resJson.erro || "Erro ao cadastrar usuário.");
  }
});

async function excluirUsuario(id) {
  if (confirm("Deseja remover este usuário?")) {
    const res = await fetch(`/api/usuarios?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) carregarUsuarios();
    else alert(data.erro);
  }
}