/** Training and tournament endpoints. */

import { request } from './client'
import type { TrainingTournament } from '@/lib/types'

export const trainingsApi = {
  // The backend answers with a bare list (`response_model=list[...]`). Reading
  // `data.tournaments` from it gave `undefined` and crashed the whole portal
  // (blank page) when a student opened "Treinamentos e chaves".
  getTournaments: async (): Promise<{ tournaments: TrainingTournament[] }> => {
    const data = await request<TrainingTournament[] | { tournaments?: TrainingTournament[] }>('/api/treinamentos/torneios')
    const tournaments = Array.isArray(data) ? data : data?.tournaments ?? []
    return { tournaments }
  },
}
