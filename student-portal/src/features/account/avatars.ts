/**
 * Preset avatar gallery — generated locally as inline SVG data URIs.
 *
 * No external network: the previous CDN avatars (DiceBear) failed to render in
 * environments that block third-party requests. Every avatar here is a
 * deterministic, self-contained SVG string: always renders, zero requests.
 */

export interface AvatarCategory {
  id: 'genericos-m' | 'genericos-f' | 'monstrinhos' | 'animais'
  label: string
  count: number
}

export const AVATAR_CATEGORIES: AvatarCategory[] = [
  { id: 'genericos-m', label: 'Genéricos masculinos', count: 8 },
  { id: 'genericos-f', label: 'Genéricos femininos', count: 8 },
  { id: 'monstrinhos', label: 'Monstrinhos', count: 10 },
  { id: 'animais', label: 'Animais', count: 10 },
]

// Stable palettes per index so an avatar_id always looks the same.
const SKIN = ['#F2C79B', '#E0AC81', '#C68863', '#8D5524', '#FFDBAC', '#B87A50', '#F1C27D', '#A0673F']
const HAIR_M = ['#2B2B2B', '#4A2C12', '#6B4423', '#1B1B1B', '#3B2F2F', '#555555', '#22303C', '#4E342E']
const HAIR_F = ['#2B2B2B', '#7B3F00', '#B5651D', '#DAA520', '#8B0000', '#4B0082', '#C9A66B', '#1B1B1B']
const SHIRT = ['#4A7C59', '#3B6EA5', '#C0392B', '#8E44AD', '#E67E22', '#16A085', '#2C3E50', '#D35400']
const MONSTER = ['#8E44AD', '#27AE60', '#E74C3C', '#2980B9', '#F39C12', '#16A085', '#D35400', '#7D3C98', '#1ABC9C', '#E91E63']
const ANIMAL = ['#A0522D', '#808080', '#DAA520', '#F4A460', '#696969', '#CD853F', '#4682B4', '#B8860B', '#8B4513', '#556B2F']

const svgUri = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(body)}`

function personSvg({ skin, hair, shirt, hairStyle, feminine }: { skin: string; hair: string; shirt: string; hairStyle: number; feminine: boolean }): string {
  const bg = ['#EAF0E5', '#FDF3E3', '#EDF2F9', '#F6EAF0'][(skin.length + hairStyle) % 4]
  let hairPath = ''
  if (feminine) {
    hairPath = `<path d="M28 44 Q28 20 50 20 Q72 20 72 44 L72 62 Q72 50 66 46 L66 40 Q50 34 34 40 L34 46 Q28 50 28 62 Z" fill="${hair}"/>`
    if (hairStyle % 3 === 1) hairPath += `<circle cx="30" cy="52" r="6" fill="${hair}"/><circle cx="70" cy="52" r="6" fill="${hair}"/>`
    if (hairStyle % 3 === 2) hairPath += `<path d="M34 24 Q50 12 66 24 L66 30 Q50 22 34 30 Z" fill="${hair}"/>`
  } else {
    if (hairStyle % 4 === 0) hairPath = `<path d="M30 42 Q30 22 50 22 Q70 22 70 42 L70 38 Q70 30 50 30 Q30 30 30 38 Z" fill="${hair}"/>`
    else if (hairStyle % 4 === 1) hairPath = `<path d="M30 40 Q32 20 50 20 Q68 20 70 40 Q64 28 50 28 Q36 28 30 40 Z" fill="${hair}"/>`
    else if (hairStyle % 4 === 2) hairPath = `<path d="M32 38 Q34 24 50 24 Q66 24 68 38 L68 32 Q64 26 50 26 Q36 26 32 32 Z" fill="${hair}"/>`
    else hairPath = `<ellipse cx="34" cy="34" rx="5" ry="9" fill="${hair}"/><ellipse cx="66" cy="34" rx="5" ry="9" fill="${hair}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="50" fill="${bg}"/>
<rect x="30" y="70" width="40" height="30" rx="12" fill="${shirt}"/>
<circle cx="50" cy="46" r="20" fill="${skin}"/>
${hairPath}
<circle cx="43" cy="45" r="2" fill="#2B2B2B"/><circle cx="57" cy="45" r="2" fill="#2B2B2B"/>
<path d="M44 54 Q50 58 56 54" stroke="#2B2B2B" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`
}

function monsterSvg({ color, eyes, teeth, horns }: { color: string; eyes: number; teeth: boolean; horns: boolean }): string {
  const bg = '#F3EDF9'
  const eyeY = 42
  const eyePositions = eyes === 1 ? [[50, eyeY]] : eyes === 2 ? [[40, eyeY], [60, eyeY]] : [[34, eyeY], [50, eyeY - 6], [66, eyeY]]
  const eyeSvg = eyePositions.map(([cx, cy]) =>
    `<circle cx="${cx}" cy="${cy}" r="9" fill="#ffffff"/><circle cx="${cx}" cy="${cy}" r="4" fill="#2B2B2B"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="50" fill="${bg}"/>
