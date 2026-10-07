/**
 * Client-side image preparation for avatar uploads.
 *
 * The backend caps avatars at 512 KB of decoded bytes; phone photos are 10-50x
 * that. This module resizes + crops in a canvas and re-encodes as JPEG/PNG,
 * so any input size becomes a valid avatar — with an "auto" mode (center-crop
 * square, 256px) and a manual mode (zoom + offset chosen by the user).
 */

export interface PreparedImage {
  dataUrl: string
  width: number
  height: number
}

export interface ManualAdjustment {
  /** 1 = fit; >1 = zoomed in. */
  zoom: number
  /** Offset of the image center inside the square, in [-0.5, 0.5] of viewport. */
  offsetX: number
  offsetY: number
}

export const OUTPUT_SIZE = 256
export const MAX_BYTES = 512 * 1024

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Arquivo de imagem inválido.')) }
    image.src = url
  })
}

/** Draw source into an OUTPUT_SIZE square honoring zoom + offset, then encode. */
function renderSquare(image: HTMLImageElement, adjustment: ManualAdjustment): string {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível neste navegador.')

  context.fillStyle = '#F7F9F5'
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  // Base scale makes the image cover the square (no empty bars).
  const coverScale = Math.max(OUTPUT_SIZE / image.width, OUTPUT_SIZE / image.height)
  const scale = coverScale * adjustment.zoom
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const centerX = OUTPUT_SIZE / 2 - adjustment.offsetX * OUTPUT_SIZE
  const centerY = OUTPUT_SIZE / 2 - adjustment.offsetY * OUTPUT_SIZE

  context.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight)
  return canvas.toDataURL('image/jpeg', 0.86)
}

export async function prepareAvatarImage(file: File, adjustment?: ManualAdjustment): Promise<PreparedImage> {
  const image = await loadImage(file)
  let dataUrl = renderSquare(image, adjustment ?? { zoom: 1, offsetX: 0, offsetY: 0 })

  // Quality ladder for the auto mode: few photos need it, huge ones converge.
  if (!adjustment) {
    for (const quality of [0.86, 0.7, 0.55, 0.4]) {
      const bytes = Math.ceil((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75)
      if (bytes <= MAX_BYTES) break
      dataUrl = renderSquare(image, { zoom: 1, offsetX: 0, offsetY: 0 })
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      canvas.getContext('2d')?.drawImage(image, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    }
  }

  return { dataUrl, width: OUTPUT_SIZE, height: OUTPUT_SIZE }
}

export function estimatedBytes(dataUrl: string): number {
  const payload = dataUrl.split(',')[1] ?? ''
  return Math.ceil((payload.length * 3) / 4)
}
