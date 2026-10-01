# Domínio próprio para o site e a API (login estável no Safari)

## Por que

Hoje o site roda em `gestaoesportiva-9d8fa.web.app` e a API em
`gestaoesportiva-api.onrender.com`: **sites diferentes**. O cookie de sessão é,
para o navegador, um cookie de terceiros (`SameSite=None`). O Safari (ITP)
bloqueia esse tipo de cookie, então o login "passa" e o usuário cai deslogado
ao recarregar. O Chrome está seguindo o mesmo caminho.

`web.app` e `onrender.com` são sufixos públicos: não dá para criar
`api.gestaoesportiva-9d8fa.web.app`. A saída é um domínio próprio com os dois
lados como subdomínios:

```
https://app.<dominio>  → Firebase Hosting (site)
https://api.<dominio>  → Render (FastAPI)
          └── mesmo site → cookie first-party, SameSite=Lax
```

> O domínio usado nos exemplos, `gestaoesportiva.com.br`, é **placeholder**.
> Ele só existe em `DEFAULT_DOMAIN` de `scripts/custom-domain.mjs`; nenhum
> arquivo de produção o referencia até você rodar o passo 5.

## O que já está pronto no código (sem efeito até a migração)

| Peça | Onde | Estado atual |
|---|---|---|
| Redirecionamento `*.web.app` / `*.firebaseapp.com` → domínio próprio (preserva caminho, ignora canais de preview) | `student-portal/src/lib/canonical-origin.ts` | desligado (`VITE_CANONICAL_ORIGIN` vazio) |
| CSRF segue o modo da sessão (`none` → `none`, `lax` → `strict`) e o token rotacionado vai no header `X-CSRF-Token` | `backend/lib/security.py`, `lib/errors.py` | ativo |
| Script que troca todos os valores de uma vez | `scripts/custom-domain.mjs` | não executado |
| Smoke-test parametrizado | `backend/scripts/smoke_render_config.py` | valida o cenário atual |

## Passo a passo

A ordem importa: os passos 1–4 não afetam produção; a troca de fato é o passo 5.

### 1. Registrar o domínio
Registro.br (para `.com.br`) ou outro registrador. Você vai precisar do painel
de DNS dele nos passos 2 e 3.

### 2. API no Render → `api.<dominio>`
1. Render → serviço `gestaoesportiva-api` → **Settings → Custom Domains → Add**
   → `api.<dominio>`.
2. No DNS do registrador crie o registro que o Render mostrar, normalmente:

   | Tipo | Nome | Valor |
   |---|---|---|
   | CNAME | `api` | `gestaoesportiva-api.onrender.com` |

3. Aguarde **Verified** e o certificado emitido. Teste:
   `curl https://api.<dominio>/api/health` → `{"ok":true,...}`

### 3. Site no Firebase Hosting → `app.<dominio>`
1. Firebase Console → **Hosting → Add custom domain** → `app.<dominio>`.
2. Crie no DNS os registros que o assistente pedir (TXT de verificação e o
   CNAME/A de apontamento).
3. Aguarde o status **Connected** (o SSL pode levar algumas horas).
   Abrir `https://app.<dominio>` deve mostrar o site atual.

### 4. Google OAuth
Google Cloud Console → **APIs & Services → Credentials** → client OAuth (Web) →
**Authorized JavaScript origins** → adicione `https://app.<dominio>`.
Mantenha as origens antigas até concluir a migração.

### 5. Trocar a configuração (um comando)

```powershell
node scripts/custom-domain.mjs apply <dominio> --dry-run   # mostra o que muda
node scripts/custom-domain.mjs apply <dominio>
cd backend; python scripts/smoke_render_config.py; cd ..
```

O script altera:

| Arquivo | Mudança |
|---|---|
| `render.yaml` | `SESSION_SAMESITE=lax`, `FRONTEND_ORIGINS`/`FRONTEND_URL` = `https://app.<dominio>`, `domains: [api.<dominio>]` |
| `firebase.json` e `student-portal/firebase.json` | `connect-src` da CSP → `https://api.<dominio>` e `wss://api.<dominio>` |
| `student-portal/.env.production` | `VITE_API_BASE=https://api.<dominio>`, `VITE_CANONICAL_ORIGIN=https://app.<dominio>` |
| `backend/scripts/smoke_render_config.py` | origem e SameSite esperados |

Depois:
1. **GitHub → Settings → Secrets and variables → Actions → Variables**
   (o CI não lê o `.env.production`, que é ignorado pelo git):
   - `VITE_API_BASE = https://api.<dominio>`
   - `VITE_CANONICAL_ORIGIN = https://app.<dominio>` (sem barra no final)

   O workflow recusa o deploy se `VITE_CANONICAL_ORIGIN` estiver definido e
   `VITE_API_BASE` ainda apontar para `onrender.com`, então troque os dois juntos.
2. **Render criado sem Blueprint?** O `render.yaml` não é aplicado; ajuste no
   painel: `SESSION_SAMESITE=lax`, `FRONTEND_ORIGINS=https://app.<dominio>`,
   `FRONTEND_URL=https://app.<dominio>`.
3. Commit + push (o Render redeploya) e **logo em seguida** publique o front:
   ```powershell
   cd student-portal; npm run build; cd ..
   firebase deploy --only hosting
   ```
   Entre o deploy da API e o do front há uma janela de poucos minutos em que o
   login falha. Faça fora do horário de aula.

### 6. Verificar

```powershell
# Cookie de sessão agora é first-party
curl -si https://api.<dominio>/api/auth/google-config -H "Origin: https://app.<dominio>" | Select-String "set-cookie|access-control"
# Esperado: gesp_csrf ... SameSite=strict; Secure  e  Access-Control-Allow-Origin: https://app.<dominio>

# Origem antiga deixou de ser aceita
curl -si https://api.<dominio>/api/health -H "Origin: https://gestaoesportiva-9d8fa.web.app" | Select-String "access-control-allow-origin"
# Esperado: nenhuma linha
```

No **Safari** (macOS ou iOS):
- `https://gestaoesportiva-9d8fa.web.app/qualquer-caminho` redireciona para
  `https://app.<dominio>/qualquer-caminho`;
- login, recarregar a página → continua logado;
- salvar algo (ex.: preferência de ranking) → sem erro 403.

Links de e-mail (redefinição de senha, confirmação) passam a usar
`FRONTEND_URL`, ou seja, o domínio novo.

### 7. Limpeza (depois de alguns dias estável)
- Remova `https://gestaoesportiva-9d8fa.web.app` e `.firebaseapp.com` das
  origens autorizadas do OAuth.
- Opcional: no Firebase, configure o domínio raiz `<dominio>` para redirecionar
  para `app.<dominio>`.

## Reverter

```powershell
git revert <commit-da-migracao>
git push   # Render volta a SameSite=None + origens web.app
cd student-portal; npm run build; cd ..; firebase deploy --only hosting
```
No GitHub, volte `VITE_API_BASE` para `https://gestaoesportiva-api.onrender.com`
e **apague** `VITE_CANONICAL_ORIGIN` (vazio = sem redirecionamento). Faça isso
antes do push, ou o CI publica o front ainda redirecionando. Os domínios personalizados no
Render/Firebase podem ficar configurados, sem efeito.
