import { describe, expect, it } from 'vitest'
import { canRecordResult, formatActivityWhen, matchesByRound, roundLabel, teamSizeHint } from './bracket'
import type { BracketMatch } from './types'

function match(rodada: number, posicao: number, overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: `r${rodada}-m${posicao}`, rodada, posicao, time_a_id: 'a', time_b_id: 'b',
    placar_a: null, placar_b: null, vencedor_id: null, status: 'pendente', ...overrides,
  }
}

describe('roundLabel', () => {
  it('names knockout rounds from the final backwards', () => {
    expect([1, 2, 3, 4, 5].map((round) => roundLabel(round, 5, 'mata_mata'))).toEqual([
      '1ª fase', 'Oitavas de final', 'Quartas de final', 'Semifinal', 'Final',
    ])
    expect(roundLabel(1, 1, 'mata_mata')).toBe('Final')
  })

  it('numbers round-robin rounds', () => {
    expect(roundLabel(3, 5, 'pontos_corridos')).toBe('Rodada 3')
  })
})

describe('canRecordResult', () => {
  it('blocks byes, incomplete pairings and matches whose next round is played', () => {
    const semi = match(1, 1)
    const final = match(2, 1, { status: 'finalizada' })
    expect(canRecordResult(match(1, 2, { status: 'bye', time_b_id: null }), [], 'mata_mata')).toBe(false)
    expect(canRecordResult(match(2, 1, { time_b_id: null, status: 'aguardando' }), [], 'mata_mata')).toBe(false)
    expect(canRecordResult(semi, [semi, final], 'mata_mata')).toBe(false)
    expect(canRecordResult(semi, [semi, { ...final, status: 'pendente' }], 'mata_mata')).toBe(true)
    expect(canRecordResult(semi, [semi, final], 'pontos_corridos')).toBe(true)
  })
})

describe('matchesByRound', () => {
  it('groups and orders by round and position', () => {
    const grouped = matchesByRound([match(2, 1), match(1, 2), match(1, 1)])
    expect(grouped.map((round) => [round.rodada, round.partidas.map((item) => item.posicao)])).toEqual([[1, [1, 2]], [2, [1]]])
  })
})

describe('teamSizeHint', () => {
  it('describes the deal', () => {
    expect(teamSizeHint(12, 4)).toBe('3 alunos por time.')
    expect(teamSizeHint(11, 4)).toBe('2 a 3 alunos por time.')
    expect(teamSizeHint(2, 4)).toMatch(/alguns times ficam vazios/)
    expect(teamSizeHint(0, 4)).toMatch(/começam vazios/)
  })
})

describe('formatActivityWhen', () => {
  it('keeps the calendar day regardless of the browser zone', () => {
    expect(formatActivityWhen('2026-10-20', '14:30')).toMatch(/20.*out.*14:30/)
    expect(formatActivityWhen(null, null)).toBeNull()
    expect(formatActivityWhen(null, '08:00')).toBe('08:00')
  })
})
