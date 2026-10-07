/**
 * Manual crop dialog for the avatar upload: shows the chosen photo with zoom
 * and position controls before saving. "Auto" (used by the quick path) is the
 * same renderer with default adjustment.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Crop, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { estimatedBytes, prepareAvatarImage, type ManualAdjustment } from './imageResize'

interface Props {
  open: boolean
  file: File | null
  busy: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (dataUrl: string) => void
  onAuto: () => void
}

export function AvatarCropDialog({ open, file, busy, error, onOpenChange, onConfirm, onAuto }: Props) {
  const [adjustment, setAdjustment] = useState<ManualAdjustment>({ zoom: 1, offsetX: 0, offsetY: 0 })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sizeLabel, setSizeLabel] = useState('')
  const previewTimer = useRef<number | null>(null)

  // Debounced preview: re-render the square as the user drags/zooms.
  const schedulePreview = useCallback((current: ManualAdjustment) => {
    if (!file) return
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      void prepareAvatarImage(file, current).then((result) => {
        setPreviewUrl(result.dataUrl)
        setSizeLabel(`~${Math.round(estimatedBytes(result.dataUrl) / 1024)} KB`)
      })
    }, 120)
  }, [file])

  useEffect(() => {
    if (open && file) {
      setAdjustment({ zoom: 1, offsetX: 0, offsetY: 0 })
      schedulePreview({ zoom: 1, offsetX: 0, offsetY: 0 })
    }
    if (!open) setPreviewUrl(null)
  }, [open, file, schedulePreview])

  const pan = (dx: number, dy: number) => {
    setAdjustment((current) => {
      const next: ManualAdjustment = {
        zoom: current.zoom,
        offsetX: Math.max(-0.5, Math.min(0.5, current.offsetX + dx)),
        offsetY: Math.max(-0.5, Math.min(0.5, current.offsetY + dy)),
      }
      schedulePreview(next)
      return next
    })
  }

  const zoomBy = (factor: number) => {
    setAdjustment((current) => {
      const next: ManualAdjustment = { ...current, zoom: Math.max(1, Math.min(4, current.zoom * factor)) }
      schedulePreview(next)
      return next
    })
  }

  const confirm = async () => {
    if (!file || busy) return
    const result = await prepareAvatarImage(file, adjustment)
    onConfirm(result.dataUrl)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onOpenChange(false) }}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Crop className="size-5" /> Ajustar foto</DialogTitle>
          <DialogDescription>Posicione e dê zoom na foto. Ela vira um quadrado de 256px, bem leve.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <div className="size-56 overflow-hidden rounded-2xl border border-border bg-muted">
            {previewUrl ? <img src={previewUrl} alt="Pré-visualização do recorte" className="size-full object-cover" /> : <div className="size-full animate-pulse bg-muted" />}
          </div>
          <p className="text-xs text-muted-foreground">{sizeLabel}</p>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zoom</p>
            <div className="mt-1 flex items-center gap-2">
              <Button type="button" variant="outline" size="icon-sm" aria-label="Reduzir zoom" onClick={() => zoomBy(0.85)}><ZoomOut className="size-4" /></Button>
              <input type="range" min={1} max={4} step={0.05} value={adjustment.zoom} aria-label="Nível de zoom"
                onChange={(event) => { const next = { ...adjustment, zoom: Number(event.target.value) }; setAdjustment(next); schedulePreview(next) }}
                className="flex-1" />
              <Button type="button" variant="outline" size="icon-sm" aria-label="Aumentar zoom" onClick={() => zoomBy(1.18)}><ZoomIn className="size-4" /></Button>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posição</p>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <span />
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => pan(0, 0.08)}>↑</Button>
              <span />
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => pan(0.08, 0)}>←</Button>
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => { const next = { zoom: 1, offsetX: 0, offsetY: 0 }; setAdjustment(next); schedulePreview(next) }}>Centro</Button>
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => pan(-0.08, 0)}>→</Button>
              <span />
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => pan(0, -0.08)}>↓</Button>
              <span />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="secondary" disabled={busy || !previewUrl} onClick={onAuto} title="Recorte central automaticamente e otimize o tamanho">
            Ajuste automático
          </Button>
          <Button disabled={busy || !previewUrl} onClick={() => void confirm()}>{busy ? 'Salvando…' : 'Usar esta foto'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
