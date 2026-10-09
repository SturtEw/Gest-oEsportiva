/**
 * Catalog of widgets a professor can place on the panel.
 *
 * This is the single source of truth for three things that must never disagree:
 *   - the "Componentes disponíveis" menu (title, description, icon),
 *   - the default size a freshly-added widget gets,
 *   - which kinds the renderer knows how to draw.
 *
 * Adding a widget is therefore a one-line change here plus a case in WidgetRenderer.
 */
import type { ComponentType } from 'react'
import {
  AlarmClock, CalendarClock, CalendarDays, Layers, ListChecks, TrendingUp, Users, UsersRound,
} from 'lucide-react'
import type { WidgetKind } from './layout-types'

/** Sensible placement used whenever a widget is added without an explicit position. */
export interface WidgetSize {
  w: number
  h: number
  /** Below this many grid columns the widget is hidden rather than squeezed. */
  minW: number
  minH: number
}

export interface WidgetDefinition {
  kind: WidgetKind
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  defaultSize: WidgetSize
  /** A widget the panel starts with the first time a professor opens it. */
  starter?: boolean
}

export const WIDGET_CATALOG: WidgetDefinition[] = [
  {
    kind: 'aulas_hoje',
    title: 'Aulas de Hoje',
    description: 'A agenda do dia, com o que já foi concluído e o que vem a seguir.',
    icon: CalendarDays,
    defaultSize: { w: 6, h: 7, minW: 3, minH: 4 },
    starter: true,
  },
  {
    kind: 'proximas_aulas',
    title: 'Próximas Aulas',
    description: 'As sessões marcadas para os próximos dias.',
    icon: CalendarClock,
    defaultSize: { w: 6, h: 7, minW: 3, minH: 4 },
    starter: true,
  },
  {
    kind: 'modalidades',
    title: 'Modalidades/Subgrupos',
    description: 'Ocupação e vagas por turma e modalidade.',
    icon: Layers,
    defaultSize: { w: 12, h: 5, minW: 4, minH: 3 },
  },
  {
    kind: 'atalhos',
    title: 'Atalhos Rápidos',
    description: 'Ações frequentes: agendar aula, convites, fórum e mais.',
    icon: ListChecks,
    defaultSize: { w: 4, h: 4, minW: 3, minH: 3 },
    starter: true,
  },
  {
    kind: 'lembretes',
    title: 'Lembretes',
    description: 'Pendências que pedem ação: dúvidas sem resposta e frequência baixa.',
    icon: AlarmClock,
    defaultSize: { w: 4, h: 5, minW: 3, minH: 3 },
  },
  {
    kind: 'turmas',
    title: 'Suas Turmas',
    description: 'Cada turma com a barra de ocupação.',
    icon: UsersRound,
    defaultSize: { w: 6, h: 5, minW: 4, minH: 3 },
  },
  {
    kind: 'alunos',
    title: 'Visão Geral de Alunos',
    description: 'Tabela de alunos, ordenável por frequência, média e dúvidas.',
    icon: Users,
    defaultSize: { w: 12, h: 7, minW: 6, minH: 4 },
  },
  {
    kind: 'atencao',
    title: 'Precisam de Atenção',
    description: 'Quem está com dúvidas abertas ou frequência abaixo de 70%.',
    icon: TrendingUp,
    defaultSize: { w: 6, h: 5, minW: 4, minH: 3 },
  },
]

const BY_KIND = new Map(WIDGET_CATALOG.map((definition) => [definition.kind, definition]))

export function widgetDefinition(kind: WidgetKind): WidgetDefinition | undefined {
  return BY_KIND.get(kind)
}

/** The layout a brand-new panel starts with, when the professor has never customised it. */
export function starterLayout(): WidgetKind[] {
  return WIDGET_CATALOG.filter((definition) => definition.starter).map((definition) => definition.kind)
}
