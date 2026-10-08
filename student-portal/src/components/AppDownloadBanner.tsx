/**
 * AppDownloadBanner — convite para instalar o app (APK), só em Android.
 *
 * Regras de exibição:
 * - Detecta Android por navigator.userAgent (Desktop e iOS nunca veem —
 *   iOS não instala APK; a alternativa lá seria PWA/Add to Home Screen).
 * - "X" grava timestamp no localStorage; o banner fica oculto por 7 dias.
 * - O botão usa APP_APK_URL (constante única para trocar o link quando o
 *   .apk for publicado).
 *
 * PWA (futuro): para migrar de APK para PWA, escute `beforeinstallprompt`,
 * guarde o evento num ref/state e faça o botão chamar `event.prompt()`
 * (comentado no handler abaixo). O banner então deveria aparecer também
 * quando o app não está standalone — ver `display-mode` media query.
 */

import { useCallback, useEffect, useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'

/** Link direto do .apk publicado. Troque aqui (ou derive de env no build). */
const APP_APK_URL = '/app/gestao-esportiva.apk'

const DISMISS_KEY = 'app-banner-dismissed-at'
const DISMISS_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Android UA contém "Android"; exclui tablets de fabricantes sem Chrome? Não —
  // todos Android UA incluem "Android". Exclui apenas o modo desktop de devtools
  // (que não é um dispositivo real).
  return /Android/i.test(ua)
}

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const dismissedAt = Number(raw)
    if (!Number.isFinite(dismissedAt)) return false
    return Date.now() - dismissedAt < DISMISS_DAYS * DAY_MS
  } catch {
    return false
  }
}

export function AppDownloadBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isAndroid() && !isDismissed()) setVisible(true)
  }, [])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // localStorage bloqueado (modo privado restrito): só fecha nesta sessão.
    }
    setVisible(false)
  }, [])

  const download = useCallback(() => {
    // TODO(PWA): quando o sistema virar PWA, substituir este handler por:
    //   const deferred = installPromptRef.current   // evento beforeinstallprompt capturado no useEffect:
    //   window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPromptRef.current = e })
    //   ...
    //   if (deferred) { deferred.prompt(); deferred.userChoice.then(...) }
    // e remover o fallback do <a> abaixo.
    const anchor = document.createElement('a')
    anchor.href = APP_APK_URL
    anchor.download = ''
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [])

  if (!visible) return null

  return (
    <div
      role="complementary"
      aria-label="Convite para baixar o aplicativo"
      className="fixed inset-x-0 bottom-0 z-[40] border-t border-border bg-white/95 px-4 py-3 shadow-[0_-6px_20px_rgba(28,55,42,0.08)] backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#234E40] text-white">
          <Smartphone aria-hidden="true" className="size-5" />
        </div>
        <p className="min-w-0 flex-1 text-sm leading-snug text-[#18372F]">
          Baixe nosso App para uma melhor experiência
        </p>
        <button
          type="button"
          onClick={download}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#234E40] px-3 py-2 text-xs font-bold text-white transition active:scale-95"
        >
          <Download aria-hidden="true" className="size-4" />
          Baixar APK
        </button>
        <button
          type="button"
          aria-label="Fechar banner"
          onClick={dismiss}
          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  )
}