${horns ? `<path d="M36 26 L32 12 L44 22 Z" fill="${color}"/><path d="M64 26 L68 12 L56 22 Z" fill="${color}"/>` : ''}
<rect x="22" y="24" width="56" height="62" rx="24" fill="${color}"/>
${eyeSvg}
${teeth ? `<rect x="38" y="58" width="24" height="10" rx="3" fill="#ffffff"/><path d="M42 58 L42 63 M48 58 L48 64 M54 58 L54 63" stroke="${color}" stroke-width="2"/>` : `<path d="M40 60 Q50 68 60 60" stroke="#2B2B2B" stroke-width="2.5" fill="none" stroke-linecap="round"/>`}
</svg>`
}

function animalSvg({ color, kind }: { color: string; kind: number }): string {
  const bg = '#FDF6EC'
  const inner = '#F8D7C8'
  let ears = ''
  let extra = ''
  if (kind % 5 === 0) {
    ears = `<circle cx="30" cy="28" r="10" fill="${color}"/><circle cx="70" cy="28" r="10" fill="${color}"/>`
  } else if (kind % 5 === 1) {
    ears = `<path d="M28 34 L26 12 L44 26 Z" fill="${color}"/><path d="M72 34 L74 12 L56 26 Z" fill="${color}"/>`
    extra = `<path d="M40 52 L34 50 M40 55 L34 56 M60 52 L66 50 M60 55 L66 56" stroke="#2B2B2B" stroke-width="1.5"/>`
  } else if (kind % 5 === 2) {
    ears = `<ellipse cx="36" cy="18" rx="6" ry="14" fill="${color}"/><ellipse cx="64" cy="18" rx="6" ry="14" fill="${color}"/><ellipse cx="36" cy="18" rx="3" ry="10" fill="${inner}"/><ellipse cx="64" cy="18" rx="3" ry="10" fill="${inner}"/>`
  } else if (kind % 5 === 3) {
    ears = `<ellipse cx="28" cy="34" rx="8" ry="14" fill="${color}"/><ellipse cx="72" cy="34" rx="8" ry="14" fill="${color}"/>`
  } else {
    ears = `<path d="M26 36 L24 10 L46 26 Z" fill="${color}"/><path d="M74 36 L76 10 L54 26 Z" fill="${color}"/>`
    extra = `<path d="M50 60 L44 54 L56 54 Z" fill="#ffffff"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="50" fill="${bg}"/>
${ears}
<circle cx="50" cy="50" r="26" fill="${color}"/>
<circle cx="41" cy="45" r="3" fill="#2B2B2B"/><circle cx="59" cy="45" r="3" fill="#2B2B2B"/>
<ellipse cx="50" cy="56" rx="10" ry="7" fill="${inner}"/>
<ellipse cx="50" cy="54" rx="4" ry="3" fill="#2B2B2B"/>
<path d="M50 57 L50 62 M44 64 Q50 68 56 64" stroke="#2B2B2B" stroke-width="1.5" fill="none" stroke-linecap="round"/>
${extra}
</svg>`
}

function buildSvg(categoryId: string, index: number): string {
  const i = Math.max(0, index - 1)
  if (categoryId === 'genericos-m') {
    return personSvg({ skin: SKIN[i % SKIN.length], hair: HAIR_M[i % HAIR_M.length], shirt: SHIRT[i % SHIRT.length], hairStyle: i, feminine: false })
  }
  if (categoryId === 'genericos-f') {
    return personSvg({ skin: SKIN[(i + 3) % SKIN.length], hair: HAIR_F[i % HAIR_F.length], shirt: SHIRT[(i + 5) % SHIRT.length], hairStyle: i, feminine: true })
  }
  if (categoryId === 'monstrinhos') {
    return monsterSvg({ color: MONSTER[i % MONSTER.length], eyes: (i % 3) + 1, teeth: i % 2 === 0, horns: i % 3 !== 0 })
  }
  return animalSvg({ color: ANIMAL[i % ANIMAL.length], kind: i })
}

export function avatarUrl(avatarId: string): string {
  // Format: "categoria-numero" (ex.: "monstrinhos-3", "animais-7").
  const [category, rawNumber] = avatarId.split('-')
  const meta = AVATAR_CATEGORIES.find((item) => item.id === category)
  if (!meta) return ''
  const number = Math.max(1, Math.min(meta.count, Number(rawNumber) || 1))
  return svgUri(buildSvg(category, number))
}

export function avatarIdFor(categoryId: AvatarCategory['id'], number: number): string {
  return `${categoryId}-${number}`
}
