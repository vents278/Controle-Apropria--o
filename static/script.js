let listaOSAtual = [];
let funcionarioSelecionadoId = null;
let dataSelecionada = null;
let listaFuncionariosCache = [];
let dadosGradeCache = null;
let listaTarefasCache = [];
let funcionariosOSSelecionados = [];

document.addEventListener("DOMContentLoaded", () => {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const dataHojeIso = hoje.toISOString().split('T')[0];
  
  document.getElementById("filtroMesAno").value = mesAtual;
  document.getElementById("filtroPendenciasMes").value = mesAtual;
  document.getElementById("filtroDashboardMes").value = mesAtual;
  if (document.getElementById("osData")) document.getElementById("osData").value = dataHojeIso;
  
  carregarDashboard();
  carregarListaCadastro();
});

function mostrarPagina(paginaId, evt) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(paginaId).classList.add('active');
  if (evt) evt.target.classList.add('active');

  if (paginaId === 'paginaDashboard') carregarDashboard();
  if (paginaId === 'paginaGrade') carregarGrade();
  if (paginaId === 'paginaCadastro') carregarListaCadastro();
  if (paginaId === 'paginaPendencias') carregarPendencias();
  if (paginaId === 'paginaTarefas') carregarTarefas();
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

// PÁGINA DE LANÇAMENTO DE OS
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

document.getElementById("formLancamentoOS").addEventListener("submit", async (e) => {
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
    carregarGrade();
  } else {
    alert(resultado.erro || "Erro ao efetuar lançamento.");
  }
});

