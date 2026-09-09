# ERP - Gestão de Horas, Apropriação & Presença

Sistema Web de gestão operacional e controle de frequência desenvolvido em **Python (Flask)**, **SQLite** e **JavaScript vanilla**. O projeto centraliza o acompanhamento de apontamentos diários, lançamento de Ordens de Serviço (OS), cálculo automático de horas extras e inconsistências de jornada, além do gerenciamento de tarefas em estilo Kanban.

---

## 🛠️ Tecnologias Utilizadas

* **Backend:** Python 3, Flask
* **Banco de Dados:** SQLite3
* **Frontend:** HTML5, CSS3, JavaScript (ES6)

---

## 📂 Estrutura do Projeto

```text
.
├── app.py              # Servidor Flask, rotas da API e regras de negócio/horas
├── database.db         # Banco de dados SQLite (gerado automaticamente no primeiro start)
├── templates/
│   └── index.html      # Interface principal e modais
└── static/
    ├── style.css       # Estilização completa e layouts dinâmicos
    └── script.js       # Regras do frontend, requisições Fetch e controle de modais

🚀 Principais Funcionalidades
Dashboard Analytics

Indicadores de pendências ativas, total acumulado de horas extras e número de colaboradores em treinamento no mês.

Visualização da distribuição de funcionários por faixa de hora extra (50%, 70% e 100%).

Tabela comparativa do volume diário de treinamentos.

Lançamento de Ordem de Serviço (OS)

Registro individual ou em lote para múltiplos colaboradores.

Busca e seleção via autocompletar.

Atualização automática da situação de presença dos funcionários associados.

Matriz Diária de Presença e Apropriação (Grade Matricial)

Visualização mensal por colaborador x dia.

Classificação por cores para facilidade de leitura (Presente, Deslocado, Falta, Folga, Treinamento, Pendente, Com Extra).

Filtros dinâmicos por nome/matrícula, área/atuação, situação e supervisor.

Gestão de Pendências e Sanagem

Detecção automática de inconsistências:

Hora Extra 50%: Excesso de jornada em dias úteis (acima de 9h de seg a qui / 8h na sex).

Hora Extra 70%: Horas trabalhadas aos sábados.

Hora Extra 100%: Horas trabalhadas aos domingos e feriados nacionais.

Deslocado Sem OS: Situação "Deslocado" sem horas/OS atribuídas.

Jornada Incompleta: Apontamento abaixo da carga diária exigida.

Ação de sanar e regularizar pendências diretamente na tabela.

Quadro de Tarefas (Kanban)

Gerenciamento visual com colunas A Fazer, Em Andamento e Concluído.

Suporte a Drag and Drop (arrastar e soltar) para mudança de status.

Classificação por prioridade (Baixa, Média, Alta).

Gestão de Cadastros e Ficha de Colaborador

Cadastro e edição completa de colaboradores (Matrícula, Nome, Cargo, Atuação, Início de Atividades e Supervisor).

Modal com a Ficha Individual do Colaborador contendo o histórico recente de lançamentos.
