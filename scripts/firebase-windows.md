# Deploy do Firebase Hosting no Windows

Scripts: `scripts/firebase-windows.ps1` (lógica) e `scripts/firebase-windows.cmd` (wrapper).
Escopo: somente o **Firebase Hosting** do `student-portal`. O backend FastAPI **não** é
publicado por este fluxo.

## 1. Pré-requisitos do administrador da máquina

- Node.js **20.19+** ou **22.12+** no PATH (o Vite 8 não roda em versões anteriores).
- Firebase CLI instalada globalmente: `npm install -g firebase-tools` (o script exige
  `firebase.cmd` no PATH; ele não instala nada sozinho).
- Conta de serviço do Firebase com permissão de publicação no Hosting, e o token
  correspondente emitido por um processo confiável.

## 2. Variáveis de ambiente (nunca digite o token no console)

O token **não** deve ser digitado no Prompt de Comando ou no PowerShell: ali ele fica no
histórico da sessão e no log do console. Injete-o a partir de um processo pai confiável
(gerenciador de segredos, cofre corporativo ou rotina de automação), de forma temporária e
por processo:

```
FIREBASE_PROJECT_ID   id do projeto (ex.: gestao-esportiva-escolar)
VITE_API_BASE         URL https do backend FastAPI já publicado (entrada do build)
FIREBASE_TOKEN        token emitido por `firebase login:ci` (somente para Deploy)
FIREBASE_AUDIT_LOG    caminho ABSOLUTO fora do repositório (opcional; JSON por linha)
```

Se `FIREBASE_TOKEN` estiver vazio, o script falha com mensagem explícita e não executa
nada. Se `GOOGLE_APPLICATION_CREDENTIALS` apontar para um arquivo, o script recusa o
deploy: credencial em disco não faz parte deste modelo.

## 3. O que cada peça garante (e o que não garante)

- O script **não** grava o token em disco, **não** o passa como argumento e **não** o
  imprime. O token vive apenas no ambiente do processo filho.
- A Execution Policy é contornada **somente no processo filho** (`-ExecutionPolicy Bypass`):
  nenhuma política global, de usuário ou do registro é alterada, e não há elevação.
- Falhas nativas não são silenciosas: cada etapa confere o código de saída e aborta o fluxo.
- O log de auditoria recebe apenas metadados (etapa, status, código de saída).

Limite honesto: o script não consegue garantir que a própria Firebase CLI não gere
`firebase-debug.log` em falhas nem que o sistema não grave memória do processo. Por isso
nenhum comando com credencial ativa roda com `--debug`, e o wrapper rejeita ações
desconhecidas antes de invocar o PowerShell.

## 4. Uso

```
scripts\firebase-windows.cmd Check      # só pré-requisitos e projeto
scripts\firebase-windows.cmd Build       # npm ci + testes + build (sem credencial)
scripts\firebase-windows.cmd Deploy      # build + firebase deploy --only hosting
scripts\firebase-windows.cmd Emulators   # emulador local de hosting, projeto demo
```

Idempotência: `Build` e `Deploy` repetem o mesmo resultado (instalação determinística via
`npm ci`, testes, build e deploy). `Emulators` usa o projeto `demo-sports-local` e remove
`FIREBASE_TOKEN` do ambiente para que o emulador nunca toque em dados de produção.

## 5. Idempotência e CI

O mesmo caminho é coberto por `.github/workflows/firebase-hosting.yml`, que usa Workload
Identity Federation (sem token de longa duração). Prefira o CI para deploys recorrentes e
use este fluxo local para verificação e diagnose.