document.addEventListener("click", (e) => {
  const wrapper = document.querySelector(".autocomplete-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    const ul = document.getElementById("listaSugestoesOS");
    if (ul) ul.style.display = "none";
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
    <th class="col-fixed">Cargo</th>
    <th class="col-fixed">Atuação</th>
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
        <td class="col-fixed">${f.cargo}</td>
        <td class="col-fixed">${f.atuacao}</td>
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
          const temExtra = calc.horas_50 > 0 || calc.horas_70 > 0 || calc.horas_100 > 0;
          
          if (isSanada) {
            classeStatus = "st-presente-ok"; textoCel = `${reg.horas}h`;
          } else if (temExtra) {
            classeStatus = "st-extra"; textoCel = `${reg.horas}h*`;
          } else if (calc.carga_padrao > 0 && reg.horas < calc.carga_padrao) {
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

// 2. PAINEL DE PENDÊNCIAS COM FILTROS E EXPORTAÇÃO
async function carregarPendencias() {
  const [ano, mes] = document.getElementById("filtroPendenciasMes").value.split("-");
  const supervisor = document.getElementById("filtroPendenciasSupervisor").value;
  const tipo = document.getElementById("filtroTipoPendencia").value;
  const func = document.getElementById("filtroPendenciasFuncionario").value;

  const res = await fetch(`/api/pendencias?ano=${ano}&mes=${mes}&supervisor=${encodeURIComponent(supervisor)}&tipo=${encodeURIComponent(tipo)}&funcionario=${encodeURIComponent(func)}`);
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

  const query = `ano=${ano}&mes=${mes}&supervisor=${encodeURIComponent(supervisor)}&tipo=${encodeURIComponent(tipo)}&funcionario=${encodeURIComponent(func)}`;
  window.location.href = `/api/pendencias/exportar_excel?${query}`;
}

async function sanarEsumir(fId, dataIso) {
  await fetch('/api/pendencias/sanar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ funcionario_id: fId, data: dataIso })
  });
  carregarPendencias();
  carregarGrade();
  carregarDashboard();
}

// 3. QUADRO DE TAREFAS (TRELLO)
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
          <button class="btn-remove-os" onclick="excluirTarefa(${t.id})">✕</button>
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

function abrirModalNovaTarefa() { document.getElementById('modalTarefa').style.display = 'block'; }
function fecharModalTarefa() { document.getElementById('modalTarefa').style.display = 'none'; }

async function salvarTarefa(e) {
  e.preventDefault();
  const dados = {
    titulo: document.getElementById('tarTitulo').value,
    descricao: document.getElementById('tarDescricao').value,
    responsavel: document.getElementById('tarResponsavel').value,
    prioridade: document.getElementById('tarPrioridade').value
  };

  await fetch('/api/tarefas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados)
  });

  document.getElementById('formTarefa').reset();
  fecharModalTarefa();
  carregarTarefas();
}

async function excluirTarefa(id) {
  if (!confirm("Deseja realmente excluir esta tarefa?")) return;
  await fetch(`/api/tarefas?id=${id}`, { method: 'DELETE' });
  carregarTarefas();
}

// 4. MODAL DE LANÇAMENTO E OS
async function abrirModal(fId, fNome, dataIso) {
  funcionarioSelecionadoId = fId;
  dataSelecionada = dataIso;
  listaOSAtual = [];

  document.getElementById("modalDataTitulo").innerText = dataIso.split("-").reverse().join("/");
  document.getElementById("modalFuncionarioNome").innerText = fNome;

  const res = await fetch(`/api/lancamento/detalhes?funcionario_id=${fId}&data=${dataIso}`);
  const dadosExistentes = await res.json();

  document.getElementById("modalSituacao").value = dadosExistentes.situacao || "Presente";
  document.getElementById("modalObs").value = dadosExistentes.observacao || "";
  listaOSAtual = dadosExistentes.apropriacoes || [];

  alternarApropriacaoModal();
  renderizarListaOS();
  
  document.getElementById("modalLancamento").style.display = "block";
}

function fecharModal() {
  document.getElementById("modalLancamento").style.display = "none";
}

function alternarApropriacaoModal() {
  const sit = document.getElementById("modalSituacao").value;
  document.getElementById("modalSecaoApropriacao").style.display = (sit === "Presente" || sit === "Deslocado") ? "block" : "none";
}

function adicionarOSModal() {
  const os = document.getElementById("modalOS").value.trim();
  const h = parseFloat(document.getElementById("modalHoras").value);

  if (!os || !h || h <= 0) return alert("Preencha a OS e as horas corretamente.");

  listaOSAtual.push({ ordem_servico: os, horas: h });
  document.getElementById("modalOS").value = "";
  document.getElementById("modalHoras").value = "";
  renderizarListaOS();
}

function removerOSModal(index) {
  listaOSAtual.splice(index, 1);
  renderizarListaOS();
}

function renderizarListaOS() {
  const ul = document.getElementById("modalListaOS");
  ul.innerHTML = "";
  
  if (listaOSAtual.length === 0) {
    ul.innerHTML = `<li style="color:#888; font-style:italic; padding: 4px;">Nenhuma OS adicionada.</li>`;
    return;
  }

  listaOSAtual.forEach((item, idx) => {
    ul.innerHTML += `
      <li>
        <span><b>OS:</b> ${item.ordem_servico} - <b>${item.horas}h</b></span>
        <button type="button" class="btn-remove-os" onclick="removerOSModal(${idx})">Excluir</button>
      </li>
    `;
  });
}

document.getElementById("formModal").addEventListener("submit", async (e) => {
  e.preventDefault();

  const dados = {
    data: dataSelecionada,
    funcionario_id: funcionarioSelecionadoId,
    situacao: document.getElementById("modalSituacao").value,
    observacao: document.getElementById("modalObs").value,
    apropriacoes: listaOSAtual
  };

  const res = await fetch("/api/lancamento", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });

  if (res.ok) {
    fecharModal();
    carregarGrade();
    carregarDashboard();
  }
});

// 5. FICHA DO FUNCIONÁRIO
async function abrirModalInfoFuncionario(id) {
  const res = await fetch(`/api/funcionarios/${id}/detalhes`);
  const data = await res.json();

  if (!res.ok) {
    alert("Erro ao buscar dados do funcionário.");
    return;
  }

  const f = data.info;
  const hist = data.historico;

  const dataInicioBr = f.inicio_atividades ? f.inicio_atividades.split('-').reverse().join('/') : 'Não informado';

  let html = `
    <div class="info-card">
      <h4>${f.nome}</h4>
      <p><b>Matrícula:</b> ${f.matricula || '-'}</p>
      <p><b>Cargo:</b> ${f.cargo}</p>
      <p><b>Área/Atuação:</b> ${f.atuacao}</p>
      <p><b>Início das Atividades em Área:</b> <span class="highlight-date">${dataInicioBr}</span></p>
      <p><b>Supervisor:</b> ${f.supervisor || '-'}</p>
    </div>

    <h4 style="margin-top: 15px; margin-bottom: 8px;">Histórico Recente de Lançamentos</h4>
    <div style="max-height: 200px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 4px;">
      <table class="grid-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Situação</th>
            <th>Horas</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (hist.length === 0) {
    html += `<tr><td colspan="4" style="padding:10px; color:#64748b;">Nenhum histórico registrado.</td></tr>`;
  } else {
    hist.forEach(h => {
      const dtBr = h.data.split('-').reverse().join('/');
      html += `
        <tr>
          <td>${dtBr}</td>
          <td>${h.situacao}</td>
          <td>${h.horas}h</td>
          <td>${h.observacao || '-'}</td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("infoFuncionarioBody").innerHTML = html;
  document.getElementById("modalInfoFuncionario").style.display = "block";
}

function fecharModalInfoFuncionario() {
  document.getElementById("modalInfoFuncionario").style.display = "none";
}

// 6. CADASTRO E PESQUISA DE FUNCIONÁRIOS
async function carregarListaCadastro() {
  const res = await fetch('/api/funcionarios');
  listaFuncionariosCache = await res.json();
  renderizarTabelaCadastros(listaFuncionariosCache);
}

function renderizarTabelaCadastros(lista) {
  const tbody = document.getElementById('tabelaFuncionariosCadastrados');
  tbody.innerHTML = "";

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 12px; color: #64748b;">Nenhum funcionário encontrado.</td></tr>`;
    return;
  }

  lista.forEach(f => {
    const dataInicioBr = f.inicio_atividades ? f.inicio_atividades.split('-').reverse().join('/') : '-';
    tbody.innerHTML += `
      <tr>
        <td>${f.matricula || '-'}</td>
        <td><a href="#" onclick="abrirModalInfoFuncionario(${f.id}); return false;"><b>${f.nome}</b></a></td>
        <td>${f.cargo}</td>
        <td>${f.atuacao}</td>
        <td>${dataInicioBr}</td>
        <td>${f.supervisor || '-'}</td>
        <td><button class="btn-secondary" onclick="prepararEdicao(${f.id})">Editar</button></td>
      </tr>
    `;
  });
}

