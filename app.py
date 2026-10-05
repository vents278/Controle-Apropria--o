import os
import calendar
import io
from functools import wraps
from datetime import datetime, date
from flask import Flask, render_template, request, jsonify, send_file, session
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "chave_secreta_super_segura_erp_123")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("As variáveis SUPABASE_URL e SUPABASE_KEY devem estar configuradas no arquivo .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

FERIADOS = [
    "2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07",
    "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"
]

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({"erro": "Acesso não autorizado. Faça login novamente."}), 401
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session or session.get('usuario_nivel') != 'admin':
            return jsonify({"erro": "Acesso negado. Apenas administradores podem executar esta ação."}), 403
        return f(*args, **kwargs)
    return decorated_function

def calcular_regras_horas(data_iso, horas_trabalhadas):
    dt = datetime.strptime(data_iso, "%Y-%m-%d")
    dia_semana = dt.weekday()
    is_feriado = data_iso in FERIADOS

    carga_padrao = 0.0
    horas_50 = 0.0
    horas_70 = 0.0
    horas_100 = 0.0

    if dia_semana == 6 or is_feriado:
        horas_100 = horas_trabalhadas
    elif dia_semana == 5:
        horas_70 = horas_trabalhadas
    elif dia_semana in [0, 1, 2, 3]:
        carga_padrao = 9.0
        if horas_trabalhadas > carga_padrao:
            horas_50 = horas_trabalhadas - carga_padrao
    elif dia_semana == 4:
        carga_padrao = 8.0
        if horas_trabalhadas > carga_padrao:
            horas_50 = horas_trabalhadas - carga_padrao

    return {
        "carga_padrao": carga_padrao,
        "horas_50": horas_50,
        "horas_70": horas_70,
        "horas_100": horas_100,
        "is_feriado": is_feriado,
        "dia_semana": dia_semana
    }

def buscar_dados_pendencias(ano, mes, supervisor_filtro, tipo_filtro, busca_func, data_inicio=None, data_fim=None):
    if data_inicio and data_fim:
        inicio = data_inicio
        fim = data_fim
    else:
        _, num_dias = calendar.monthrange(ano, mes)
        inicio = f"{ano}-{mes:02d}-01"
        fim = f"{ano}-{mes:02d}-{num_dias:02d}"

    query = supabase.table("presencas").select("data, situacao, status_pendencia, funcionarios!inner(id, nome, matricula, supervisor)").gte("data", inicio).lte("data", fim)
    
    if supervisor_filtro:
        query = query.eq("funcionarios.supervisor", supervisor_filtro)

    res_presencas = query.execute().data
    res_apropriacoes = supabase.table("apropriacoes").select("funcionario_id, data, horas").gte("data", inicio).lte("data", fim).execute().data

    horas_map = {}
    for ap in res_apropriacoes:
        chave = f"{ap['funcionario_id']}_{ap['data']}"
        horas_map[chave] = horas_map.get(chave, 0.0) + float(ap["horas"])

    pendencias = []

    for p in res_presencas:
        f = p["funcionarios"]
        f_id = f["id"]
        d_data = p["data"]
        nome = f["nome"]
        matricula = f.get("matricula")
        supervisor = f.get("supervisor")
        situacao = p["situacao"]
        st_pend = p.get("status_pendencia") or "PENDENTE"
        
        if st_pend == "SANADA":
            continue

        if busca_func:
            termo = busca_func.lower()
            if termo not in nome.lower() and (not matricula or termo not in matricula.lower()):
                continue

        horas = horas_map.get(f"{f_id}_{d_data}", 0.0)
        item_pendencia = None

        if situacao == 'Deslocado' and horas == 0:
            item_pendencia = {
                "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                "matricula": matricula or "-", "supervisor": supervisor or "Não informado",
                "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "DESLOCADO",
                "horas_extras": 0, "status_pendencia": st_pend,
                "mensagem": "Funcionário Deslocado sem lançamento de Ordens de Serviço (OS)."
            }
        elif situacao in ['Presente', 'Deslocado']:
            calc = calcular_regras_horas(d_data, horas)
            carga = calc["carga_padrao"]
            
            if calc["horas_100"] > 0:
                motivo = "Trabalho em Domingo" if calc["dia_semana"] == 6 else "Trabalho em Feriado"
                item_pendencia = {
                    "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                    "matricula": matricula or "-", "supervisor": supervisor or "Não informado",
                    "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "100%",
                    "horas_extras": calc["horas_100"], "status_pendencia": st_pend,
                    "mensagem": f"{motivo}: {calc['horas_100']:.1f}h extras (100%)."
                }
            elif calc["horas_70"] > 0:
                item_pendencia = {
                    "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                    "matricula": matricula or "-", "supervisor": supervisor or "Não informado",
                    "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "70%",
                    "horas_extras": calc["horas_70"], "status_pendencia": st_pend,
                    "mensagem": f"Trabalho em Sábado: {calc['horas_70']:.1f}h extras (70%)."
                }
            elif calc["horas_50"] > 0:
                item_pendencia = {
                    "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                    "matricula": matricula or "-", "supervisor": supervisor or "Não informado",
                    "horas_trabalhadas": horas, "carga_padrao": carga, "adicional_tipo": "50%",
                    "horas_extras": calc["horas_50"], "status_pendencia": st_pend,
                    "mensagem": f"Excedeu jornada ({carga:.0f}h): {calc['horas_50']:.1f}h extras (50%)."
                }
            elif carga > 0 and horas < carga:
                item_pendencia = {
                    "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                    "matricula": matricula or "-", "supervisor": supervisor or "Não informado",
                    "horas_trabalhadas": horas, "carga_padrao": carga, "adicional_tipo": "INCOMPLETA",
                    "horas_extras": 0, "status_pendencia": st_pend,
                    "mensagem": f"Jornada incompleta: Apontado {horas:.1f}h de {carga:.0f}h exigidas."
                }

        if item_pendencia:
            if not tipo_filtro or item_pendencia["adicional_tipo"] == tipo_filtro:
                pendencias.append(item_pendencia)

    return pendencias

# --- AUTENTICAÇÃO, SESSÃO E TROCA DE SENHA ---

@app.route('/')
def index():
    if 'usuario_id' not in session:
        return render_template('login.html')
    return render_template('index.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    email = data.get('email', '').strip().lower()
    senha = data.get('senha', '').strip()

    if not email or not senha:
        return jsonify({"erro": "E-mail e senha são obrigatórios."}), 400

    try:
        res = supabase.table('usuarios').select('id, nome, email, nivel, modulos, senha_hash').eq('email', email).execute()
        if not res.data:
            return jsonify({"erro": "Credenciais inválidas."}), 401

        user = res.data[0]
        
        if user.get('senha_hash') and user['senha_hash'] != senha:
            try:
                valid_res = supabase.rpc('verificar_hash', {'senha': senha, 'hash': user['senha_hash']}).execute()
                if not valid_res.data:
                    return jsonify({"erro": "Credenciais inválidas."}), 401
            except Exception:
                return jsonify({"erro": "Credenciais inválidas."}), 401

        session['usuario_id'] = user['id']
        session['usuario_nome'] = user['nome']
        session['usuario_email'] = user['email']
        session['usuario_nivel'] = user['nivel']
        session['usuario_modulos'] = user.get('modulos') or []

        return jsonify({
            "mensagem": "Login realizado com sucesso!",
            "usuario": {
                "id": user['id'],
                "nome": user['nome'],
                "email": user['email'],
                "nivel": user['nivel'],
                "modulos": user.get('modulos') or []
            }
        })
    except Exception:
        return jsonify({"erro": "Erro de conexão com o banco de dados."}), 500

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"mensagem": "Sessão encerrada com sucesso."})

