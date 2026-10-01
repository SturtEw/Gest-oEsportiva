# Deploy do backend no Render

O frontend já está no ar em `https://gestaoesportiva-9d8fa.web.app`, mas é só
estático: toda chamada a `/api/*` volta HTML e o app mostra
*"Serviço indisponível"*. Este guia publica a API FastAPI no Render e conecta as
duas pontas.

---

## Visão geral do fluxo

```
Navegador
   │
   ├─► https://gestaoesportiva-9d8fa.web.app   (Firebase Hosting — estático)
   │
   └─► https://gestaoesportiva-api.onrender.com (Render — FastAPI)
            │
            └─► MongoDB Atlas (mongodb+srv://…)
```

Como front e API ficam em **origens diferentes**, três detalhes são obrigatórios
e já estão tratados no código:

| Detalhe | Por quê | Onde |
|---|---|---|
| `SESSION_SAMESITE=none` | Cookie de sessão cross-origin só é enviado com `SameSite=None; Secure` | `backend/lib/security.py` |
| `FRONTEND_ORIGINS` | CORS e o WebSocket recusam origem não listada | `backend/server.py`, `lib/realtime.py` |
| CSRF via corpo da resposta | O JS do `web.app` não lê cookies do domínio do Render | `routers/auth.py` (`/google-config`) |
| `connect-src` na CSP | O navegador bloqueia `fetch` e `wss` para host fora da CSP | `student-portal/firebase.json` |

> ⚠️ O `VITE_API_BASE` aparece em **dois** lugares e os dois precisam bater: a
> variável de repositório `VITE_API_BASE` no GitHub (`vars.`, usada pelo CI) e o
> `student-portal/.env.production` (usado no deploy manual). O mesmo host também
> deve constar no `connect-src` da CSP e, invertido, a origem do front deve
> constar em `FRONTEND_ORIGINS`. Divergência entre as duas pontas é a causa mais
> comum do erro *"Serviço indisponível"*.

---

## 1. MongoDB Atlas (banco)

1. Crie um cluster **M0 (gratuito)** em https://cloud.mongodb.com
2. **Database Access** → *Add New Database User*
   - Usuário e senha fortes (evite `@`, `/`, `:` na senha — quebram a URI)
3. **Network Access** → *Add IP Address* → **Allow access from anywhere**
   `0.0.0.0/0`
   > Necessário porque o Render usa IPs de saída dinâmicos no plano free.
   > Para produção séria, use o *Static Outbound IP* do Render e restrinja a lista.
4. **Connect** → *Drivers* → copie a URI:
   ```
   mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

> **Realtime:** o backend usa change streams, que exigem replica set. Todo cluster
> Atlas já é replica set, então funciona — diferente do Mongo standalone local,
> que cai para o fallback single-process.

## 2. Segredos

Gere três valores únicos (substitua no painel do Render, **nunca** comite):

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Rode três vezes → `JWT_SECRET`, `CSRF_HMAC_SECRET`, `DOCUMENT_HMAC_SECRET`.

> `server.py` aborta o boot em produção se qualquer um estiver ausente, curto
> (<16 bytes) ou com valor placeholder.

> ⚠️ **Nunca coloque um `.env` no contexto de build.** O `backend/.env` é
> ignorado via `backend/.dockerignore` e apagado por uma camada `RUN rm` no
> Dockerfile (defesa em profundidade). Antes desse ajuste, o `COPY . .` embutia
> o `.env` — com `JWT_SECRET` e a URI do Mongo — dentro da imagem, e os segredos
> de desenvolvimento vazavam para o registry. Se você adicionar arquivos de
> credencial novos, liste-os no `.dockerignore`.

## 3. Criar o serviço no Render

1. https://dashboard.render.com → **New** → **Blueprint**
2. Conecte o repositório do projeto
3. O Render lê o `render.yaml` da raiz e cria o serviço `gestaoesportiva-api`
4. Preencha as variáveis marcadas `sync: false`:

   | Variável | Valor |
   |---|---|
   | `MONGO_URL` | URI do Atlas (passo 1) |
   | `JWT_SECRET` | segredo gerado (passo 2) |
   | `CSRF_HMAC_SECRET` | segredo gerado (passo 2) |
   | `DOCUMENT_HMAC_SECRET` | segredo gerado (passo 2) |
   | `GOOGLE_CLIENT_ID` | `991003885757-855fmfqkh2mo6t73jf0ni1fmg4q1sqpr.apps.googleusercontent.com` |
   | `EMERGENT_EMAIL_KEY` | opcional — sem ela os e-mails ficam na fila |

5. **Create** e aguarde o build (primeiro leva ~5 min)

### Se preferir criar manualmente (sem Blueprint)

- **Language**: `Docker`
- **Dockerfile Path**: `backend/Dockerfile`
- **Docker Context**: `backend`
- **Health Check Path**: `/api/health`
- **Region**: a mais próxima dos usuários (`Ohio`/`Oregon` nos EUA; não há região BR no Render)

## 4. Bootstrap do admin raiz (uma única vez)

O login por e-mail/senha e o primeiro administrador precisam de um usuário raiz.
Com o serviço no ar, use o **Shell** do Render (aba *Shell*):

```bash
ROOT_ADMIN_EMAIL=seu@email.com \
ROOT_ADMIN_NAME="Administrador raiz" \
ROOT_ADMIN_PASSWORD='SenhaForte!2026' \
python scripts/bootstrap_root_admin.py
```

Depois **remova `ROOT_ADMIN_PASSWORD`** do ambiente do Render — o boot emite
justamente esse aviso de segurança.

> Cadastro de professor agora é **só por convite**: o admin raiz cria a conta pelo
> painel (`/api/admin/teacher-applications` para aprovar, e o provisionamento via
> usuários). O formulário público aceita apenas `tipo: "aluno"`.

## 5. Conectar o frontend

1. Copie a URL do serviço (ex.: `https://gestaoesportiva-api.onrender.com`)
2. Edite `student-portal/.env.production` (deploy manual) **e** a variável de
   repositório `VITE_API_BASE` em *GitHub → Settings → Secrets and variables →
   Actions → Variables* (deploy pelo CI):
   ```
   VITE_API_BASE=https://gestaoesportiva-api.onrender.com
   ```
