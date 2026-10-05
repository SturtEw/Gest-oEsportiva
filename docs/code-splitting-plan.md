# Plano de code-splitting — student-portal

## Resultado (aplicado em 05/10/2026)

Medido com `npm run size` (`scripts/bundle-size.mjs`, gzip nível 9):

| Artefato | Antes | Depois |
|---|---|---|
| JS inicial (login) | 850 kB / **248 kB gz**, 1 chunk | 276 kB / **85 kB gz** (`react` 66 + `index` 19) |
| CSS inicial | 328 kB / **60 kB gz** | 135 kB / **34 kB gz** (sem Bootstrap) |
| Bootstrap | no CSS inicial | `bootstrap-theme.css` 27 kB gz, só com login/telas de status |
| Área do aluno | no chunk único | `StudentArea` 9 kB + compartilhado `useRealtimeSync` 52 kB gz; cada seção 1–5 kB |
| Área do professor | no chunk único | `TeacherArea` 10 kB gz; Atividades 13 kB e Convites 4 kB sob demanda |
| Admin | no chunk único | `AdminWorkspace` 10 kB gz |
| Firebase Analytics | no boot | `firebase` 13 kB gz, em `requestIdleCallback`, só em produção |

Etapa por etapa:

- **0/7 — Medição e orçamento:** `npm run size` imprime o relatório e falha acima do orçamento (JS inicial 90 kB, CSS inicial 36 kB, chunk lazy 120 kB, tudo gz). Roda no CI depois do build. O CSS ficou em 36, não 25: é a folha única do Tailwind com todas as utilities do app (~32 kB gz), que o plugin do Vite não divide por rota.
- **1 — Lazy por tela:** `src/lib/lazy-screens.ts` (login, convite de professor, redefinir senha, telas de status e as três áreas). `prefetchAreaFor()` começa o chunk da área assim que o papel é conhecido. `useSession` agora guarda uma dica em `localStorage`: o cookie de sessão é HttpOnly e o app sempre achava que não havia sessão, então mostrava o login por um instante (e baixava o chunk dele) antes da área.
- **2 — Firebase adiado:** `src/lib/analytics.ts`. Em dev/test não envia mais page views.
- **3 — Lazy por seção:** `features/student/sections.ts` e `features/teacher/sections.ts`, com `Suspense` dentro do `SectionErrorBoundary` e prefetch no hover/foco/toque do menu (`AppShell` ganhou `onPrefetch`). No admin a única aba separável (`TeacherInvitesPanel`) é a inicial, então não houve ganho em separá-la.
- **4 — Bootstrap só onde é usado:** `src/styles/layers.css` fixa a ordem das camadas e é o primeiro CSS de `main.tsx`. `bootstrap-theme.scss` é importado por `LoginScreen` e por `src/screens/*`. A área logada tem a mesma aparência com o Bootstrap carregado (depois do login) e sem ele (após recarregar), conferido no navegador.
- **5 — Vendor chunks:** `build.rolldownOptions.output.codeSplitting.groups` com `react` e `firebase`. `@base-ui` não foi agrupado: um grupo vira um chunk só, e o login baixaria todos os widgets das áreas.
- **6 — Fontes:** sem mudança. Os `@font-face` somam ~2 kB gz, e o navegador só baixa o arquivo de um peso quando ele é renderizado.
- **Chunks antigos após deploy:** `src/lib/chunk-recovery.ts` recarrega uma vez em `vite:preloadError`. Se falhar de novo em 60 s, a seção mostra "Recarregar" (`SectionErrorBoundary`) e o app inteiro cai no `AppErrorBoundary`, sem dependências de UI.

Pendente: os ícones do `lucide-react` viram chunks minúsculos (0,2–0,5 kB) por causa do tree-shaking por rota. Com HTTP/2 e o preload do Vite eles chegam em paralelo; agrupá-los num chunk só colocaria todos no carregamento inicial.

## Plano original

