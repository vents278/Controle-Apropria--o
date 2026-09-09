from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import date, datetime
import calendar

app = Flask(__name__)
DB_NAME = "database.db"

FERIADOS = [
    "2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07",
    "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"
]

def init_db():
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS funcionarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                matricula TEXT UNIQUE,
                nome TEXT NOT NULL,
                cargo TEXT NOT NULL,
                atuacao TEXT DEFAULT 'GERAL',
                supervisor TEXT
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS presencas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                funcionario_id INTEGER NOT NULL,
                situacao TEXT NOT NULL,
                observacao TEXT,
                status_pendencia TEXT DEFAULT 'PENDENTE',
                FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id),
                UNIQUE(data, funcionario_id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS apropriacoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                funcionario_id INTEGER NOT NULL,
                ordem_servico TEXT NOT NULL,
                horas REAL NOT NULL,
                FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tarefas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                descricao TEXT,
                responsavel TEXT,
                prioridade TEXT DEFAULT 'Média',
                status TEXT DEFAULT 'A Fazer'
            )
        ''')
        conn.commit()

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

@app.route('/')
def index():
    return render_template('index.html')

# --- GERENCIAMENTO E BUSCA DE FUNCIONÁRIOS ---

@app.route('/api/funcionarios/buscar', methods=['GET'])
def buscar_funcionarios():
    q = request.args.get('q', '').strip().lower()
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        if q:
            cursor.execute('''
                SELECT id, matricula, nome, cargo, atuacao 
                FROM funcionarios 
                WHERE LOWER(nome) LIKE ? OR LOWER(matricula) LIKE ? OR LOWER(cargo) LIKE ?
                ORDER BY nome LIMIT 10
            ''', (f"%{q}%", f"%{q}%", f"%{q}%"))
        else:
            cursor.execute('SELECT id, matricula, nome, cargo, atuacao FROM funcionarios ORDER BY nome LIMIT 10')
        rows = cursor.fetchall()
    return jsonify([{"id": r[0], "matricula": r[1], "nome": r[2], "cargo": r[3], "atuacao": r[4]} for r in rows])

@app.route('/api/funcionarios', methods=['GET', 'POST', 'PUT'])
def gerenciar_funcionarios():
    if request.method == 'POST':
        data = request.json
        try:
            with sqlite3.connect(DB_NAME) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO funcionarios (matricula, nome, cargo, atuacao, supervisor) VALUES (?, ?, ?, ?, ?)",
                    (data.get('matricula'), data.get('nome'), data.get('cargo'), data.get('atuacao', 'GERAL'), data.get('supervisor'))
                )
                conn.commit()
            return jsonify({"mensagem": "Funcionário cadastrado!"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"erro": "A matrícula inserida já está cadastrada."}), 400

    elif request.method == 'PUT':
        data = request.json
        try:
            with sqlite3.connect(DB_NAME) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE funcionarios 
                    SET matricula = ?, nome = ?, cargo = ?, atuacao = ?, supervisor = ?
                    WHERE id = ?
                ''', (data.get('matricula'), data.get('nome'), data.get('cargo'), data.get('atuacao'), data.get('supervisor'), data.get('id')))
                conn.commit()
            return jsonify({"mensagem": "Funcionário atualizado!"}), 200
        except sqlite3.IntegrityError:
            return jsonify({"erro": "A matrícula inserida já pertence a outro funcionário."}), 400

    else:
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, matricula, nome, cargo, atuacao, supervisor FROM funcionarios ORDER BY atuacao, nome")
            rows = cursor.fetchall()
        return jsonify([{"id": r[0], "matricula": r[1], "nome": r[2], "cargo": r[3], "atuacao": r[4], "supervisor": r[5]} for r in rows])

# --- LANÇAMENTO POR OS ---