@app.route('/api/usuario_atual', methods=['GET'])
def usuario_atual():
    if 'usuario_id' not in session:
        return jsonify({"logado": False}), 401
    return jsonify({
        "logado": True,
        "usuario": {
            "id": session.get('usuario_id'),
            "nome": session.get('usuario_nome'),
            "email": session.get('usuario_email'),
            "nivel": session.get('usuario_nivel'),
            "modulos": session.get('usuario_modulos', [])
        }
    })

@app.route('/api/alterar_senha', methods=['POST'])
@login_required
def alterar_senha():
    data = request.json or {}
    senha_atual = data.get('senha_atual', '').strip()
    nova_senha = data.get('nova_senha', '').strip()

    if not senha_atual or not nova_senha:
        return jsonify({"erro": "Informe a senha atual e a nova senha."}), 400

    u_id = session.get('usuario_id')
    res = supabase.table('usuarios').select('senha_hash').eq('id', u_id).execute()
    
    if not res.data:
        return jsonify({"erro": "Usuário não encontrado."}), 404

    senha_salva = res.data[0].get('senha_hash')
    if senha_salva != senha_atual:
        return jsonify({"erro": "A senha atual está incorreta."}), 400

    supabase.table('usuarios').update({'senha_hash': nova_senha}).eq('id', u_id).execute()
    return jsonify({"mensagem": "Senha alterada com sucesso!"}), 200

