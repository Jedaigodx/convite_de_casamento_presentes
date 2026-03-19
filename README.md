# Lista de Presentes · Thatianna & Vinicius 💚

Site de lista de presentes de casamento com painel administrativo, geração de QR Code Pix e catálogo elegante.

---

## Estrutura do Projeto

```
wedding-gifts/
├── app.py                  # Flask app + rotas API
├── requirements.txt
├── Procfile               # Para Railway
├── railway.json
├── .env.example
├── templates/
│   ├── index.html         # Página pública (catálogo)
│   └── admin.html         # Painel dos noivos
└── static/
    ├── css/
    │   ├── main.css
    │   └── admin.css
    └── js/
        ├── main.js
        └── admin.js
```

---

## Deploy no Railway

### 1. Criar conta e projeto
1. Acesse [railway.app](https://railway.app) e crie uma conta
2. Clique em **New Project → Deploy from GitHub repo**
3. Conecte seu GitHub e selecione o repositório

### 2. Adicionar banco de dados PostgreSQL
1. No projeto Railway, clique em **+ New → Database → PostgreSQL**
2. O Railway cria a variável `DATABASE_URL` automaticamente

### 3. Configurar variáveis de ambiente
No painel do Railway, vá em **Variables** e adicione:

| Variável | Valor |
|---|---|
| `SECRET_KEY` | Uma string aleatória longa |
| `PIX_KEY` | Sua chave Pix (e-mail, CPF, telefone ou chave aleatória) |
| `PIX_NAME` | Nome do favorecido (ex: `Thatianna Santos`) |
| `ADMIN_PASSWORD` | Senha para acessar o painel dos noivos |
| `ALLOW_INIT_DB` | `true` (apenas para primeira inicialização) |

### 4. Inicializar o banco de dados
Após o primeiro deploy, acesse:
```
POST https://seusite.railway.app/api/init-db
```
Pode usar o Thunder Client, Insomnia ou `curl`:
```bash
curl -X POST https://seusite.railway.app/api/init-db
```
Isso cria as tabelas e insere alguns itens de exemplo.

**Depois de inicializar, mude `ALLOW_INIT_DB` para `false`.**

### 5. Deploy automático
Qualquer push para o branch principal faz deploy automático.

---

## Páginas

| URL | Descrição |
|---|---|
| `/` | Catálogo público de presentes |
| `/admin` | Painel administrativo dos noivos |

---

## Funcionalidades

### Catálogo Público (`/`)
- Listagem elegante dos presentes com foto, nome e valor
- Filtro por categoria
- Quando todos os itens de um presente são escolhidos, ele some do catálogo
- Fluxo de escolha em 3 etapas:
  1. Escolha do método (casamento ou Pix)
  2. Nome obrigatório + mensagem opcional
  3. Confirmação com QR Code Pix gerado automaticamente

### Pix
- QR Code gerado com payload EMV (padrão Banco Central)
- Valor pré-preenchido igual ao item escolhido
- Chave Pix copiável

### Contribuição Livre
- Item especial sem limite de escolhas
- Pessoa escolhe o valor que desejar
- Mesmo fluxo de confirmação

### Painel Admin (`/admin`)
- Login com senha
- **Visão geral**: estatísticas (total de escolhas, valor Pix esperado, confirmados)
- **Presentes**: adicionar, editar, remover itens; controlar quantidade máxima
- **Escolhas**: ver todos os presentes escolhidos, filtrar por status, confirmar recebimento

---

## Desenvolvimento Local

```bash
# Instalar dependências
pip install -r requirements.txt

# Configurar variáveis
cp .env.example .env
# Edite .env com seus valores

# Iniciar servidor
python app.py
```

Acesse: http://localhost:5000

Para usar PostgreSQL local, instale e crie o banco:
```sql
CREATE DATABASE wedding_gifts;
```

Ou use SQLite para desenvolvimento rápido — substitua `DATABASE_URL` em `app.py`:
```python
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///wedding.db'
```

---

## Personalização

### Alterar cores
Edite as variáveis CSS em `static/css/main.css`:
```css
:root {
  --olive-3: #4f5e2a;   /* cor principal dos botões */
  --cream: #f8f6f0;     /* fundo claro */
}
```

### Alterar nomes dos noivos
Busque por "Thatianna" e "Vinicius" nos arquivos HTML e substitua.

### Chave Pix
Configure via variável de ambiente `PIX_KEY`. Aceita:
- E-mail: `seuemail@gmail.com`
- CPF: `12345678901`
- Telefone: `+5511999999999`
- Chave aleatória: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

---

## Suporte

Para dúvidas sobre Railway: [docs.railway.app](https://docs.railway.app)