@app.route('/api/os/lancamento', methods=['POST'])
def salvar_lancamento_os():
    data_req = request.json
    ordem_servico = data_req.get('ordem_servico', '').strip()
    descricao = data_req.get('descricao', '').strip()
    data_reg = data_req.get('data')
    horas = float(data_req.get('horas', 0))
    funcionarios_ids = data_req.get('funcionarios_ids', [])

    if not ordem_servico or not data_reg or horas <= 0 or not funcionarios_ids:
        return jsonify({"erro": "Preencha todos os campos obrigatórios e selecione ao menos um funcionário."}), 400

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        for f_id in funcionarios_ids:
            cursor.execute('''
                INSERT INTO presencas (data, funcionario_id, situacao, observacao, status_pendencia)
                VALUES (?, ?, 'Presente', ?, 'PENDENTE')
                ON CONFLICT(data, funcionario_id) DO UPDATE SET
                    situacao = 'Presente',
                    observacao = CASE 
                        WHEN observacao IS NULL OR observacao = '' THEN excluded.observacao
                        ELSE observacao || ' | ' || excluded.observacao
                    END,
                    status_pendencia = 'PENDENTE'
            ''', (data_reg, f_id, f"OS: {ordem_servico} - {descricao}" if descricao else f"OS: {ordem_servico}"))

            cursor.execute('''
                INSERT INTO apropriacoes (data, funcionario_id, ordem_servico, horas)
                VALUES (?, ?, ?, ?)
            ''', (data_reg, f_id, ordem_servico, horas))

        conn.commit()

    return jsonify({"mensagem": f"OS {ordem_servico} lançada para {len(funcionarios_ids)} funcionário(s)!"}), 200

# --- GRADE MATRICIAL ---

@app.route('/api/grade', methods=['GET'])
def obter_grade():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))
    supervisor_filtro = request.args.get('supervisor', '')

    _, num_dias = calendar.monthrange(ano, mes)

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        
        query_func = "SELECT id, matricula, nome, cargo, atuacao, supervisor FROM funcionarios"
        params = []
        if supervisor_filtro:
            query_func += " WHERE supervisor = ?"
            params.append(supervisor_filtro)
        query_func += " ORDER BY atuacao, nome"

        cursor.execute(query_func, params)
        funcionarios = [{"id": r[0], "matricula": r[1], "nome": r[2], "cargo": r[3], "atuacao": r[4], "supervisor": r[5]} for r in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT supervisor FROM funcionarios WHERE supervisor IS NOT NULL AND supervisor != '' ORDER BY supervisor")
        supervisores = [r[0] for r in cursor.fetchall()]

        inicio_mes = f"{ano}-{mes:02d}-01"
        fim_mes = f"{ano}-{mes:02d}-{num_dias:02d}"

        cursor.execute('''
            SELECT p.funcionario_id, p.data, p.situacao, p.observacao, p.status_pendencia, COALESCE(SUM(a.horas), 0)
            FROM presencas p
            LEFT JOIN apropriacoes a ON p.funcionario_id = a.funcionario_id AND p.data = a.data
            WHERE p.data BETWEEN ? AND ?
            GROUP BY p.funcionario_id, p.data
        ''', (inicio_mes, fim_mes))
        
        lancamentos = {}
        for row in cursor.fetchall():
            f_id, d_data, sit, obs, st_pend, h_tot = row
            if f_id not in lancamentos:
                lancamentos[f_id] = {}
            
            calc = calcular_regras_horas(d_data, h_tot) if sit in ['Presente', 'Deslocado'] else {"carga_padrao": 0, "horas_50": 0, "horas_70": 0, "horas_100": 0}

            lancamentos[f_id][d_data] = {
                "situacao": sit,
                "observacao": obs,
                "status_pendencia": st_pend or 'PENDENTE',
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

# --- PENDÊNCIAS E SANAGEM ---

@app.route('/api/pendencias', methods=['GET'])
def obter_pendencias():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))
    supervisor_filtro = request.args.get('supervisor', '')
    tipo_filtro = request.args.get('tipo', '')

    _, num_dias = calendar.monthrange(ano, mes)
    inicio_mes = f"{ano}-{mes:02d}-01"
    fim_mes = f"{ano}-{mes:02d}-{num_dias:02d}"

    pendencias = []

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT DISTINCT supervisor FROM funcionarios WHERE supervisor IS NOT NULL AND supervisor != '' ORDER BY supervisor")
        supervisores = [r[0] for r in cursor.fetchall()]

        query = '''
            SELECT p.data, f.id, f.nome, f.supervisor, p.situacao, p.status_pendencia, COALESCE(SUM(a.horas), 0) as total_horas
            FROM presencas p
            JOIN funcionarios f ON p.funcionario_id = f.id
            LEFT JOIN apropriacoes a ON p.funcionario_id = a.funcionario_id AND p.data = a.data
            WHERE p.data BETWEEN ? AND ?
        '''
        params = [inicio_mes, fim_mes]

        if supervisor_filtro:
            query += " AND f.supervisor = ?"
            params.append(supervisor_filtro)

        query += " GROUP BY p.data, p.funcionario_id"
        cursor.execute(query, params)

        for row in cursor.fetchall():
            d_data, f_id, nome, supervisor, situacao, st_pend, horas = row
            status_atual = st_pend or "PENDENTE"

            if status_atual == "SANADA":
                continue

            item_pendencia = None

            if situacao == 'Deslocado' and horas == 0:
                item_pendencia = {
                    "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                    "supervisor": supervisor or "Não informado",
                    "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "DESLOCADO",
                    "horas_extras": 0, "status_pendencia": status_atual,
                    "mensagem": "Funcionário Deslocado sem lançamento de Ordens de Serviço (OS)."
                }
            elif situacao in ['Presente', 'Deslocado']:
                calc = calcular_regras_horas(d_data, horas)
                carga = calc["carga_padrao"]
                
                if calc["horas_100"] > 0:
                    motivo = "Trabalho em Domingo" if calc["dia_semana"] == 6 else "Trabalho em Feriado"
                    item_pendencia = {
                        "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                        "supervisor": supervisor or "Não informado",
                        "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "100%",
                        "horas_extras": calc["horas_100"], "status_pendencia": status_atual,
                        "mensagem": f"{motivo}: {calc['horas_100']:.1f}h extras (100%)."
                    }
                elif calc["horas_70"] > 0:
                    item_pendencia = {
                        "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                        "supervisor": supervisor or "Não informado",
                        "horas_trabalhadas": horas, "carga_padrao": 0, "adicional_tipo": "70%",
                        "horas_extras": calc["horas_70"], "status_pendencia": status_atual,
                        "mensagem": f"Trabalho em Sábado: {calc['horas_70']:.1f}h extras (70%)."
                    }
                elif calc["horas_50"] > 0:
                    item_pendencia = {
                        "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                        "supervisor": supervisor or "Não informado",
                        "horas_trabalhadas": horas, "carga_padrao": carga, "adicional_tipo": "50%",
                        "horas_extras": calc["horas_50"], "status_pendencia": status_atual,
                        "mensagem": f"Excedeu jornada ({carga:.0f}h): {calc['horas_50']:.1f}h extras (50%)."
                    }
                elif carga > 0 and horas < carga:
                    item_pendencia = {
                        "data": d_data, "funcionario_id": f_id, "funcionario": nome,
                        "supervisor": supervisor or "Não informado",
                        "horas_trabalhadas": horas, "carga_padrao": carga, "adicional_tipo": "INCOMPLETA",
                        "horas_extras": 0, "status_pendencia": status_atual,
                        "mensagem": f"Jornada incompleta: Apontado {horas:.1f}h de {carga:.0f}h exigidas."
                    }

            if item_pendencia:
                if not tipo_filtro or item_pendencia["adicional_tipo"] == tipo_filtro:
                    pendencias.append(item_pendencia)

    return jsonify({
        "pendencias": pendencias,
        "supervisores": supervisores
    })