# --- ATENDIMENTOS FIXOS ---

@app.route('/api/atendimentos_fixos', methods=['GET', 'POST'])
@login_required
def gerenciar_atendimentos_fixos():
    if request.method == 'GET':
        aba = request.args.get('aba', 'FACILITIES')
        ano = int(request.args.get('ano', date.today().year))
        mes = int(request.args.get('mes', date.today().month))

        _, num_dias = calendar.monthrange(ano, mes)
        inicio = f"{ano}-{mes:02d}-01"
        fim = f"{ano}-{mes:02d}-{num_dias:02d}"

        try:
            res = supabase.table('atendimentos_fixos')\
                .select('id, data, aba, funcionario_id, observacao, funcionarios(nome, matricula)')\
                .eq('aba', aba).gte('data', inicio).lte('data', fim).order('data').execute()
            
            mapa_atendimentos = {item['data']: item for item in res.data}
        except Exception:
            mapa_atendimentos = {}

        dias = []
        for d in range(1, num_dias + 1):
            d_iso = f"{ano}-{mes:02d}-{d:02d}"
            dt_obj = datetime.strptime(d_iso, "%Y-%m-%d")
            semana = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"][dt_obj.weekday()]
            reg = mapa_atendimentos.get(d_iso, {})

            dias.append({
                "data": d_iso,
                "dia_num": d,
                "dia_semana": semana,
                "funcionario_id": reg.get('funcionario_id'),
                "funcionario_nome": reg.get('funcionarios', {}).get('nome') if reg.get('funcionarios') else None,
                "funcionario_matricula": reg.get('funcionarios', {}).get('matricula') if reg.get('funcionarios') else None,
                "observacao": reg.get('observacao', '')
            })

        return jsonify({"ano": ano, "mes": mes, "aba": aba, "dias": dias})

    elif request.method == 'POST':
        data = request.json or {}
        d_iso = data.get('data')
        aba = data.get('aba')
        f_id = data.get('funcionario_id')
        obs = data.get('observacao', '')

        if not d_iso or not aba:
            return jsonify({"erro": "Data e aba são obrigatórias."}), 400

        try:
            res_existente = supabase.table('atendimentos_fixos').select('id').eq('data', d_iso).eq('aba', aba).execute()
            if res_existente.data:
                supabase.table('atendimentos_fixos').update({
                    'funcionario_id': f_id,
                    'observacao': obs
                }).eq('data', d_iso).eq('aba', aba).execute()
            else:
                supabase.table('atendimentos_fixos').insert({
                    'data': d_iso,
                    'aba': aba,
                    'funcionario_id': f_id,
                    'observacao': obs
                }).execute()
            return jsonify({"mensagem": "Atendimento fixo salvo com sucesso!"}), 200
        except Exception:
            return jsonify({"erro": "Não foi possível salvar o atendimento. Verifique a tabela no banco."}), 500

