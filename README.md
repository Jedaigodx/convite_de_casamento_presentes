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


## Suporte

Para dúvidas sobre Railway: [docs.railway.app](https://docs.railway.app)