## Situação atual (build de 03/10/2026)

| Artefato | Tamanho | gzip |
|---|---|---|
| `index-*.js` (único chunk) | 780 kB | 234 kB |
| `index-*.css` | 330 kB | 61 kB |

Por que tudo cai num chunk só:

1. **Áreas importadas estaticamente.** [App.tsx](../student-portal/src/App.tsx) importa `LoginScreen`, `AdminWorkspace`, `TeacherArea` e `StudentArea` no topo. Quem só abre o login baixa as três áreas.
2. **Firebase no boot.** [main.tsx](../student-portal/src/main.tsx) importa `lib/firebase.ts`, que inicializa `firebase/app` + `firebase/analytics` antes do primeiro render. Só serve para analytics.
3. **Todas as seções carregadas juntas.** `StudentArea` importa as 9 seções e `TeacherArea` as 5 (incluindo diálogos), embora só uma apareça por vez.
4. **Bootstrap global.** `styles/bootstrap-theme.scss` (a maior parte dos 330 kB de CSS) é importado em `main.tsx`, mas só o login, a redefinição de senha e as telas de status (`PendingApproval`, `AccountUnavailable`) usam classes Bootstrap.

## Metas

- JS inicial da tela de login: **≤ 90 kB gzip** (hoje 234 kB).
- Cada área (aluno, professor, admin) em chunk próprio, baixado só para o papel da sessão.
- CSS inicial sem Bootstrap nas áreas logadas.
- Nenhuma regressão visual: as camadas `@layer theme, base, bootstrap, components, utilities` continuam valendo.

## Etapas

### 0. Medir antes de mexer
- Rodar `npx -y vite-bundle-visualizer` em `student-portal/` (ou `rollup-plugin-visualizer` com `build.rolldownOptions.plugins`). Salvar o relatório em `docs/bundle/` para comparar.
- Anotar o peso real de `firebase`, `@base-ui/react`, `sonner`, `lucide-react` e do código próprio.

### 1. Lazy por área (maior ganho, baixo risco)
Em `App.tsx`:

```tsx
const AdminWorkspace = lazy(() => import('@/features/admin/AdminWorkspace').then((m) => ({ default: m.AdminWorkspace })))
const TeacherArea = lazy(() => import('@/features/teacher/TeacherArea').then((m) => ({ default: m.TeacherArea })))
const StudentArea = lazy(() => import('@/features/student/StudentArea').then((m) => ({ default: m.StudentArea })))
```

- Um único `<Suspense fallback={<SessionLoading />}>` em volta do conteúdo de `AppContent`. Reaproveitar a tela "Verificando sua sessão…" já existente, extraída para um componente.
- **Prefetch por papel:** depois do login (`onLogin`/`acceptRegistration`) e quando `/api/auth/me` responde, disparar o `import()` da área do papel, sem esperar o render. Assim o chunk já está baixando enquanto o React troca de tela.
- Sair do `SectionErrorBoundary scope="app"`: se um chunk falhar ao carregar (deploy novo com hashes antigos), mostrar "Recarregar" em vez de tela branca. O boundary já faz isso.

### 2. Firebase fora do caminho crítico
- Remover o import de `main.tsx`.
- Carregar analytics depois do primeiro render: `requestIdleCallback(() => import('./lib/firebase'))`, com fallback para `setTimeout`.
- Se analytics não for usado em produção, condicionar a `import.meta.env.VITE_FIREBASE_MEASUREMENT_ID`. Sem ele, o chunk nunca é baixado.