# --- GESTÃO DE USUÁRIOS (ADMIN) ---

@app.route('/api/usuarios', methods=['GET', 'POST', 'DELETE'])
@admin_required
def gerenciar_usuarios():
    if request.method == 'GET':
        res = supabase.table('usuarios').select('id, nome, email, nivel, modulos, criado_em').order('nome').execute()
        return jsonify(res.data)

    elif request.method == 'POST':
        data = request.json or {}
        nome = data.get('nome', '').strip()
        email = data.get('email', '').strip().lower()
        senha = data.get('senha', '').strip()
        nivel = data.get('nivel', 'comum')
        modulos = data.get('modulos', [])

        if not nome or not email or not senha:
            return jsonify({"erro": "Nome, e-mail e senha são obrigatórios."}), 400

        payload = {
            "nome": nome,
            "email": email,
            "senha_hash": senha,
            "nivel": nivel,
            "modulos": modulos
        }
        supabase.table('usuarios').insert(payload).execute()
        return jsonify({"mensagem": "Usuário criado com sucesso!"}), 201

    elif request.method == 'DELETE':
        user_id = request.args.get('id')
        if not user_id:
            return jsonify({"erro": "ID do usuário é obrigatório."}), 400
        if str(user_id) == str(session.get('usuario_id')):
            return jsonify({"erro": "Você não pode excluir sua própria conta."}), 400

        supabase.table('usuarios').delete().eq('id', user_id).execute()
        return jsonify({"mensagem": "Usuário removido com sucesso!"}), 200

# --- GERENCIAMENTO DE FUNCIONÁRIOS ---

@app.route('/api/funcionarios/buscar', methods=['GET'])
@login_required
def buscar_funcionarios():
    q = request.args.get('q', '').strip()
    query = supabase.table('funcionarios').select('id, matricula, nome, cargo, atuacao')
    if q:
        query = query.or_(f"nome.ilike.%{q}%,matricula.ilike.%{q}%")
    
    res = query.order('nome').limit(15).execute()
    return jsonify(res.data)

@app.route('/api/funcionarios', methods=['GET', 'POST', 'PUT', 'DELETE'])
@login_required
def gerenciar_funcionarios():
    if request.method == 'POST':
        data = request.json
        payload = {
            "matricula": data.get('matricula'),
            "nome": data.get('nome'),
            "cargo": data.get('cargo'),
            "atuacao": data.get('atuacao', 'GERAL'),
            "supervisor": data.get('supervisor'),
            "inicio_atividades": data.get('inicio_atividades') or None
        }
        try:
            supabase.table('funcionarios').insert(payload).execute()
            return jsonify({"mensagem": "Funcionário cadastrado!"}), 201
        except Exception:
            return jsonify({"erro": "Erro ao cadastrar funcionário."}), 400

    elif request.method == 'PUT':
        data = request.json
        f_id = data.get('id')
        payload = {
            "matricula": data.get('matricula'),
            "nome": data.get('nome'),
            "cargo": data.get('cargo'),
            "atuacao": data.get('atuacao'),
            "supervisor": data.get('supervisor'),
            "inicio_atividades": data.get('inicio_atividades') or None
        }
        try:
            supabase.table('funcionarios').update(payload).eq('id', f_id).execute()
            return jsonify({"mensagem": "Funcionário atualizado!"}), 200
        except Exception:
            return jsonify({"erro": "Erro ao atualizar o funcionário."}), 400

    elif request.method == 'DELETE':
        func_id = request.args.get('id')
        if not func_id:
            return jsonify({"erro": "ID do funcionário é obrigatório."}), 400

        supabase.table('funcionarios').delete().eq('id', func_id).execute()
        return jsonify({"mensagem": "Funcionário excluído com sucesso!"}), 200

    else:
        res = supabase.table('funcionarios').select('id, matricula, nome, cargo, atuacao, supervisor, inicio_atividades').order('atuacao').order('nome').execute()
        return jsonify(res.data)