@app.route('/api/pendencias/sanar', methods=['POST'])
def sanar_pendencia():
    data_req = request.json
    f_id = data_req.get('funcionario_id')
    data_reg = data_req.get('data')

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE presencas 
            SET status_pendencia = 'SANADA' 
            WHERE funcionario_id = ? AND data = ?
        ''', (f_id, data_reg))
        conn.commit()

    return jsonify({"mensagem": "Pendência sanada e removida com sucesso!"}), 200

# --- DASHBOARD & METRICAS ---

@app.route('/api/dashboard', methods=['GET'])
def obter_dashboard():
    ano = int(request.args.get('ano', date.today().year))
    mes = int(request.args.get('mes', date.today().month))

    _, num_dias = calendar.monthrange(ano, mes)
    inicio_mes = f"{ano}-{mes:02d}-01"
    fim_mes = f"{ano}-{mes:02d}-{num_dias:02d}"

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()

        cursor.execute('''
            SELECT data, COUNT(DISTINCT funcionario_id)
            FROM presencas
            WHERE data BETWEEN ? AND ? AND situacao = 'Treinamento'
            GROUP BY data
            ORDER BY data
        ''', (inicio_mes, fim_mes))
        treinamentos_diarios = [{"data": r[0].split('-')[2] + '/' + r[0].split('-')[1], "qtd": r[1]} for r in cursor.fetchall()]

        cursor.execute('''
            SELECT COUNT(DISTINCT funcionario_id)
            FROM presencas
            WHERE data BETWEEN ? AND ? AND situacao = 'Treinamento'
        ''', (inicio_mes, fim_mes))
        total_func_treinamento = cursor.fetchone()[0] or 0

        cursor.execute('''
            SELECT p.data, p.funcionario_id, p.situacao, p.status_pendencia, COALESCE(SUM(a.horas), 0)
            FROM presencas p
            LEFT JOIN apropriacoes a ON p.funcionario_id = a.funcionario_id AND p.data = a.data
            WHERE p.data BETWEEN ? AND ?
            GROUP BY p.data, p.funcionario_id
        ''', (inicio_mes, fim_mes))

        func_extra_50 = set()
        func_extra_70 = set()
        func_extra_100 = set()

        total_horas_extras = 0.0
        qtd_pendencias = 0

        for row in cursor.fetchall():
            d_data, f_id, situacao, st_pend, horas = row
            status_atual = st_pend or "PENDENTE"

            if status_atual != "SANADA":
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
        "total_func_treinamento": total_func_treinamento,
        "treinamentos_diarios": treinamentos_diarios,
        "total_horas_extras": round(total_horas_extras, 1),
        "funcionarios_extras": {
            "extra_50": len(func_extra_50),
            "extra_70": len(func_extra_70),
            "extra_100": len(func_extra_100)
        }
    })

# --- QUADRO DE TAREFAS (TRELLO) ---

@app.route('/api/tarefas', methods=['GET', 'POST', 'PUT', 'DELETE'])
def gerenciar_tarefas():
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        
        if request.method == 'GET':
            cursor.execute("SELECT id, titulo, descricao, responsavel, prioridade, status FROM tarefas")
            rows = cursor.fetchall()
            return jsonify([{"id": r[0], "titulo": r[1], "descricao": r[2], "responsavel": r[3], "prioridade": r[4], "status": r[5]} for r in rows])
            
        elif request.method == 'POST':
            data = request.json
            cursor.execute(
                "INSERT INTO tarefas (titulo, descricao, responsavel, prioridade, status) VALUES (?, ?, ?, ?, 'A Fazer')",
                (data.get('titulo'), data.get('descricao'), data.get('responsavel'), data.get('prioridade'))
            )
            conn.commit()
            return jsonify({"mensagem": "Tarefa criada!"}), 201

        elif request.method == 'PUT':
            data = request.json
            cursor.execute("UPDATE tarefas SET status = ? WHERE id = ?", (data.get('status'), data.get('id')))
            conn.commit()
            return jsonify({"mensagem": "Status atualizado!"}), 200

        elif request.method == 'DELETE':
            tarefa_id = request.args.get('id')
            cursor.execute("DELETE FROM tarefas WHERE id = ?", (tarefa_id,))
            conn.commit()
            return jsonify({"mensagem": "Tarefa excluída!"}), 200

# --- DETALHES E SALVAMENTO ---

@app.route('/api/lancamento/detalhes', methods=['GET'])
def obter_detalhes_lancamento():
    f_id = request.args.get('funcionario_id')
    data_reg = request.args.get('data')

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT situacao, observacao FROM presencas WHERE funcionario_id = ? AND data = ?', (f_id, data_reg))
        presenca = cursor.fetchone()

        if not presenca:
            return jsonify({"situacao": "Presente", "observacao": "", "apropriacoes": []})

        cursor.execute('SELECT ordem_servico, horas FROM apropriacoes WHERE funcionario_id = ? AND data = ?', (f_id, data_reg))
        apropriacoes = [{"ordem_servico": r[0], "horas": r[1]} for r in cursor.fetchall()]

    return jsonify({"situacao": presenca[0], "observacao": presenca[1] or "", "apropriacoes": apropriacoes})

@app.route('/api/lancamento', methods=['POST'])
def salvar_lancamento():
    data_req = request.json
    data_reg = data_req.get('data')
    f_id = data_req.get('funcionario_id')
    situacao = data_req.get('situacao')
    obs = data_req.get('observacao', '')
    apropriacoes = data_req.get('apropriacoes', [])

    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO presencas (data, funcionario_id, situacao, observacao, status_pendencia)
            VALUES (?, ?, ?, ?, 'PENDENTE')
            ON CONFLICT(data, funcionario_id) DO UPDATE SET
                situacao=excluded.situacao,
                observacao=excluded.observacao,
                status_pendencia='PENDENTE'
        ''', (data_reg, f_id, situacao, obs))

        cursor.execute("DELETE FROM apropriacoes WHERE data = ? AND funcionario_id = ?", (data_reg, f_id))
        if situacao in ['Presente', 'Deslocado']:
            for item in apropriacoes:
                cursor.execute('INSERT INTO apropriacoes (data, funcionario_id, ordem_servico, horas) VALUES (?, ?, ?, ?)', (data_reg, f_id, item['ordem_servico'], float(item['horas'])))

        conn.commit()

    return jsonify({"mensagem": "Lançamento salvo com sucesso!"}), 200

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)