# Guia Completo — Autenticação Admin + Google OAuth2 + Bootstrap

Português (Brasil) · Stack: **FastAPI (Python 3.11+) + PyMongo Async (Motor) + MongoDB + React 19 + TypeScript + Vite + Bootstrap 5 com SCSS custom**

Este documento cobre o setup end-to-end do portal Gestão Esportiva Escolar: configurar Google OAuth2, preencher as variáveis de ambiente com segredos seguros, gerar o admin raiz, executar localmente, validar todos os fluxos de autenticação e entender as proteções aplicadas.

---

## 0. Pré-requisitos obrigatórios

| Ferramenta | Versão mínima | Como verificar |
|-----------|---------------|----------------|
| Python    | 3.11 ou 3.12  | `python --version` |
| Node.js   | 20 ou superior | `node --version` |
| npm       | 10            | `npm --version` |
| MongoDB   | 6.x local ou **MongoDB Atlas Cluster M0+** | URI de conexão |
| Conta Google | pessoal ou Workspace | Para criar OAuth Client ID no Cloud Console |
| Emergent E-mail Key | (opcional, para envio real) | `X-Email-Key` do painel `integrations.emergentagent.com` |

---

## 1. Google Cloud Console — Criar OAuth 2.0 Web Client ID (GSI One Tap)

Usamos o fluxo **Google Identity Services (GSI) id_token** em vez de Authorization Code + PKCE. A validação do JWT é sempre server-side; o SPA nunca confia apenas no frontend.

### 1.1 Criar projeto
1. Acesse https://console.cloud.google.com/projectcreate
2. Nome: `Gestão Esportiva Escolar` · Organização: sua conta · **Criar**
3. No canto superior, confirme que o projeto selecionado é o correto.

### 1.2 OAuth Consent Screen (tela de permissão)
1. Menu lateral → **APIs & Services** → **OAuth consent screen**
2. **User Type**: `External` (qualquer conta Google) ou `Internal` se você tem Workspace.
3. **Edit App**:
   - **App name**: `Gestão Esportiva Escolar`
   - **User support email**: seu email
   - **App domain** → **Application home page**: a URL de produção ou `http://localhost:5173` em dev
   - **Authorized domains** (domínios autorizados): adicione o domínio do frontend de produção (ex: `emergentagent.com`) e seu domínio de deploy preview se aplicável
   - **Developer contact information**: mesmo email
   - Salve e continue.
4. **Scopes**: **ADD OR REMOVE SCOPES** → não precisa adicionar nenhum escopo extra. Basta `.../auth/userinfo.email` e `openid` que o GSI carrega por padrão. Salve.
5. **Test users** (usuários de teste): enquanto o app estiver em modo "Testing" SOMENTE estes emails poderão logar. Adicione:
   - `carlosew16@gmail.com` (o admin raiz)
   - contas de professores e alunos de teste, se houver.
6. Publique o app quando for para produção (**PUBLISH APP** na tela de Consent Screen) para remover a lista de Test Users e o aviso "App não verificado".

### 1.3 Criar OAuth 2.0 Web Client ID
1. Menu → **APIs & Services** → **Credentials**
2. **+ CREATE CREDENTIALS** → **OAuth client ID**
3. **Application type**: `Web application`
4. **Name**: `GESP Web Portal`
5. **Authorized JavaScript origins** (origens onde o prompt do Google aparece):
   ```
   http://localhost:5173
   http://127.0.0.1:5173
   https://gestaoesportiva-9d8fa.web.app
   https://gestaoesportiva-9d8fa.firebaseapp.com
   ```
   > ⚠️ **Esta lista é obrigatória e é a causa nº 1 do botão do Google não funcionar.**
   > Se a origem atual não estiver aqui, o endpoint `accounts.google.com/gsi/button`
   > responde **403** e o console mostra
   > `[GSI_LOGGER]: The given origin is not allowed for the given client ID.`
   > As mudanças levam alguns minutos para propagar — recarregue com cache limpo depois.
6. **Authorized redirect URIs**: não precisamos preencher nada aqui (não usamos Authorization Code flow).
7. **CREATE**

👉 Copie imediatamente o **Client ID** mostrado no pop-up. Ele tem o formato `991003885757-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`. Você vai colá-lo na variável `GOOGLE_CLIENT_ID` no `backend/.env`.

---

## 2. Dependências Python + Node

```powershell
# Backend (Python)
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # Windows PowerShell
# source .venv/bin/activate         # Linux/macOS
python -m pip install --upgrade pip
pip install -r requirements.txt

# Frontend (Node)
cd ..\student-portal
npm install
```

---

## 3. Configurar `backend/.env` — segredos fortes

Nunca deixe os placeholders `REPLACE_WITH_...` em produção. O startup do FastAPI agora **recusa inicializar** com segredos fracos se `APP_ENV=production`.