function filtrarTabelaCadastros() {
  const termo = document.getElementById("inputPesquisaFuncionario").value.toLowerCase().trim();
  
  if (!termo) {
    renderizarTabelaCadastros(listaFuncionariosCache);
    return;
  }

  const filtrados = listaFuncionariosCache.filter(f => 
    (f.nome && f.nome.toLowerCase().includes(termo)) ||
    (f.matricula && f.matricula.toLowerCase().includes(termo)) ||
    (f.cargo && f.cargo.toLowerCase().includes(termo)) ||
    (f.supervisor && f.supervisor.toLowerCase().includes(termo)) ||
    (f.atuacao && f.atuacao.toLowerCase().includes(termo))
  );

  renderizarTabelaCadastros(filtrados);
}

function prepararEdicao(id) {
  const func = listaFuncionariosCache.find(f => f.id === id);
  if (!func) return;

  document.getElementById("cadId").value = func.id;
  document.getElementById("cadMatricula").value = func.matricula || "";
  document.getElementById("cadNome").value = func.nome;
  document.getElementById("cadCargo").value = func.cargo;
  document.getElementById("cadAtuacao").value = func.atuacao;
  document.getElementById("cadInicioAtividades").value = func.inicio_atividades || "";
  document.getElementById("cadSupervisor").value = func.supervisor || "";

  document.getElementById("tituloFormCadastro").innerText = "Editar Funcionário";
  document.getElementById("btnSalvarCad").innerText = "Atualizar Cadastro";
  document.getElementById("btnCancelarEdit").style.display = "inline-block";

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limparFormularioCadastro() {
  document.getElementById("cadId").value = "";
  document.getElementById("formCadastro").reset();
  document.getElementById("tituloFormCadastro").innerText = "Cadastrar Novo Funcionário";
  document.getElementById("btnSalvarCad").innerText = "Salvar Funcionário";
  document.getElementById("btnCancelarEdit").style.display = "none";
}

document.getElementById("formCadastro").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const id = document.getElementById("cadId").value;
  const dados = {
    id: id ? parseInt(id) : null,
    matricula: document.getElementById("cadMatricula").value,
    nome: document.getElementById("cadNome").value,
    cargo: document.getElementById("cadCargo").value,
    atuacao: document.getElementById("cadAtuacao").value,
    inicio_atividades: document.getElementById("cadInicioAtividades").value,
    supervisor: document.getElementById("cadSupervisor").value
  };

  const metodo = id ? 'PUT' : 'POST';
  const res = await fetch("/api/funcionarios", {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });

  const resultado = await res.json();

  if (res.ok) {
    alert(id ? "Funcionário atualizado!" : "Funcionário cadastrado!");
    limparFormularioCadastro();
    carregarListaCadastro();
    carregarGrade();
  } else {
    alert(resultado.erro || "Erro ao salvar.");
  }
});