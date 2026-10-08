/**
 * ProfessorDashboardGroups — área do professor: gestão de subgrupos da turma,
 * cards com contador em tempo real de alunos "Em Aula" e relatório de presença.
 *
 * Realtime: a seção "subgroups" chega pelo WebSocket; a revisão sobe e os
 * cards refetcham. O contador de ativos é calculado no servidor (sessões
 * com `saida` nula), nunca no cliente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, LogOut, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { usePollingRevision } from '@/hooks/usePollingRevision'
import { api } from '@/lib/api'
import type { AttendanceRecord, SubgroupSummary } from '@/lib/api/subgroups'

interface Props {
  turmaId: string
  revision: number
  /** Realtime is pushing changes; otherwise the component polls. */
  live: boolean
}

/** Skeletons at module scope: stable element references, never rebuilt per render. */
const CardsLoading = (
  <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="Carregando aulas">
    <Skeleton className="h-36 rounded-2xl" />
    <Skeleton className="h-36 rounded-2xl" />
    <Skeleton className="h-36 rounded-2xl" />
  </div>
)

export function ProfessorDashboardGroups({ turmaId, revision, live }: Props) {
  const [subgroups, setSubgroups] = useState<SubgroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Sem realtime empurrando, o polling cobre a lacuna (mesmo padrão das outras seções).
  const tick = usePollingRevision(!live)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.teacherSubgroups(turmaId || undefined)
      setSubgroups(data.subgrupos)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os subgrupos.')
    } finally {
      setLoading(false)
    }
  }, [turmaId])

  // Realtime invalidation (revision) and polling tick share this refetch.
  useEffect(() => { void load() }, [load, revision, tick])

  const create = async () => {
    if (name.trim().length < 2) return
    setCreating(true); setError(null)
    try {
      await api.createSubgroup({ turma_id: turmaId, nome: name.trim(), descricao: description.trim() || null })
      setName('')
      setDescription('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o subgrupo.')
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await api.deleteSubgroup(id)
      if (selectedId === id) setSelectedId(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o subgrupo.')
    }
  }

  const toggleStatus = async (subgroup: SubgroupSummary) => {
    setError(null)
    try {
      await api.updateSubgroup(subgroup.id, { status: subgroup.status === 'ativo' ? 'inativo' : 'ativo' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o subgrupo.')
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="groups-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="groups-heading" className="text-lg font-semibold">Aulas da turma (subgrupos)</h2>
          <p className="text-sm text-muted-foreground">Cards atualizados em tempo real com os alunos em aula agora.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" /> Atualizar
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Input placeholder="Nome da aula (ex.: Judô)" value={name} onChange={(event) => setName(event.target.value)} className="w-56" maxLength={60} />
          <Input placeholder="Descrição (opcional)" value={description} onChange={(event) => setDescription(event.target.value)} className="w-64" maxLength={500} />
          <Button onClick={() => void create()} disabled={creating || name.trim().length < 2}>
            <Plus aria-hidden="true" /> Criar aula
          </Button>
        </CardContent>
      </Card>

      {loading && subgroups.length === 0 ? (
        CardsLoading
      ) : subgroups.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma aula criada ainda. Crie subgrupos como Judô, Natação ou Futsal.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {subgroups.map((subgroup) => (
            <Card key={subgroup.id} className={subgroup.status === 'inativo' ? 'opacity-60' : undefined}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{subgroup.nome}</h3>
                    {subgroup.descricao && <p className="text-xs text-muted-foreground">{subgroup.descricao}</p>}
                  </div>
                  <Badge variant={subgroup.status === 'ativo' ? 'default' : 'secondary'}>{subgroup.status}</Badge>
                </div>

                <div className="flex items-baseline gap-2 rounded-xl bg-muted px-3 py-2">
                  <span className="text-2xl font-bold tabular-nums">{subgroup.ativos}</span>
                  <span className="text-xs text-muted-foreground">em aula agora</span>
                </div>

                {subgroup.alunos_ativos.length > 0 && (
                  <ul className="text-xs text-muted-foreground" aria-label="Alunos em aula">
                    {subgroup.alunos_ativos.map((student) => (
                      <li key={student.id} className="flex items-center gap-1"><Users aria-hidden="true" className="size-3" /> {student.nome}</li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(selectedId === subgroup.id ? null : subgroup.id)}>Presenças</Button>
                  <Button variant="outline" size="sm" onClick={() => void toggleStatus(subgroup)}>
                    {subgroup.status === 'ativo' ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void remove(subgroup.id)}>
                    <Trash2 aria-hidden="true" /> Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedId && <AttendancePanel subgroupId={selectedId} revision={revision} />}
    </section>
  )
}

/** Relatório de presença: histórico de sessões com o tempo exato (servidor). */
function AttendancePanel({ subgroupId, revision }: { subgroupId: string; revision: number }) {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [title, setTitle] = useState('')
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // AbortController: descarta respostas que chegam após a desmontagem (o painel
  // pode fechar no meio do fetch), evitando setState em componente morto.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await api.attendanceReport(subgroupId)
      if (!aliveRef.current) return
      setRecords(data.sessoes); setTitle(data.subgrupo.nome); setTotal(data.total); setError(null)
    } catch (cause) {
      if (aliveRef.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar presenças.')
    }
  }, [subgroupId])

  useEffect(() => { void load() }, [load, revision])

  const forceCheckout = async (record: AttendanceRecord) => {
    try {
      await api.forceCheckout(subgroupId, record.aluno_id)
      await load()
    } catch (cause) {
      if (aliveRef.current) setError(cause instanceof Error ? cause.message : 'Falha ao encerrar a sessão.')
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="font-semibold">Presenças — {title}</h3>
        {total > records.length && (
          <p className="text-xs text-muted-foreground">Mostrando as {records.length} mais recentes de {total} sessões.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma sessão registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-2">Aluno</th>
                  <th className="p-2">Entrada</th>
                  <th className="p-2">Saída</th>
                  <th className="p-2">Permanência</th>
                  <th className="p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="p-2 font-medium">{record.aluno_nome}</td>
                    <td className="p-2">{new Date(record.entrada).toLocaleString()}</td>
                    <td className="p-2">{record.saida ? new Date(record.saida).toLocaleString() : '—'}</td>
                    <td className="p-2 tabular-nums">{record.tempo_permanencia ?? '—'}</td>
                    <td className="p-2">{record.ativa ? <Badge>Em aula</Badge> : <Badge variant="secondary">Finalizada</Badge>}</td>
                    <td className="p-2">
                      {record.ativa && (
                        <Button variant="outline" size="sm" onClick={() => void forceCheckout(record)}>
                          <LogOut aria-hidden="true" /> Encerrar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