@app.route('/api/funcionarios/<int:func_id>/detalhes', methods=['GET'])
@login_required
def obter_detalhes_funcionario(func_id):
    res_func = supabase.table('funcionarios').select('*').eq('id', func_id).execute()
    if not res_func.data:
        return jsonify({"erro": "Funcionário não encontrado."}), 404

    f_info = res_func.data[0]
    res_presenca = supabase.table('presencas').select('data, situacao, observacao').eq('funcionario_id', func_id).order('data', desc=True).limit(10).execute().data
    res_aprop = supabase.table('apropriacoes').select('data, horas').eq('funcionario_id', func_id).execute().data

    horas_map = {}
    for ap in res_aprop:
        horas_map[ap['data']] = horas_map.get(ap['data'], 0.0) + float(ap['horas'])

    historico = []
    for p in res_presenca:
        historico.append({
            "data": p['data'],
            "situacao": p['situacao'],
            "horas": horas_map.get(p['data'], 0.0),
            "observacao": p.get('observacao', '')
        })

    return jsonify({"info": f_info, "historico": historico})

# --- LANÇAMENTO POR OS ---

@app.route('/api/os/lancamento', methods=['POST'])
@login_required
def salvar_lancamento_os():
    data_req = request.json
    ordem_servico = data_req.get('ordem_servico', '').strip()
    descricao = data_req.get('descricao', '').strip()
    data_reg = data_req.get('data')
    horas = float(data_req.get('horas', 0))
    funcionarios_ids = data_req.get('funcionarios_ids', [])

    if not ordem_servico or not data_reg or horas <= 0 or not funcionarios_ids:
        return jsonify({"erro": "Preencha todos os campos obrigatórios e selecione ao menos um funcionário."}), 400

    obs_texto = f"OS: {ordem_servico} - {descricao}" if descricao else f"OS: {ordem_servico}"

    for f_id in funcionarios_ids:
        res_p = supabase.table('presencas').select('observacao').eq('data', data_reg).eq('funcionario_id', f_id).execute()
        
        if res_p.data:
            obs_atual = res_p.data[0].get('observacao') or ''
            nova_obs = f"{obs_atual} | {obs_texto}" if obs_atual else obs_texto
            supabase.table('presencas').update({
                'situacao': 'Presente',
                'observacao': nova_obs,
                'status_pendencia': 'PENDENTE'
            }).eq('data', data_reg).eq('funcionario_id', f_id).execute()
        else:
            supabase.table('presencas').insert({
                'data': data_reg,
                'funcionario_id': f_id,
                'situacao': 'Presente',
                'observacao': obs_texto,
                'status_pendencia': 'PENDENTE'
            }).execute()

        supabase.table('apropriacoes').insert({
            'data': data_reg,
            'funcionario_id': f_id,
            'ordem_servico': ordem_servico,
            'horas': horas
        }).execute()

    return jsonify({"mensagem": f"OS {ordem_servico} lançada para {len(funcionarios_ids)} funcionário(s)!"}), 200

# --- GRADE MATRICIAL ---

