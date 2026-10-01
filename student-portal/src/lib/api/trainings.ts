/** Training and tournament endpoints. */

import { request } from './client'
import type { TrainingTournament } from '@/lib/types'

export const trainingsApi = {
  getTournaments: () => request<{ tournaments: TrainingTournament[] }>('/api/treinamentos/torneios'),
}
