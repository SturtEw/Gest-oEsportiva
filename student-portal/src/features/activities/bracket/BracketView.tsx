import { useMemo } from 'react'
import { Trophy } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { canRecordResult, matchesByRound, roundLabel, teamsById } from '@/lib/bracket'
import type { ActivityBracket, BracketMatch } from '@/lib/types'
import { cn } from 'cn'
import { MatchCard } from './MatchCard'

interface Props {
  bracket: ActivityBracket
  highlightTeamId?: string | null
  /** Teacher only: opens the result dialog for a match. */
  onSelectMatch?: (match: BracketMatch) => void
}

/** Knockout tree or round-robin table + fixtures, with the champion once decided. */
export function BracketView({ bracket, highlightTeamId, onSelectMatch }: Props) {
  const teams = useMemo(() => teamsById(bracket.times), [bracket.times])
  const rounds = useMemo(() => matchesByRound(bracket.partidas), [bracket.partidas])
  const champion = bracket.campeao_id ? teams.get(bracket.campeao_id) : undefined

  const selectable = (match: BracketMatch) =>
    onSelectMatch && canRecordResult(match, bracket.partidas, bracket.formato) ? onSelectMatch : undefined

  return (
    <div className="space-y-5">
      {champion && (
        <div className="flex items-center gap-3 rounded-2xl bg-sidebar px-4 py-3 text-sidebar-foreground" role="status">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Trophy aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">Campeão</p>
            <p className="truncate font-display text-lg font-extrabold">{champion.nome}</p>
          </div>
        </div>
      )}

      {bracket.formato === 'pontos_corridos' && (
        <StandingsTable bracket={bracket} highlightTeamId={highlightTeamId} />
      )}

      {bracket.formato === 'mata_mata' ? (
        // Columns share one height and spread their matches evenly, so each match
        // sits between the two it is fed by — a bracket without drawn connectors.
        <div className="-mx-1 overflow-x-auto px-1 pb-2" role="region" aria-label="Chaveamento mata-mata" tabIndex={0}>
          <ol className="m-0! flex min-w-max list-none items-stretch gap-4 p-0!">
            {rounds.map((round) => (
              <li key={round.rodada} className="flex w-56 shrink-0 flex-col">
                <h4 className="eyebrow mb-3 px-1">{roundLabel(round.rodada, bracket.total_rodadas, bracket.formato)}</h4>
                <div className="flex flex-1 flex-col justify-around gap-3">
                  {round.partidas.map((match) => (
                    <MatchCard key={match.id} match={match} teams={teams} highlightTeamId={highlightTeamId} onSelect={selectable(match)} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="space-y-4">
          {rounds.map((round) => (
            <section key={round.rodada} aria-label={roundLabel(round.rodada, bracket.total_rodadas, bracket.formato)}>
              <h4 className="eyebrow mb-2">{roundLabel(round.rodada, bracket.total_rodadas, bracket.formato)}</h4>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {round.partidas.map((match) => (
                  <MatchCard key={match.id} match={match} teams={teams} highlightTeamId={highlightTeamId} onSelect={selectable(match)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function StandingsTable({ bracket, highlightTeamId }: { bracket: ActivityBracket; highlightTeamId?: string | null }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-border">
      <Table>
        <TableHeader className="bg-muted/70">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 text-center">#</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-center" title="Pontos">P</TableHead>
            <TableHead className="text-center" title="Jogos">J</TableHead>
            <TableHead className="text-center" title="Vitórias">V</TableHead>
            <TableHead className="text-center" title="Empates">E</TableHead>
            <TableHead className="text-center" title="Derrotas">D</TableHead>
            <TableHead className="text-center" title="Saldo (pontos marcados menos sofridos)">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bracket.classificacao.map((row) => (
            <TableRow key={row.time_id} className={cn(row.time_id === highlightTeamId && 'bg-accent/45 hover:bg-accent/55')}>
              <TableCell className="text-center font-semibold tabular-nums text-muted-foreground">{row.posicao}</TableCell>
              <TableCell className="max-w-[12rem] truncate font-semibold">{row.nome}</TableCell>
              <TableCell className="text-center font-display font-extrabold tabular-nums">{row.pontos}</TableCell>
              <TableCell className="text-center tabular-nums">{row.jogos}</TableCell>
              <TableCell className="text-center tabular-nums">{row.vitorias}</TableCell>
              <TableCell className="text-center tabular-nums">{row.empates}</TableCell>
              <TableCell className="text-center tabular-nums">{row.derrotas}</TableCell>
              <TableCell className="text-center tabular-nums">{row.saldo > 0 ? `+${row.saldo}` : row.saldo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
