import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BracketMatch, BracketTeam } from '@/lib/types'
import { cn } from 'cn'

interface Props {
  match: BracketMatch
  teams: Map<string, BracketTeam>
  /** Team of the signed-in student, highlighted. */
  highlightTeamId?: string | null
  /** Present when the teacher can record this match's result. */
  onSelect?: (match: BracketMatch) => void
}

/** One fixture: two team rows with their scores; the winner is emphasised. */
export function MatchCard({ match, teams, highlightTeamId, onSelect }: Props) {
  const finished = match.status === 'finalizada'
  const rows = [
    { id: match.time_a_id, score: match.placar_a },
    { id: match.time_b_id, score: match.placar_b },
  ]
  const label = describe(match, teams)

  const body = (
    <>
      <ul className="m-0! w-full list-none divide-y divide-border/70 p-0!">
        {rows.map((row, index) => {
          const team = row.id ? teams.get(row.id) : undefined
          const winner = Boolean(row.id) && match.vencedor_id === row.id
          const loser = finished && Boolean(match.vencedor_id) && !winner
          return (
            <li
              key={index}
              className={cn(
                'flex min-h-9 items-center justify-between gap-2 px-3 py-1.5',
                row.id && row.id === highlightTeamId && 'bg-accent/45',
              )}
            >
              <span className={cn('min-w-0 truncate text-sm', winner ? 'font-bold text-heading' : 'font-medium', loser && 'text-muted-foreground')}>
                {team?.nome ?? (match.status === 'bye' && index === 1 ? <em className="text-xs font-normal text-muted-foreground">Avança direto</em> : <span className="text-xs font-normal text-muted-foreground">A definir</span>)}
              </span>
              {finished && (
                <span className={cn('shrink-0 font-display text-sm tabular-nums', winner ? 'font-extrabold text-heading' : 'text-muted-foreground')}>
                  {row.score}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {onSelect && (
        <span className="flex w-full items-center justify-center gap-1.5 border-t border-border/70 bg-muted/60 px-3 py-1.5 text-xs font-semibold text-primary">
          <Pencil aria-hidden="true" className="size-3" />
          {finished ? 'Alterar placar' : 'Registrar placar'}
        </span>
      )}
    </>
  )

  const frame = 'w-full overflow-hidden rounded-xl bg-card ring-1 ring-border'
  if (!onSelect) {
    return <div className={cn(frame, match.status === 'bye' && 'opacity-80')} aria-label={label}>{body}</div>
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelect(match)}
      aria-label={`${label}. ${finished ? 'Alterar placar' : 'Registrar placar'}`}
      className={cn(frame, 'h-auto flex-col items-stretch gap-0 p-0 whitespace-normal hover:bg-card hover:ring-2 hover:ring-primary/40')}
    >
      {body}
    </Button>
  )
}

function describe(match: BracketMatch, teams: Map<string, BracketTeam>): string {
  const a = match.time_a_id ? teams.get(match.time_a_id)?.nome : undefined
  const b = match.time_b_id ? teams.get(match.time_b_id)?.nome : undefined
  if (match.status === 'bye') return `${a ?? b} avança direto`
  if (!a || !b) return `Partida aguardando ${a || b ? 'o adversário' : 'os times'}`
  if (match.status === 'finalizada') return `${a} ${match.placar_a} × ${match.placar_b} ${b}`
  return `${a} contra ${b}`
}
