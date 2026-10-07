/** Predefined quick-start templates for individual training plans. */

import type { WorkoutTemplate } from '@/lib/api'

export const TEMPLATE_ORDER = ['musculacao', 'atletismo', 'hipertrofia', 'forca_maxima', 'resistencia_muscular', 'hiit'] as const

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

export const FALLBACK_TEMPLATES: WorkoutTemplate[] = [
  { id: 'musculacao', nome: 'Musculação', descricao: 'Circuito básico de musculação em máquinas e pesos livres.', exercicios: [] },
  { id: 'atletismo', nome: 'Atletismo', descricao: 'Velocidade, técnica de corrida e pliometria para pista.', exercicios: [] },
  { id: 'hipertrofia', nome: 'Hipertrofia', descricao: 'Volume moderado com foco em falha mecânica controlada.', exercicios: [] },
  { id: 'forca_maxima', nome: 'Força Máxima', descricao: 'Baixas repetições com cargas altas e descanso completo.', exercicios: [] },
  { id: 'resistencia_muscular', nome: 'Resistência Muscular', descricao: 'Alta repetição com pouco descanso entre as séries.', exercicios: [] },
  { id: 'hiit', nome: 'HIIT', descricao: 'Intervalos de alta intensidade com recuperação curta.', exercicios: [] },
]

export const TEMPLATE_ICONS: Record<string, string> = {
  musculacao: '🏋️',
  atletismo: '🏃',
  hipertrofia: '💪',
  forca_maxima: '🏋️‍♂️',
  resistencia_muscular: '🔁',
  hiit: '⚡',
}
