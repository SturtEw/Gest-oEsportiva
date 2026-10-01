// Firebase JS SDK — configuração do projeto GestãoEsportiva
import { initializeApp } from 'firebase/app'
import { getAnalytics } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: 'AIzaSyD-0sIKbtGuGvuvz2ewnFf-gEccnwR09Xw',
  authDomain: 'gestaoesportiva-9d8fa.firebaseapp.com',
  projectId: 'gestaoesportiva-9d8fa',
  storageBucket: 'gestaoesportiva-9d8fa.firebasestorage.app',
  messagingSenderId: '436589559842',
  appId: '1:436589559842:web:84d4197e354ae2dd1d8a7b',
  measurementId: 'G-ECME00LRH3',
}

// Initialize Firebase
// ⚠️ SEGURANÇA: a apiKey abaixo é pública por design — as regras reais de
// proteção dos dados estão em ../firestore.rules e ../storage.rules.
// Veja FIREBASE_RULES.md na raiz do projeto para saber como aplicá-las.
export const app = initializeApp(firebaseConfig)

// Analytics só existe em ambiente de navegador (não roda em testes/SSR)
export const analytics =
  typeof window !== 'undefined' ? getAnalytics(app) : null