Copie o `.env.example` para `.env` e preencha:

```dotenv
# ==============================================================
# BACKEND — GESTÃO ESPORTIVA ESCOLAR
# ==============================================================
APP_ENV=development                    # production / staging / development
FRONTEND_URL=http://localhost:5173    # Usado em links de email (ex: recuperação de senha)
FRONTEND_ORIGINS=http://localhost:5173 # Lista separada por vírgulas. Em produção NÃO use "*"
PORT=8000

# ===== Banco =====
MONGO_URI=mongodb://127.0.0.1:27017/gesp
# MONGO_URI=mongodb+srv://user:senha@cluster0.xxx.mongodb.net/gesp?retryWrites=true&w=majority

# ===== Google OAuth (GSI id_token) =====
GOOGLE_CLIENT_ID=991003885757-855fmfqkh2mo6t73jf0ni1fmg4q1sqpr.apps.googleusercontent.com

# ===== Emergent Resend (envio de emails transacionais) =====
EMERGENT_EMAIL_KEY=<sua-chave-X-Email-Key-do-painel-emergent>
# Endereço "de" (From:); precisa estar autorizado no painel.
EMAIL_FROM_NAME=Gestão Esportiva Escolar
EMAIL_FROM_ADDRESS=noreply@<SEU-DOMINIO-AUTORIZADO>

# ====== Segredos CRIPTOGRÁFICOS =====
# 3 segredos INDEPENDENTES. Gere cada um com o comando Python abaixo.
# NÃO reutilize o mesmo valor em variáveis diferentes.
JWT_SECRET=REPLACE_WITH_UNIQUE_RANDOM_32_BYTES_URLSAFE_>=40_CHARS
CSRF_HMAC_SECRET=REPLACE_WITH_UNIQUE_RANDOM_32_BYTES_URLSAFE_>=40_CHARS
DOCUMENT_HMAC_SECRET=REPLACE_WITH_UNIQUE_RANDOM_32_BYTES_URLSAFE_>=40_CHARS
STATELESS_CSRF=true

# ===== Cookies =====
JWT_COOKIE_NAME=gesp_session
COOKIE_SECURE=false   # true em produção HTTPS (obrigatório se APP_ENV=production)
COOKIE_SAMESITE=Lax
SESSION_TTL_MINUTES=480

# ===== Rate Limit =====
RATE_LIMIT_PER_MIN=60
GOOGLE_RATE_LIMIT_PER_MIN=15
MAX_FAILED_LOGIN=5
LOCKOUT_MINUTES=30

# ===== Admin raiz (ver passo 4) =====
# PREENCHA APENAS DURANTE O BOOTSTRAP INICIAL.
# Após rodar o script UMA VEZ, comente esta linha.
# ROOT_ADMIN_PASSWORD=remova_este_comentario_e_defina_uma_senha_min_12_chars_AQUI
ROOT_ADMIN_EMAIL=carlosew16@gmail.com
ROOT_ADMIN_NAME=Administrador
```

### Como gerar segredos seguros

Abra um terminal Python e rode **três vezes** (um para cada segredo) — cada saída é única:

```python
import secrets
print(secrets.token_urlsafe(48))
```

Cole os três valores em `JWT_SECRET`, `CSRF_HMAC_SECRET` e `DOCUMENT_HMAC_SECRET`. Use valores DIFERENTES.

---

## 4. Bootstrap Admin Raiz (UMA ÚNICA VEZ)

O admin raiz é a única conta de administrador criada de fora do fluxo normal. **Auto-cadastro admin não existe.**

```powershell
cd backend
.\.venv\Scripts\Activate.ps1

# (1) EDITE backend/.env: des-comente e preencha TEMPORARIAMENTE
#     ROOT_ADMIN_PASSWORD=UMA_SENHA_FORTE_COM_12_OU_MAIS_CARACTERES

# (2) Execute o bootstrap uma única vez
python scripts\bootstrap_root_admin.py
```

Saída esperada:
```
Root admin created: id=usr_xxxxx email=carlosew16@gmail.com
DONE.  You can now remove ROOT_ADMIN_PASSWORD from backend/.env
```

👉 **Passo obrigatório pós-bootstrap**: volte no `backend/.env` e comente/remova a linha `ROOT_ADMIN_PASSWORD=...`. O `server.py` exibirá um `WARNING` amarelo no startup enquanto ela existir.

### Dica: já tem a conta Google do admin?
Depois do primeiro login por e-mail+senha, entre no **Painel Admin** → aba **Conta** → botão **Vincular conta Google**. O backend valida que o email da conta Google é o mesmo email do admin (`carlosew16@gmail.com`).

---

## 5. Iniciar os serviços (modo desenvolvimento)

