// Layer order first: lazy chunks (Bootstrap with the login) add CSS later, and
// a layer's position is fixed by the first stylesheet that names it.
import './styles/layers.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
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
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
  scheduleAnalytics()
}