@app.route('/api/grade', methods=['GET'])
@login_required
def obter_grade():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))
    supervisor_filtro = request.args.get('supervisor', '')

    _, num_dias = calendar.monthrange(ano, mes)
    inicio_mes = f"{ano}-{mes:02d}-01"
    fim_mes = f"{ano}-{mes:02d}-{num_dias:02d}"

    q_func = supabase.table('funcionarios').select('id, matricula, nome, cargo, atuacao, supervisor')
    if supervisor_filtro:
        q_func = q_func.eq('supervisor', supervisor_filtro)
    funcionarios = q_func.order('atuacao').order('nome').execute().data

    res_sup = supabase.table('funcionarios').select('supervisor').not_.is_('supervisor', 'null').neq('supervisor', '').execute()
    supervisores = sorted(list({r['supervisor'] for r in res_sup.data if r.get('supervisor')}))

    res_presencas = supabase.table('presencas').select('funcionario_id, data, situacao, observacao, status_pendencia').gte('data', inicio_mes).lte('data', fim_mes).execute().data
    res_apropriacoes = supabase.table('apropriacoes').select('funcionario_id, data, horas').gte('data', inicio_mes).lte('data', fim_mes).execute().data

    horas_map = {}
    for ap in res_apropriacoes:
        chave = f"{ap['funcionario_id']}_{ap['data']}"
        horas_map[chave] = horas_map.get(chave, 0.0) + float(ap['horas'])

    lancamentos = {}
    for p in res_presencas:
        f_id = p['funcionario_id']
        d_data = p['data']
        sit = p['situacao']
        obs = p.get('observacao', '')
        st_pend = p.get('status_pendencia') or 'PENDENTE'
        h_tot = horas_map.get(f"{f_id}_{d_data}", 0.0)

        if f_id not in lancamentos:
            lancamentos[f_id] = {}

        calc = calcular_regras_horas(d_data, h_tot) if sit in ['Presente', 'Deslocado'] else {"carga_padrao": 0, "horas_50": 0, "horas_70": 0, "horas_100": 0}

        lancamentos[f_id][d_data] = {
            "situacao": sit,
            "observacao": obs,
            "status_pendencia": st_pend,
            "horas": h_tot,
            "calc": calc
        }

    return jsonify({
        "num_dias": num_dias,
        "ano": ano,
        "mes": mes,
        "funcionarios": funcionarios,
        "supervisores": supervisores,
        "lancamentos": lancamentos
    })

# --- PENDÊNCIAS E EXPORTAÇÃO EXCEL ---

@app.route('/api/pendencias', methods=['GET'])
@login_required
def obter_pendencias():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))
    supervisor_filtro = request.args.get('supervisor', '')
    tipo_filtro = request.args.get('tipo', '')
    busca_func = request.args.get('funcionario', '')
    data_inicio = request.args.get('data_inicio', '')
    data_fim = request.args.get('data_fim', '')

    res_sup = supabase.table('funcionarios').select('supervisor').not_.is_('supervisor', 'null').neq('supervisor', '').execute()
    supervisores = sorted(list({r['supervisor'] for r in res_sup.data if r.get('supervisor')}))

    pendencias = buscar_dados_pendencias(ano, mes, supervisor_filtro, tipo_filtro, busca_func, data_inicio, data_fim)

    return jsonify({
        "pendencias": pendencias,
        "supervisores": supervisores
    })

@app.route('/api/pendencias/exportar_excel', methods=['GET'])
@login_required
def exportar_pendencias_excel():
    import pandas as pd
    
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))
    supervisor_filtro = request.args.get('supervisor', '')
    tipo_filtro = request.args.get('tipo', '')
    busca_func = request.args.get('funcionario', '')
    data_inicio = request.args.get('data_inicio', '')
    data_fim = request.args.get('data_fim', '')

    pendencias = buscar_dados_pendencias(ano, mes, supervisor_filtro, tipo_filtro, busca_func, data_inicio, data_fim)

    dados_excel = []
    for item in pendencias:
        dt_br = "/".join(item['data'].split("-")[::-1])
        dados_excel.append({
            "Data": dt_br,
            "Matrícula": item.get('matricula', '-'),
            "Funcionário": item['funcionario'],
            "Supervisor": item['supervisor'],
            "Horas Lançadas": item['horas_trabalhadas'],
            "Jornada Exigida": f"{item['carga_padrao']}h" if item['carga_padrao'] > 0 else "Fora da Jornada",
            "Horas Extras": item['horas_extras'],
            "Tipo Pendência": item['adicional_tipo'],
            "Status": "PENDENTE",
            "Ocorrência / Motivo": item['mensagem']
        })

    df = pd.DataFrame(dados_excel)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Pendencias')

    output.seek(0)
    nome_arquivo = f"Relatorio_Pendencias_{data_inicio or ano}_{data_fim or mes}.xlsx"

    return send_file(
        output,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=nome_arquivo
    )

