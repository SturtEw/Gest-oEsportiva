// Layer order first: lazy chunks (Bootstrap with the login) add CSS later, and
// a layer's position is fixed by the first stylesheet that names it.
import './styles/layers.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ThemeProvider } from './theme/ThemeProvider'
import { scheduleAnalytics } from './lib/analytics'
import { redirectToCanonicalOrigin } from './lib/canonical-origin'
import { recoverFromStaleChunks } from './lib/chunk-recovery'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Elemento #root não encontrado.')
}

// Em *.web.app / *.firebaseapp.com o cookie de sessão seria cross-site (Safari o
// descarta). Com domínio próprio configurado, manda o visitante para lá antes de
// montar o app. Sem VITE_CANONICAL_ORIGIN é no-op.
if (!redirectToCanonicalOrigin()) {
  recoverFromStaleChunks()
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ThemeProvider>
    </StrictMode>,
  )
  scheduleAnalytics()
}