### 3. Lazy por seção
- **StudentArea:** manter `HomeDashboard` estático (é a tela inicial) e tornar lazy `TreinamentosSection`, `QuestionThread`, `AchievementSection`, `AssessmentSection`, `RecordsSection`, `AnnouncementsSection`, `EnrollmentHome`.
- **TeacherArea:** lazy em `TeacherEnrollmentPanel`, `AgendaView`/`UpcomingClasses` e nos dois diálogos (dúvidas e conquista), carregados só quando abertos.
- **AdminWorkspace:** cada aba como componente lazy (hoje está tudo num arquivo de ~390 linhas; separar as abas em arquivos é pré-requisito).
- `Suspense` dentro do `SectionErrorBoundary` de cada área, com o `Skeleton` que a seção já usa.
- Prefetch ao passar o mouse/focar no item do menu (`onPointerEnter`/`onFocus` → `import()`), para a troca de seção continuar instantânea.

### 4. Bootstrap só onde é usado
1. Mover `ResetPasswordScreen`, `PendingApproval` e `AccountUnavailable` de `App.tsx` para `src/screens/` (um arquivo cada).
2. Criar `src/styles/layers.css` com **apenas** `@layer theme, base, bootstrap, components, utilities;` e importá-lo primeiro em `main.tsx`. Essa ordem precisa existir antes de qualquer CSS lazy.
3. Importar `bootstrap-theme.scss` dentro de `LoginScreen.tsx` e das telas de status, não em `main.tsx`. O Vite extrai o CSS de cada chunk lazy e injeta junto com ele.
4. `.portal-card`, `.page-container`, `.type-title` e os tokens `--ge-*` usados fora dessas telas já existem em `index.css`. Conferir com `rg "btn-ge|form-floating-ge|badge-ge|auth-shell|d-flex|text-ge-"` que nenhuma área logada depende do SCSS.
5. **Longo prazo:** migrar essas 4 telas para Tailwind e remover `bootstrap` + `@popperjs/core` + `sass`. Elimina a maior parte dos 330 kB de CSS e a camada `bootstrap`.

### 5. Chunks de vendor estáveis
Em `vite.config.ts`, agrupar dependências que mudam pouco para aproveitar cache entre deploys:

```ts
build: {
  rolldownOptions: {
    output: {
      advancedChunks: {
        groups: [
          { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          { name: 'base-ui', test: /node_modules[\\/]@base-ui[\\/]/ },
          { name: 'firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/ },
        ],
      },
    },
  },
},
```

Conferir o nome exato da opção na versão instalada do Vite 8/rolldown: a mensagem do build cita `build.rolldownOptions.output.codeSplitting`.

### 6. Fontes
- Hoje são 8 arquivos `@fontsource` (DM Sans 400–700, Manrope 500–800). Conferir com `rg "font-(medium|semibold)" --glob "*display*"` se Manrope 500/600 são usados. Se não forem, remover.
- Os `@font-face` já usam `unicode-range`, então só o subset latin é baixado. Não precisa de mudança.

### 7. Orçamento e CI
- Manter `chunkSizeWarningLimit` no padrão (500 kB) como alarme.
- Adicionar `size-limit` (ou um script que leia `dist/assets`) ao CI com limites: entrada ≤ 90 kB gz, cada área ≤ 120 kB gz, CSS inicial ≤ 25 kB gz.

## Ordem sugerida e verificação

| # | Etapa | Ganho esperado | Risco |
|---|---|---|---|
| 1 | Lazy por área + prefetch | alto | baixo |
| 2 | Firebase adiado | médio | baixo |
| 4 | Bootstrap só no login/status | alto (CSS) | médio (ordem de camadas) |
| 3 | Lazy por seção | médio | baixo |
| 5 | Vendor chunks | cache | baixo |
| 6–7 | Fontes, orçamento | pequeno, prevenção | baixo |

Depois de cada etapa:
- `npm run build` e comparar os tamanhos com a tabela inicial.
- `npx vitest run`.
- Conferir no navegador: login → aluno, login → professor, admin → "Visualizar como" (desktop e 390 px). Com a aba Network em "Slow 4G", o fallback de carregamento precisa aparecer sem pular o layout.
- Simular deploy com hash antigo (apagar um chunk de `dist/`) e confirmar que aparece "Recarregar", não tela branca.