@app.route('/api/pendencias/sanar', methods=['POST'])
@login_required
def sanar_pendencia():
    data_req = request.json
    f_id = data_req.get('funcionario_id')
    data_reg = data_req.get('data')

    supabase.table('presencas').update({'status_pendencia': 'SANADA'}).eq('funcionario_id', f_id).eq('data', data_reg).execute()
    return jsonify({"mensagem": "Pendência sanada e removida com sucesso!"}), 200

# --- DASHBOARD ---

@app.route('/api/dashboard', methods=['GET'])
@login_required
def obter_dashboard():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))

    _, num_dias = calendar.monthrange(ano, mes)
    inicio_mes = f"{ano}-{mes:02d}-01"
    fim_mes = f"{ano}-{mes:02d}-{num_dias:02d}"

    res_treinamento = supabase.table('presencas').select('data, funcionario_id').gte('data', inicio_mes).lte('data', fim_mes).eq('situacao', 'Treinamento').execute().data

    treinamento_por_dia = {}
    func_treinamento_unicos = set()

    for item in res_treinamento:
        d = item['data']
        f_id = item['funcionario_id']
        func_treinamento_unicos.add(f_id)
        treinamento_por_dia[d] = treinamento_por_dia.get(d, set())
        treinamento_por_dia[d].add(f_id)

    treinamentos_diarios = [
        {"data": f"{d.split('-')[2]}/{d.split('-')[1]}", "qtd": len(funcs)}
        for d, funcs in sorted(treinamento_por_dia.items())
    ]

    res_presencas = supabase.table('presencas').select('data, funcionario_id, situacao, status_pendencia').gte('data', inicio_mes).lte('data', fim_mes).execute().data
    res_apropriacoes = supabase.table('apropriacoes').select('funcionario_id, data, horas').gte('data', inicio_mes).lte('data', fim_mes).execute().data

    horas_map = {}
    for ap in res_apropriacoes:
        chave = f"{ap['funcionario_id']}_{ap['data']}"
        horas_map[chave] = horas_map.get(chave, 0.0) + float(ap['horas'])

    func_extra_50, func_extra_70, func_extra_100 = set(), set(), set()
    total_horas_extras = 0.0
    qtd_pendencias = 0

    for p in res_presencas:
        d_data = p['data']
        f_id = p['funcionario_id']
        situacao = p['situacao']
        st_pend = p.get('status_pendencia') or 'PENDENTE'
        horas = horas_map.get(f"{f_id}_{d_data}", 0.0)

        if st_pend != "SANADA":
            if situacao == 'Deslocado' and horas == 0:
                qtd_pendencias += 1
            elif situacao in ['Presente', 'Deslocado']:
                calc = calcular_regras_horas(d_data, horas)
                if calc["horas_100"] > 0 or calc["horas_70"] > 0 or calc["horas_50"] > 0 or (calc["carga_padrao"] > 0 and horas < calc["carga_padrao"]):
                    qtd_pendencias += 1

        if situacao in ['Presente', 'Deslocado']:
            calc = calcular_regras_horas(d_data, horas)
            if calc["horas_50"] > 0:
                func_extra_50.add(f_id)
                total_horas_extras += calc["horas_50"]
            if calc["horas_70"] > 0:
                func_extra_70.add(f_id)
                total_horas_extras += calc["horas_70"]
            if calc["horas_100"] > 0:
                func_extra_100.add(f_id)
                total_horas_extras += calc["horas_100"]

    return jsonify({
        "qtd_pendencias": qtd_pendencias,
        "total_func_treinamento": len(func_treinamento_unicos),
        "treinamentos_diarios": treinamentos_diarios,
        "total_horas_extras": round(total_horas_extras, 1),
        "funcionarios_extras": {
            "extra_50": len(func_extra_50),
            "extra_70": len(func_extra_70),
            "extra_100": len(func_extra_100)
        }
    })

# --- QUADRO DE TAREFAS (EDIÇÃO COMPLETA) ---