Use dois terminais separados.

### Terminal 1 — Backend (porta 8000)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn server:app --reload --port 8000
```
Verifique no log:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
WARNING:  [SECURITY] ROOT_ADMIN_PASSWORD ainda está definido no .env. Remova após o bootstrap.   # OK se tiver removido não aparece
```

Se houver algum erro de segurança em modo `production` a aplicação aborta com `SystemExit`.

### Terminal 2 — Frontend Vite (porta 5173 — proxy /api → :8000)
```powershell
cd student-portal
npm run dev
```

Abra http://localhost:5173 no navegador.

---

## 6. Cenários de teste (validação manual)

Execute ao menos estes 6 fluxos após subir a pilha:

### ✅ Fluxo 1 — Login admin raiz (email + senha)
1. Abrir http://localhost:5173 → aba **Professor** (admin entra por esta aba; é o papel de maior privilégio).
2. Email: `carlosew16@gmail.com` · Senha: a que você definiu no bootstrap.
3. Resultado esperado: abre **Painel Administrativo** com cards de Professores pendentes / Alunos sem turma / Turmas. O badge "Administração raiz" aparece no header.

### ✅ Fluxo 2 — Vincular Google ao Admin
1. No Painel Admin → aba **Conta**.
2. Clicar **Vincular conta Google**.
3. Escolher a conta `carlosew16@gmail.com` (caso contrário o backend rejeita com "email não corresponde").
4. Resultado: aviso verde "Conta Google vinculada: carlosew16@gmail.com" + persistência no Mongo (campo `google_sub` do documento do usuário).
5. Testar deslogar e entrar pelo botão **Entrar com Google** — também deve abrir o painel admin.

### ✅ Fluxo 3 — Cadastro de professor (pendente → aprovado)
1. Tela de login → aba **Professor** → "Criar conta de professor".
2. Preencha CPF/RG, formação, área, etc. Use um email real de teste.
3. Envie. O status do professor fica **pendente**.
4. Logout e volte como admin. Aba **Professores** → aprove.
5. Login com o professor: agora abre **Área do Professor**.

### ✅ Fluxo 4 — Cadastro de aluno + vincular a uma turma
1. Tela de login → aba **Aluno** → "Criar conta de aluno".
2. Preencha e envie. Conta fica criada, mas sem turma vinculada.
3. Admin → aba **Turmas** → **Nova turma**. Cadastre uma turma (ex: Futsal sub-14 · 2025 · 20 alunos · Professor aprovado já selecionado).
4. Admin → aba **Alunos sem turma** → Vincular turma.
5. Login aluno → abre Área do Aluno com a turma.

### ✅ Fluxo 5 — Esqueci minha senha + reset
1. Tela login → abaixo do botão Entrar, clique **Esqueci minha senha**.
2. Digite um email que existe na base (ex: aluno cadastrado ou professor aprovado).
3. Clique "Enviar link de recuperação".
   - Em ambiente com `EMERGENT_EMAIL_KEY` válido: o email de recuperação chega real.
   - Sem chave: o email é colocado na fila `db.email_queue` e o worker de background tenta enviar (com retry exponencial) — vai falhar e ficar com status `failed` no Mongo.
4. No corpo do email recebido, clique no link: `FRONTEND_URL` + `/reset-senha?token=xxxxxx`.
5. A tela abrirá pedindo Nova senha + confirmação (mínimo 10 caracteres).
6. Após redefinir, volte e logue com a nova senha.

### ✅ Fluxo 6 — Trocar senha logado (rota change-password backend, UI opcional futura)
A API já expõe `POST /api/auth/change-password` com `current_password` e `new_password`. Útil em ajustes futuros na tela de conta.

---

## 7. Segurança aplicada — checklist técnico

Todas as proteções abaixo estão **ativas por padrão** depois das alterações:

### 🔐 Autenticação e sessão
| Item | Detalhe |
|------|---------|
| JWT claims | `sub`, `tipo`, `exp`, `jti` (anti-replay). Cookies `httpOnly`, `Secure` em produção, `SameSite=Lax`. |
| Hash de senha | `passlib` PBKDF2-SHA256 com salt aleatório e 29000 iterações. Argon2 não disponível por compatibilidade. |
| Brute force | Janela deslizante (sliding window) por IP + endpoint. Conta bloqueia por 30 min após 5 falhas. |
| Rate limit no Google Login | Mesma proteção — antes estava sem rate limit específico, agora tem. |

