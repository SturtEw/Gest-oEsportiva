/** Display helpers for class-activity brackets. The rules live on the server. */

import type { BracketFormat, BracketMatch, BracketTeam } from '@/lib/types'

export const FORMAT_LABELS: Record<BracketFormat, string> = {
  mata_mata: 'Mata-mata',
  pontos_corridos: 'Pontos corridos',
}

export const FORMAT_HINTS: Record<BracketFormat, string> = {
  mata_mata: 'Quem perde sai. Se o número de times não fechar a chave, os primeiros sorteados avançam direto.',
  pontos_corridos: 'Todos jogam contra todos uma vez. Vitória 3 pontos, empate 1.',
}

/** Mirrors services/brackets.MAX_TEAMS. */
export const TEAM_LIMITS: Record<BracketFormat, { min: number; max: number }> = {
  mata_mata: { min: 2, max: 32 },
  pontos_corridos: { min: 2, max: 16 },
}

/** "Final", "Semifinal", "Quartas de final", "Oitavas de final", then "1ª fase"... */
export function roundLabel(rodada: number, totalRodadas: number, formato: BracketFormat): string {
  if (formato === 'pontos_corridos') return `Rodada ${rodada}`
  const fromEnd = totalRodadas - rodada
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinal'
  if (fromEnd === 2) return 'Quartas de final'
  if (fromEnd === 3) return 'Oitavas de final'
  return `${rodada}ª fase`
}

export function matchesByRound(matches: BracketMatch[]): Array<{ rodada: number; partidas: BracketMatch[] }> {
  const rounds = new Map<number, BracketMatch[]>()
  for (const match of matches) rounds.set(match.rodada, [...(rounds.get(match.rodada) ?? []), match])
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rodada, partidas]) => ({ rodada, partidas: [...partidas].sort((a, b) => a.posicao - b.posicao) }))
}

export function teamsById(times: BracketTeam[]): Map<string, BracketTeam> {
  return new Map(times.map((team) => [team.id, team]))
}

/** The knockout match a winner moves to, or null for the final / round robin. */
export function nextMatchOf(match: BracketMatch, matches: BracketMatch[]): BracketMatch | null {
  return matches.find((item) => item.rodada === match.rodada + 1 && item.posicao === Math.ceil(match.posicao / 2)) ?? null
}

/** Whether the teacher can record (or change) this match's result right now. */
export function canRecordResult(match: BracketMatch, matches: BracketMatch[], formato: BracketFormat): boolean {
  if (match.status === 'bye' || !match.time_a_id || !match.time_b_id) return false
  if (formato === 'pontos_corridos') return true
  return nextMatchOf(match, matches)?.status !== 'finalizada'
}

/** "3 a 4 alunos por time" — what dealing `participants` among `teams` gives. */
export function teamSizeHint(participants: number, teams: number): string {
  if (teams < 1) return ''
  if (participants === 0) return 'Ainda não há participantes: os times começam vazios.'
  if (participants < teams) return `Só ${participants} ${participants === 1 ? 'participante' : 'participantes'} para ${teams} times: alguns times ficam vazios.`
  const min = Math.floor(participants / teams)
  const max = Math.ceil(participants / teams)
  const unit = (value: number) => (value === 1 ? 'aluno' : 'alunos')
  return min === max ? `${min} ${unit(min)} por time.` : `${min} a ${max} ${unit(max)} por time.`
}

/** "3/12 vagas", or "3 participantes" when there is no seat limit. */
export function seatsLabel({ vagas, total_participantes: total }: { vagas: number | null; total_participantes: number }): string {
  if (vagas) return `${total}/${vagas} vagas`
  return `${total} ${total === 1 ? 'participante' : 'participantes'}`
}

const dayFormatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })

/** "seg., 20 de out. · 14:30" from a calendar date and wall-clock time (no zone shift). */
export function formatActivityWhen(data: string | null, horario: string | null): string | null {
  const parts: string[] = []
  if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) parts.push(dayFormatter.format(new Date(`${data}T12:00:00Z`)))
  if (horario) parts.push(horario)
  return parts.length ? parts.join(' · ') : null
}