@app.route('/api/tarefas', methods=['GET', 'POST', 'PUT', 'DELETE'])
@login_required
def gerenciar_tarefas():
    if request.method == 'GET':
        res = supabase.table('tarefas').select('*').execute()
        return jsonify(res.data)

    elif request.method == 'POST':
        data = request.json
        payload = {
            "titulo": data.get('titulo'),
            "descricao": data.get('descricao'),
            "responsavel": data.get('responsavel'),
            "prioridade": data.get('prioridade'),
            "status": data.get('status', 'A Fazer')
        }
        supabase.table('tarefas').insert(payload).execute()
        return jsonify({"mensagem": "Tarefa criada com sucesso!"}), 201

    elif request.method == 'PUT':
        data = request.json
        t_id = data.get('id')
        
        payload = {}
        if 'titulo' in data: payload['titulo'] = data['titulo']
        if 'descricao' in data: payload['descricao'] = data['descricao']
        if 'responsavel' in data: payload['responsavel'] = data['responsavel']
        if 'prioridade' in data: payload['prioridade'] = data['prioridade']
        if 'status' in data: payload['status'] = data['status']

        supabase.table('tarefas').update(payload).eq('id', t_id).execute()
        return jsonify({"mensagem": "Tarefa atualizada com sucesso!"}), 200

    elif request.method == 'DELETE':
        tarefa_id = request.args.get('id')
        supabase.table('tarefas').delete().eq('id', tarefa_id).execute()
        return jsonify({"mensagem": "Tarefa excluída!"}), 200

# --- DETALHES E SALVAMENTO DIÁRIO ---

@app.route('/api/lancamento/detalhes', methods=['GET'])
@login_required
def obter_detalhes_lancamento():
    f_id = request.args.get('funcionario_id')
    data_reg = request.args.get('data')

    res_presenca = supabase.table('presencas').select('situacao, observacao').eq('funcionario_id', f_id).eq('data', data_reg).execute()
    if not res_presenca.data:
        return jsonify({"situacao": "Presente", "observacao": "", "apropriacoes": []})

    p_data = res_presenca.data[0]
    res_apropriacoes = supabase.table('apropriacoes').select('ordem_servico, horas').eq('funcionario_id', f_id).eq('data', data_reg).execute()

    return jsonify({
        "situacao": p_data.get('situacao', 'Presente'),
        "observacao": p_data.get('observacao', ''),
        "apropriacoes": res_apropriacoes.data
    })

@app.route('/api/lancamento', methods=['POST'])
@login_required
def salvar_lancamento():
    data_req = request.json
    data_reg = data_req.get('data')
    f_id = data_req.get('funcionario_id')
    situacao = data_req.get('situacao')
    obs = data_req.get('observacao', '')
    apropriacoes = data_req.get('apropriacoes', [])

    res_p = supabase.table('presencas').select('id').eq('data', data_reg).eq('funcionario_id', f_id).execute()
    
    if res_p.data:
        supabase.table('presencas').update({
            'situacao': situacao,
            'observacao': obs,
            'status_pendencia': 'PENDENTE'
        }).eq('data', data_reg).eq('funcionario_id', f_id).execute()
    else:
        supabase.table('presencas').insert({
            'data': data_reg,
            'funcionario_id': f_id,
            'situacao': situacao,
            'observacao': obs,
            'status_pendencia': 'PENDENTE'
        }).execute()

    supabase.table('apropriacoes').delete().eq('data', data_reg).eq('funcionario_id', f_id).execute()

    if situacao in ['Presente', 'Deslocado']:
        novas_apropriacoes = [
            {
                'data': data_reg,
                'funcionario_id': f_id,
                'ordem_servico': item['ordem_servico'],
                'horas': float(item['horas'])
            }
            for item in apropriacoes
        ]
        if novas_apropriacoes:
            supabase.table('apropriacoes').insert(novas_apropriacoes).execute()

    return jsonify({"mensagem": "Lançamento salvo com sucesso!"}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)