### 🔐 CSRF (Double-Submit Cookie com HMAC assinado)
- Rota state-changing (POST/PATCH/PUT) recebe **cookie `gesp_csrf`** e também **header `X-CSRF-Token`** com o mesmo valor.
- Tokens são assinados com `CSRF_HMAC_SECRET` via HMAC-SHA256 → formato `<raw>.<assinatura>`.
- Validação é **stateless** (não precisa gravar tokens no DB → bom para deploy multi-worker).
- Whitelist de endpoints que NÃO exigem CSRF: `/api/auth/login`, `/google-login`, `/register`, `/forgot-password`, `/reset-password`, `/google-config`, `/me`, `/logout`, `/health` (são pontos de entrada ou a sessão é criada na resposta).
- `student-portal/src/lib/api.ts` lê o cookie automaticamente e envia o header.

### 🔐 CSP + Headers de segurança
- Headers emitidos pelo Firebase Hosting (configurados em `firebase.json`):
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Content-Security-Policy` e `Cross-Origin-Opener-Policy`.
- A CSP permite explicitamente o Google Identity Services. Sem estas entradas o
  navegador bloqueia o script do Google e o botão nunca aparece:

  | Diretiva | Valor necessário |
  |---|---|
  | `script-src` | `https://accounts.google.com` |
  | `style-src` | `https://accounts.google.com` |
  | `frame-src` | `https://accounts.google.com` |
  | `connect-src` | `https://accounts.google.com` |

  Ver [Setup do GSI (Google for Developers)](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
- **COOP**: `same-origin-allow-popups` — necessário para o popup do seletor de conta
  conseguir conversar com a janela principal quando o FedCM não está ativo.
- O domínio `accounts.gstatic.com` **não** é necessário; manter a allow-list mínima.

### 🔐 Privacidade de documentos
- CPF/RG **nunca** são armazenados em claro. Apenas `HMAC-SHA256(normalizado, DOCUMENT_HMAC_SECRET)` + 4 últimos dígitos para exibição administrativa. Índice `unique` garante unicidade.
- Compromisso: em caso de vazamento do banco, os números de documento não são recuperáveis em texto puro.

### 🔐 Fila de email com retry
- Worker asyncio único gerenciado dentro do FastAPI `lifespan` (não precisa de Celery/Redis).
- Tentativas: máximo 5, backoff exponencial `15s * 2^(n-1)` com teto de 300s.
- Emails transacionais sensíveis (recuperação de senha) tentam envio **síncrono primeiro** para o usuário ter feedback instantâneo. Se falhar, caem na fila de retry.

### 🔐 Validações de startup
- `APP_ENV=production` aborta se algum segredo (`JWT/CSRF/DOCUMENT_HMAC`) for fraco ou placeholder.
- `APP_ENV=production` obriga `COOKIE_SECURE=true`.
- Avisa `WARNING` se `ROOT_ADMIN_PASSWORD` ainda estiver no `.env` (lembrar de remover após bootstrap).

---

## 8. Comandos úteis de validação

```powershell
# Build estrito do frontend (TypeScript strict + Rollup/Vite)
cd student-portal
npm run build

# Import check do backend (pega erros de sintaxe / imports cíclicos)
cd backend
.\.venv\Scripts\Activate.ps1
python -c "from server import app; print('OK:', app.title)"
```

---

## 9. Troubleshooting rápido

| Sintoma | Causa provável | Correção |
|---------|----------------|----------|
| Google: "Acesso Google disponível quando configurado pela escola" | `GOOGLE_CLIENT_ID` vazio no backend ou rota `/google-config` falha | Cole o Client ID no backend/.env e reinicie o backend. |
| "Prompt do Google não foi exibido" | Bloqueador de popup; ou o usuário já cancelou a tela recentemente (cooldown Google). | Desbloqueie popups para localhost:5173; ou use o botão gráfico do Google se o One Tap for bloqueado. |
| "O e-mail da conta Google (a@gmail.com) não corresponde ao e-mail desta conta (b@...) | Regra de segurança: email Google precisa bater exatamente com o email da conta do admin. | Vincule a conta Google correta (a que tem o mesmo email do usuário logado). |
| Login admin: "Conta bloqueada temporariamente" | 5 tentativas erradas em 30 minutos. | Espere 30 min ou altere manualmente `failed_login_count` e `locked_until` no documento Mongo. |
| Link de reset não chega | Emergent Email Key faltando, From: não autorizado no painel, ou fila caindo em retry. | Verifique `db.email_queue.find()` no Mongo. Confira `last_error`. |
| CSRF 403 em POST | Cookie CSRF não foi emitido (rota whitelist não passou) ou o frontend não está enviando o header `X-CSRF-Token`. | Assegure-se de que a primeira chamada foi a uma rota de auth whitelist para receber o cookie. `api.ts` já envia automaticamente. |

---

**Fim do guia.** Para dúvidas sobre campos específicos ou regras de negócio, consulte os arquivos `backend/.env.example`, `backend/scripts/bootstrap_root_admin.py` e este documento em `docs/setup-autenticacao-admin-google-bootstrap.md`.
