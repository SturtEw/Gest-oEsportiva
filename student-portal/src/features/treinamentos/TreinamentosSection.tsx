'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trophy, Calendar, MapPin, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/formatters'
import type { TrainingTournament, TrainingMatch, TrainingTeam, TrainingCategory, TrainingPhase } from '@/lib/types'

const PHASE_ORDER: TrainingPhase[] = ['classificatoria', 'oitavas', 'quartas', 'semifinal', 'final']
const PHASE_LABELS: Record<TrainingPhase, string> = {
  classificatoria: 'Classificatória',
  oitavas: 'Oitavas',
  quartas: 'Quartas',
  semifinal: 'Semifinal',
  final: 'Final',
}
const PHASE_ICONS: Record<TrainingPhase, React.ReactNode> = {
  classificatoria: <Trophy className="size-3.5" />,
  oitavas: <Trophy className="size-3.5" />,
  quartas: <Trophy className="size-3.5" />,
  semifinal: <Trophy className="size-3.5" />,
  final: <Trophy className="size-3.5" />,
}
const CATEGORY_LABELS: Record<TrainingCategory, string> = {
  futsal: 'Futsal',
  volei: 'Vôlei',
  basquete: 'Basquete',
  handebol: 'Handebol',
  atletismo: 'Atletismo',
}
const STATUS_LABELS: Record<string, string> = {
  agendado: 'Agendado',
  em_andamento: 'Em andamento',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}
const STATUS_COLORS: Record<string, string> = {
  agendado: 'bg-blue-100 text-blue-800 border-blue-200',
  em_andamento: 'bg-amber-100 text-amber-800 border-amber-200',
  finalizado: 'bg-green-100 text-green-800 border-green-200',
  cancelado: 'bg-red-100 text-red-800 border-red-200',
}