3. Confirme que o host escolhido está no `connect-src` da CSP em
   `student-portal/firebase.json` (`https://` **e** `wss://`). Sem isso o app sobe,
   o login falha e o console mostra *Refused to connect because it violates the
   Content Security Policy*.
4. Rebuild e deploy (o CI faz isso no push para a `main`):
   ```powershell
   cd student-portal
   npm run build
   cd ..
   firebase deploy --only hosting
   ```

4. Confirme no Google Cloud Console (https://console.cloud.google.com/apis/credentials)
   que a credencial OAuth lista como **Authorized JavaScript origins**:
   ```
   https://gestaoesportiva-9d8fa.web.app
   https://gestaoesportiva-9d8fa.firebaseapp.com
   ```

## 6. Verificação

```powershell
# A API responde?
curl https://gestaoesportiva-api.onrender.com/api/health

# O login por e-mail devolve a mensagem esperada (não HTML)?
curl -i -X POST https://gestaoesportiva-api.onrender.com/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"login":"naoexiste@teste.com","senha":"senhaerrada123"}'
# Esperado: 401 {"detail":"E-mail ou senha inválidos"}
```

No navegador, em `https://gestaoesportiva-9d8fa.web.app`:
- A faixa *"Serviço indisponível"* deve desaparecer
- Login por e-mail deve funcionar e manter a sessão após o refresh
- O botão do Google deve completar o fluxo (sem 403)

### Smoke-test local da configuração

Antes de subir, valide que o app boota em modo produção com estes ajustes:

```powershell
cd backend
python scripts/smoke_render_config.py
# Esperado: 10/10 verificacoes passaram
```

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Deploy sobe e morre | `PORT` fixo no comando — já corrigido em `Dockerfile` (`${PORT:-8000}`) |
| `[FATAL] Produção: configure JWT_SECRET…` | Segredo ausente/curto/placeholder no painel |
| `[FATAL] Produção: FRONTEND_ORIGINS deve listar origens explícitas` | Variável vazia ou com `*` |
| Login "passa" mas o usuário desloga ao recarregar | `SESSION_SAMESITE` não é `none` |
| 403 do Google no login | Origem não autorizada na credencial OAuth |
| *Refused to connect … violates the Content Security Policy* | Host da API ausente no `connect-src` da CSP (`firebase.json`) |
| WebSocket `/api/realtime` falha | Origem fora de `FRONTEND_ORIGINS` |
| App "dorme" e a 1ª request demora ~50s | Plano free do Render hiberna; use `starter` ou superior |
| Aviso `ROOT_ADMIN_PASSWORD ainda está no ambiente` | Só aparece se a variável estiver realmente definida no painel — remova após o bootstrap |

---

## Verificação executada (container local)

Antes de subir, a imagem foi buildada e rodada exatamente como o Render a executa
(`PORT` injetado, `APP_ENV=production`, Mongo replica set em rede Docker):

| Teste | Resultado |
|---|---|
| `docker build` | OK, sem warnings |
| Boot com `PORT=10000` | OK — container `Up` |
| `GET /api/health` | **200** |
| Preflight CORS (origem Firebase) | **200**, `Allow-Origin` + `Allow-Credentials: true` |
| Preflight CORS (origem estranha) | **400** — recusada |
| `GET /api/auth/google-config` | **200** com `csrf_token` no corpo + cookie |
| `POST /api/auth/login` inválido | **401 JSON**, não HTML |
| Headers de segurança | HSTS, nosniff, DENY, `no-store` presentes |
| Change Stream do Mongo | ativo (realtime funcional) |
| `/app/.env` na imagem | **ausente** (corrigido) |

