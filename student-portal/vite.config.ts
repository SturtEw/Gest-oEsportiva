import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // The Tailwind plugin is what scans the source tree and emits the utility classes.
  // Without it index.css still loads and the custom properties (:root, @theme) apply,
  // so the page *looks* half-styled: colours resolve but no layout, spacing or
  // sizing utility exists at all. That failure is silent, so keep the plugin here.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Bootstrap 5.3.8 still ships legacy Sass (@import, if(), color red()) that Dart
        // Sass deprecates for removal in 3.0.0. We cannot rewrite a third-party package,
        // so the known upstream deprecations are silenced here. Do NOT add project-wide
        // silences: a deprecation in *our* SCSS should stay visible.
        // 'legacy-js-api' silences the legacy JS render API used by Vite.
        silenceDeprecations: [
          'legacy-js-api',
          'import',
          'global-builtin',
          'color-functions',
          'if-function',
        ],
      },
    },
    devSourcemap: true,
  },
  build: {
    rolldownOptions: {
      output: {
        // Stable vendor chunks (docs/code-splitting-plan.md, step 5): app deploys
        // change the app chunks' hashes, not these, so returning visitors keep them
        // cached. Only packages every screen needs (react) or that load on their own
        // (firebase, idle analytics) are grouped: a group is one chunk, so grouping
        // @base-ui would make the login download every widget of the logged areas.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // Autorizado: strictPort false permite que o Vite caia para a proxima porta
    // livre (5174, 5175...) em vez de recusar subir quando a 5173 esta presa
    // ou em TIME_WAIT. Em conjunto com .vscode/start-vite-debug.ps1, que reserva
    // a porta antes de iniciar, o debugger continua sabendo onde conectar.
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    host: '127.0.0.1',
    // Tolerancia a travamentos: o padrao do HMR e derrubar a conexao websocket
    // apos 5s de inatividade, e o proxy /api usa ws. Timeouts curtos faziam o
    // debug parecer travado mesmo com tudo no ar.
    hmr: {
      timeout: Number(process.env.VITE_HMR_TIMEOUT ?? 60000),
    },
    watch: {
      // Em Windows/containers o watcher nativo pode perder eventos e travar o
      // reload. O polling e preguicoso mas estavel.
      usePolling: process.env.VITE_USE_POLLING === '1',
      interval: Number(process.env.VITE_POLL_INTERVAL ?? 300),
    },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
        // Autorizado: sem timeout curto, o proxyDropava conexoes lenta e o
        // debugger via timeout sem erro claro.
        timeout: Number(process.env.VITE_PROXY_TIMEOUT ?? 30000),
        proxyTimeout: Number(process.env.VITE_PROXY_TIMEOUT ?? 30000),
        // Sem isto, um backend fora do ar derruba o proxy com um erro 500 e o
        // cliente cai no catch genérico ("Nao foi possivel conectar ao
        // servico"), mascarando a causa real. Reescrevendo para /api/health,
        // a UI mostra um estado offline honesto em vez de uma falha falsa.
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
            }
            if ('end' in res) {
              res.end(JSON.stringify({ detail: 'Backend indisponivel' }))
            }
            console.error('[vite proxy] /api -> backend indisponivel:', err.message)
          })
        },
      },
      '/google-identity': {
        target: 'https://accounts.google.com',
        rewrite: () => '/gsi/client',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})

