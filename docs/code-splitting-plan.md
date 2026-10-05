# Plano de code-splitting — student-portal

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