function TeamBadge({ team, compact = false }: { team: TrainingTeam | null; compact?: boolean }) {
  if (!team) return <span className="text-muted-foreground italic text-xs">{compact ? '—' : 'A definir'}</span>
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${compact ? 'text-xs' : 'text-sm'}`} style={{ color: team.cor ? team.cor : undefined }}>
      {team.logo_url && <img src={team.logo_url} alt="" className="size-4 rounded" />}
      <span>{team.sigla || team.nome}</span>
    </span>
  )
}

function MatchCard({ match, teams, isCurrentUserTeam }: { match: TrainingMatch; teams: TrainingTeam[]; isCurrentUserTeam?: boolean }) {
  const teamA = teams.find((t) => t.id === match.equipe_a_id) ?? null
  const teamB = teams.find((t) => t.id === match.equipe_b_id) ?? null
  const isFinished = match.status === 'finalizado'

  return (
    <Card className={`relative border-0 shadow-none ring-1 ring-border ${isCurrentUserTeam ? 'ring-2 ring-green-500/50' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Badge variant="outline" className={STATUS_COLORS[match.status] || 'bg-gray-100 text-gray-800'}>{STATUS_LABELS[match.status] || match.status}</Badge>
          {match.rodada && <span className="text-[10px] font-medium text-muted-foreground">Rodada {match.rodada}</span>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <TeamBadge team={teamA} />
            {isFinished && match.placar_a !== null && match.placar_b !== null && (
              <span className="font-bold tabular-nums text-lg">{match.placar_a} × {match.placar_b}</span>
            )}
            <TeamBadge team={teamB} />
          </div>

          {!isFinished && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              {match.data_hora && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {formatDateTime(match.data_hora)}
                </span>
              )}
              {match.local && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" />
                  {match.local}
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function BracketColumn({ phase, matches, teams }: { phase: TrainingPhase; matches: TrainingMatch[]; teams: TrainingTeam[] }) {
  const phaseMatches = matches.filter((m) => m.fase === phase).sort((a, b) => a.posicao - b.posicao)

  if (phaseMatches.length === 0) return null

  return (
    <div className="flex flex-col gap-3 min-w-[280px] max-w-[320px] shrink-0">
      <div className="flex items-center gap-2 px-2 pb-2 sticky top-0 bg-background/95 backdrop-blur-sm z-10 border-b border-border/50">
        {PHASE_ICONS[phase]}
        <span className="font-semibold text-sm">{PHASE_LABELS[phase]}</span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground">{phaseMatches.length} jogos</span>
      </div>
      <div className="flex flex-col gap-3">{phaseMatches.map((match) => <MatchCard key={match.id} match={match} teams={teams} />)}</div>
    </div>
  )
}

export function TreinamentosSection() {
  const [tournaments, setTournaments] = useState<TrainingTournament[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | undefined>()
  const [selectedCategory, setSelectedCategory] = useState<TrainingCategory | undefined>()

  // Load on mount (and on retry). Without this effect the section stayed on
  // the loading skeleton forever — the reported "trava" when switching to the
  // student area and opening Treinamentos.
  const loadTournaments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getTournaments()
      setTournaments(data.tournaments)
      if (data.tournaments.length > 0 && !selectedTournamentId) {
        setSelectedTournamentId(data.tournaments[0].id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os torneios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTournaments()
  }, [loadTournaments])

  const selectedTournament = useMemo(() => tournaments.find((t) => t.id === selectedTournamentId), [tournaments, selectedTournamentId])
  const categories = useMemo(() => selectedTournament?.categorias.map((c) => c.categoria) ?? [], [selectedTournament])
  // The tabs open on the first category, so the bracket must too: looking up only
  // the clicked category left the first tab empty until the student clicked it.
  const activeCategory = selectedCategory && categories.includes(selectedCategory) ? selectedCategory : categories[0]
  const selectedBracket = useMemo(() => selectedTournament?.categorias.find((c) => c.categoria === activeCategory), [selectedTournament, activeCategory])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-[300px]" />
        <div className="h-96"><Skeleton className="h-full w-full" /></div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6 text-center">
          <AlertCircle className="mx-auto size-12 text-destructive/60" />
          <p className="mt-3 text-destructive">{error}</p>
          <Button variant="outline" className="mt-4" onClick={loadTournaments}>Tentar novamente</Button>
        </CardContent>
      </Card>
    )
  }

  if (!selectedTournament) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <Trophy className="size-16 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">Nenhum torneio disponível no momento.</p>
        </CardContent>
      </Card>
    )
  }

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value as TrainingCategory)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Torneio ativo</p>
          <h2 className="font-display text-xl font-bold">{selectedTournament.nome} · {selectedTournament.ano}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{selectedTournament.modalidade} · Atualizado em {formatDate(selectedTournament.atualizado_em)}</p>
        </div>
        <Select
          items={tournaments.map((t) => ({ value: t.id, label: `${t.nome} · ${t.ano}` }))}
          value={selectedTournamentId}
          onValueChange={(value) => { if (value) setSelectedTournamentId(value); setSelectedCategory(undefined) }}
        >
          <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Escolher torneio" /></SelectTrigger>
          <SelectContent>{tournaments.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome} · {t.ano}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {categories.length > 0 && (
        <Tabs value={activeCategory} onValueChange={handleCategoryChange} className="w-full">
          <TabsList className="w-full overflow-x-auto flex-nowrap pb-1" role="tablist" aria-label="Categorias do torneio">
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="whitespace-nowrap min-h-10 px-3 py-2">
                {CATEGORY_LABELS[cat] ?? cat}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => (
            <TabsContent key={cat} value={cat} className="mt-4">
              {selectedBracket && (
                <div className="relative">
                  <ScrollArea className="h-[520px] w-full -mx-4 px-4">
                    <div className="flex gap-4 min-w-max pb-4">
                      {PHASE_ORDER.map((phase) => (
                        <BracketColumn key={phase} phase={phase} matches={selectedBracket.partidas} teams={selectedBracket.equipes} />
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {selectedBracket && selectedBracket.partidas.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Trophy className="size-12 text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">Nenhuma partida cadastrada para esta categoria.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}