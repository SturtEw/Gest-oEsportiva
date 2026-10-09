/**
 * Maps a widget instance to its rendered body.
 *
 * The renderer is the only place that knows about *both* the layout vocabulary
 * (WidgetKind) and the React components, so the two stay in sync through the catalog:
 * a kind missing here will not type-check against `widgetDefinition`.
 */
import type { WidgetKind } from '../layout-types'
import type { TeacherOverview } from '@/lib/types'
import {
  AlunosWidget, AtencaoWidget, AtalhosWidget, AulasHojeWidget, LembretesWidget,
  ModalidadesWidget, ProximasAulasWidget, TurmasWidget,
} from './widgets'

export interface WidgetRenderContext {
  overview: TeacherOverview | null
  onOpenStudent?: (id: string) => void
  onSchedule: () => void
  onNavigate?: (view: string) => void
}

export function renderWidgetBody(kind: WidgetKind, context: WidgetRenderContext) {
  switch (kind) {
    case 'aulas_hoje':
      return <AulasHojeWidget overview={context.overview} onSchedule={context.onSchedule} />
    case 'proximas_aulas':
      return <ProximasAulasWidget overview={context.overview} />
    case 'modalidades':
      return <ModalidadesWidget overview={context.overview} />
    case 'turmas':
      return <TurmasWidget overview={context.overview} />
    case 'alunos':
      return <AlunosWidget overview={context.overview} onOpenStudent={context.onOpenStudent} />
    case 'atencao':
      return <AtencaoWidget overview={context.overview} onOpenStudent={context.onOpenStudent} />
    case 'atalhos':
      return <AtalhosWidget onNavigate={context.onNavigate} />
    case 'lembretes':
      return <LembretesWidget overview={context.overview} onNavigate={context.onNavigate} />
    default: {
      // Exhaustiveness: adding a WidgetKind without a case here fails the build.
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
