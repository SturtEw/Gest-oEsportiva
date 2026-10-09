import { useEffect, useMemo, useState } from 'react'
import { Award, Check, ChevronRight, Crown, EyeOff, LockKeyhole, Sparkles, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import type { RankingEntry, StudentAward } from '@/lib/types'
import { formatDate, formatPoints } from '@/lib/formatters'

interface Props {
  alunoId: string
  studentName: string
  awards: StudentAward[]
  participates: boolean
  canEditPreference: boolean
  forcedPrivate: boolean
  setForcedPrivate: (value: boolean) => void
  onPreferenceChange: (value: boolean) => Promise<void>
}

export function AchievementSection({ alunoId, studentName, awards, participates, canEditPreference, forcedPrivate, setForcedPrivate, onPreferenceChange }: Props) {
  const [ranking, setRanking] = useState<RankingEntry[]>([])
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const totalPoints = useMemo(() => awards.reduce((sum, award) => sum + (award.pontos ?? 0), 0), [awards])
  const scoredAwards = awards.filter((award) => award.pontos !== null)

  useEffect(() => {
    let alive = true
    if (!participates || forcedPrivate) {
      setRanking([])
      setRankingLoading(false)
      setRankingError(null)
      return
    }
    setRankingLoading(true)
    setRankingError(null)
    api.ranking(alunoId)
      .then((response) => { if (alive) setRanking(response.enabled ? response.entries : []) })
      .catch((error: unknown) => { if (alive) setRankingError(error instanceof Error ? error.message : 'Não foi possível carregar o ranking.') })
      .finally(() => { if (alive) setRankingLoading(false) })
    return () => { alive = false }
  }, [alunoId, participates, forcedPrivate])

  const changePreference = async (value: boolean) => {
    if (!canEditPreference || saving) return
    if (value) {
      setConsentOpen(true)
      return
    }
    // Hide all collective data before waiting for the server to persist opt-out.
    setForcedPrivate(true)
    setSaving(true)
    try {
      await onPreferenceChange(false)
    } catch {
      // Keep the experience private until the student explicitly retries/refreshes.
    } finally {
      setSaving(false)
    }
  }

  const confirmOptIn = async () => {
    setSaving(true)
    try {
      await onPreferenceChange(true)
      setForcedPrivate(false)
      setConsentOpen(false)
    } catch {
      setRankingError('Não foi possível salvar sua escolha. O ranking continua oculto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="achievements-heading">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-[#937133]"><Sparkles className="size-4" />Suas vitórias, do seu jeito</p>
        <h2 id="achievements-heading" className="type-title mt-2 text-3xl font-extrabold text-heading">Conquistas e pontos</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Cada conquista é registrada pelo professor. Pontos antigos sem valor registrado não são calculados automaticamente.</p>
      </div>

      <Card className="overflow-hidden border-0 bg-gradient-to-br from-[#234E40] via-[#245C46] to-[#39714E] text-white shadow-[0_12px_35px_rgba(35,78,64,0.14)] ring-0">
        <CardContent className="relative grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-8">
          <div className="absolute -right-10 -top-12 size-52 rounded-full border border-white/10" aria-hidden="true" />
          <div className="relative">
            <Badge variant="outline" className="rounded-full border-white/25 bg-white/10 text-white"><Trophy className="size-3" />Seu percurso</Badge>
            <h3 className="mt-4 font-display text-2xl font-extrabold">{totalPoints.toLocaleString('pt-BR')} pontos</h3>
            <p className="mt-1 max-w-lg text-sm leading-6 text-white/75">Pontos atribuídos pelo professor às conquistas que você recebeu.</p>
          </div>
          <div className="relative flex items-center gap-4 rounded-2xl border border-white/15 bg-white/10 px-5 py-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#F6EBCF] text-[#956A20]"><Award className="size-6" /></div>
            <div><p className="text-xs text-white/70">Conquistas com pontos</p><p className="font-display text-xl font-extrabold">{scoredAwards.length}</p></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.88fr)]">
        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader className="border-b border-border/70 p-5 sm:p-6">
            <CardTitle className="flex items-center gap-2 font-display text-xl font-bold"><Award className="size-5 text-[#A8782B]" />Conquistas recebidas</CardTitle>
            <CardDescription>Seu histórico pessoal continua disponível mesmo se você não participar do ranking.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {awards.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#FFF5DB] text-[#98702D]"><Sparkles className="size-5" /></div>
                <p className="mt-4 font-semibold">Ainda não há conquistas registradas</p>
                <p className="mt-1 text-sm text-muted-foreground">Quando um professor registrar uma conquista, ela aparecerá aqui.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {awards.map((award) => (
                  <li key={award.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF5DB] text-[#9A6D29]"><Crown className="size-5" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{award.nome}</p><p className="mt-0.5 text-xs text-muted-foreground">Recebida em {formatDate(award.dataObtencao)}</p></div>
                    <Badge variant="secondary" className="shrink-0 rounded-full bg-surface-soft text-[#3F6746]">{award.pontos === null ? 'Sem pontos registrados' : formatPoints(award.pontos)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-none ring-1 ring-border">
          <CardHeader className="p-5 pb-3 sm:px-6 sm:pt-6">
            <CardTitle className="flex items-center gap-2 font-display text-xl font-bold"><Trophy className="size-5 text-[#A8782B]" />Ranking da turma</CardTitle>
            <CardDescription>Você escolhe se participa. Sua escolha pode ser alterada a qualquer momento.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-5 pt-2 sm:px-6 sm:pb-6">
            <div className="flex items-start justify-between gap-4 rounded-2xl bg-surface-soft-2 p-4">
              <div className="min-w-0">
                <p className="text-sm font-bold">Participar do ranking da turma</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Ao participar, conquistas com pontos podem aparecer para os outros participantes.</p>
              </div>
              <Switch
                aria-label="Participar do ranking da turma"
                checked={participates && !forcedPrivate}
                disabled={!canEditPreference || saving}
                onCheckedChange={(checked) => void changePreference(Boolean(checked))}
                className="mt-0.5"
              />
            </div>
            {!canEditPreference && <p className="flex items-start gap-2 rounded-xl border border-[#E9E1CC] bg-surface-warm px-4 py-3 text-xs leading-5 text-[#78643E]"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Somente o aluno, em sua própria conta, pode alterar esta preferência.</p>}

            {!participates || forcedPrivate ? (
              <div className="rounded-2xl border border-dashed border-[#D8E1D5] px-5 py-7 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface-soft text-muted-strong"><EyeOff aria-hidden="true" className="size-5" /></div>
                <h3 className="mt-3 font-semibold">Sua participação está desativada</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Você não aparece no ranking e não vê conquistas compartilhadas de outros alunos. Seu histórico pessoal continua privado para você.</p>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Participantes com opt-in</p><Badge variant="outline" className="rounded-full">Turma</Badge></div>
                {rankingError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{rankingError}<Button type="button" variant="link" size="xs" onClick={() => setRankingError(null)}>Fechar</Button></div>}
                {rankingLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Atualizando o ranking…</div> : null}
                {!rankingLoading && ranking.length === 0 ? <div className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">Ainda não há participantes com conquistas pontuadas.</div> : null}
                <ol className="space-y-2" aria-label="Ranking de alunos participantes">
                  {ranking.map((entry) => {
                    const ownEntry = entry.nome === studentName || entry.nome.startsWith(`${studentName.split(' ')[0]} `)
                    const maxPoints = ranking[0]?.pontos || 1
                    return <li key={`${entry.posicao}-${entry.nome}`} className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 ${ownEntry ? 'bg-[#F0F5E9] ring-1 ring-[#D9E7CC]' : 'bg-[#FAFBF8]'}`}>
                      <span className={`flex size-7 items-center justify-center rounded-full text-xs font-extrabold ${entry.posicao === 1 ? 'bg-[#F6EBCF] text-[#8D6B28]' : 'bg-card text-muted-foreground'}`}>{entry.posicao === 1 ? <Crown className="size-3.5" /> : entry.posicao}</span>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{ownEntry ? 'Você' : entry.nome}</p><Progress aria-label={`${entry.pontos} pontos`} value={maxPoints > 0 ? entry.pontos / maxPoints * 100 : 0} className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#E6ECE1] [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-indicator]]:bg-[#8DAA70]" /></div>
                      <span className="text-xs font-extrabold tabular-nums text-[#426848]">{formatPoints(entry.pontos)}</span>
                    </li>
                  })}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="rounded-3xl p-6 sm:max-w-md">
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-[#FFF5DB] text-[#956A20]"><Trophy aria-hidden="true" className="size-6" /></div>
            <DialogTitle className="font-display text-xl font-extrabold">Quer participar do ranking?</DialogTitle>
            <DialogDescription className="pt-1 leading-6">Suas conquistas com pontos poderão aparecer para alunos que também participam. As conquistas anteriores com pontos registrados passam a contar; valores antigos não informados continuam sem pontuação.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 rounded-2xl bg-surface-soft-2 p-4 text-sm text-[#4D6155]">
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#668C5D]" />Sua escolha é reversível e pode ser desativada depois.</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#668C5D]" />Só conquistas atribuídas pelo professor com pontos registrados entram na soma.</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#668C5D]" />As posições mostram participantes que ativaram esta opção.</li>
          </ul>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setConsentOpen(false)}>Agora não</Button>
            <Button type="button" disabled={saving} onClick={() => void confirmOptIn()} className="rounded-xl">{saving ? 'Salvando…' : 'Participar do ranking'}<ChevronRight aria-hidden="true" /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
