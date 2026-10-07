/**
 * Preset avatar gallery. Avatars come from DiceBear (open, free, SVG via URL —
 * zero bytes shipped). Four required categories; each id deterministically maps
 * to a stable URL, so storing only `avatar_id` in the DB is enough.
 *
 * Docs: https://www.dicebear.com/styles/ (PNG/SVG endpoints are CDN-cached).
 */

export interface AvatarCategory {
  id: 'genericos-m' | 'genericos-f' | 'monstrinhos' | 'animais'
  label: string
  style: string
  seedPrefix: string
  count: number
}

export const AVATAR_CATEGORIES: AvatarCategory[] = [
  { id: 'genericos-m', label: 'Genéricos masculinos', style: 'avataaars', seedPrefix: 'gm', count: 8 },
  { id: 'genericos-f', label: 'Genéricos femininos', style: 'avataaars', seedPrefix: 'gf', count: 8 },
  { id: 'monstrinhos', label: 'Monstrinhos', style: 'bottts', seedPrefix: 'mo', count: 10 },
  { id: 'animais', label: 'Animais', style: 'fun-emoji', seedPrefix: 'an', count: 10 },
]

export function avatarUrl(avatarId: string, size = 96): string {
  // Format: "categoria-numero" (ex.: "monstrinhos-3", "animais-7").
  const [category, rawNumber] = avatarId.split('-')
  const meta = AVATAR_CATEGORIES.find((item) => item.id === category)
  if (!meta) return ''
  const number = Math.max(1, Math.min(meta.count, Number(rawNumber) || 1))
  return `https://api.dicebear.com/9.x/${meta.style}/svg?seed=${meta.seedPrefix}-${number}&size=${size}`
}

export function avatarIdFor(categoryId: AvatarCategory['id'], number: number): string {
  return `${categoryId}-${number}`
}

export function allPresetAvatars(): Array<{ id: string; categoryId: AvatarCategory['id']; url: string }> {
  return AVATAR_CATEGORIES.flatMap((category) =>
    Array.from({ length: category.count }, (_, index) => ({
      id: avatarIdFor(category.id, index + 1),
      categoryId: category.id,
      url: avatarUrl(avatarIdFor(category.id, index + 1)),
    })),
  )
}
