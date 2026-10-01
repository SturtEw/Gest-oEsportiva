/**
 * "Visão geral de alunos" table.
 *
 * Built for scanning on a phone, not for reading a spreadsheet. Every metric that can
 * be unknown renders as "—": a student with no attendance record has no frequency, and
 * showing 0% would put them at the bottom of a ranking they do not belong in.
 *
 * Rows are sortable because the first question a coach asks is "who is at risk?",
 * and that means comparing frequencies, not reading names alphabetically.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, MessageCircleWarning, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import type { TeacherStudentRow } from '@/lib/types'

type SortKey = 'nome' | 'frequencia_percentual' | 'media' | 'duvidas_pendentes'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'nome', label: 'Aluno' },
  { key: 'frequencia_percentual', label: 'Frequência', align: 'right' },
  { key: 'media', label: 'Média', align: 'right' },
  { key: 'duvidas_pendentes', label: 'Dúvidas', align: 'right' },
]

/** Unknown values always sort last, in both directions — they are not "low". */
function compare(a: number | string | null, b: number | string | null, direction: 1 | -1) {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction
  return String(a).localeCompare(String(b), 'pt-BR') * direction
}

function frequencyTone(value: number | null) {
  if (value === null) return { label: '—', className: 'text-muted-foreground' }
  if (value >= 85) return { label: `${value}%`, className: 'text-[#4C6B45] font-semibold' }
  if (value >= 70) return { label: `${value}%`, className: 'text-[#8A6524] font-semibold' }
  return { label: `${value}%`, className: 'text-[#B7542B] font-semibold' }
}

export function StudentOverviewTable({
  alunos,
  onOpenStudent,
}: {
  alunos: TeacherStudentRow[]
  onOpenStudent?: (student: TeacherStudentRow) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('nome')
  const [direction, setDirection] = useState<1 | -1>(1)

  const rows = useMemo(() => {
    const sorted = [...alunos].sort((a, b) => compare(a[sortKey], b[sortKey], direction))
    return sorted
  }, [alunos, sortKey, direction])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDirection((current) => (current === 1 ? -1 : 1))
    else { setSortKey(key); setDirection(key === 'nome' ? 1 : -1) }
  }

  if (alunos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <Users className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold">Nenhum aluno vinculado</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Assim que a administração vincular alunos às suas turmas, eles aparecem aqui.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">Visão geral dos alunos por turma, com frequência, média e dúvidas pendentes</caption>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {COLUMNS.map((column) => {
                const isActive = sortKey === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={isActive ? (direction === 1 ? 'ascending' : 'descending') : 'none'}
                    className={cn('px-3 py-2.5 first:pl-4 last:pr-4', column.align === 'right' && 'text-right')}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors',
                        isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.label}
                      {isActive
                        ? (direction === 1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)
                        : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const frequency = frequencyTone(row.frequencia_percentual)
              return (
                <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-3 pl-4">
                    <p className="truncate font-semibold text-foreground">{row.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.turma_nome}</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className={frequency.className}>{frequency.label}</span>
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      ({row.presencas}/{row.presencas + row.faltas})
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.media === null
                      ? <span className="text-muted-foreground">—</span>
                      : <span className="font-semibold">{row.media.toFixed(1)}</span>}
                  </td>
                  <td className="px-3 py-3 pr-4 text-right">
                    {row.duvidas_pendentes > 0 ? (
                      <Badge className="inline-flex items-center gap-1 rounded-full bg-[#FFF7E8] text-[#8A6524]">
                        <MessageCircleWarning className="size-3" />
                        {row.duvidas_pendentes}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'aluno' : 'alunos'}
        </p>
        {onOpenStudent ? (
          <Button variant="ghost" size="xs" onClick={() => onOpenStudent(rows[0])}>
            Abrir mais detalhado
          </Button>
        ) : null}
      </div>
    </div>
  )
}
