import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { app as firebaseApp } from './lib/firebase'

// Garante que o Firebase seja inicializado no boot da aplicação
void firebaseApp
// IMPORT ORDER IS NOT ENOUGH: Tailwind v4 puts utilities in @layer utilities, and
// UNLAYERED css beats any layer in the cascade — no import order fixes that. The real
// fix is $enable-cssgrid: false in styles/bootstrap-theme.scss, which removes
// Bootstrap's unlayered .grid (12 columns) that was squeezing every card to ~90px.
// These imports still control which non-conflicting base styles apply.
import './styles/bootstrap-theme.scss'
import './index.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Elemento #root não encontrado.')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
