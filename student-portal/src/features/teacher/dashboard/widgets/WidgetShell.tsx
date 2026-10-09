/**
 * Chrome shared by every dashboard widget.
 *
 * A widget fills the box react-grid-layout gives it, so the shell owns exactly the
 * concerns that come with that: a fixed header, a body that scrolls instead of
 * overflowing when the card is smaller than its content, and the edit-mode affordances
 * (the remove button and the drag handle).
 *
 * During edit mode `react-grid-layout` needs a draggable handle. We only make the header
 * the handle — a whole-card handle would swallow taps meant for links inside the body.
 */
import type { ComponentType, ReactNode } from 'react'
import { GripVertical, X } from 'lucide-react'
import { cn } from 'cn'

export function WidgetShell({
  title,
  description,
  icon: Icon,
  editing,
  onRemove,
  headerAction,
  children,
  className,
}: {
  title: string
  description?: string
  // Loose enough to accept either a lucide component or a custom one, which is what
  // the catalog hands over.
  icon?: ComponentType<{ className?: string }>
  editing?: boolean
  onRemove?: () => void
  headerAction?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border',
        // A visible ring while editing tells the professor which boxes are movable
        // without changing any content.
        editing && 'ring-2 ring-primary/40',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b border-border/70 px-4 py-3',
          // The handle class is what react-grid-layout listens to for dragging.
          editing && 'widget-drag-handle cursor-grab active:cursor-grabbing',
        )}
      >
        {editing ? <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-extrabold text-foreground">{title}</h3>
          {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {!editing ? headerAction : null}
        {editing && onRemove ? (
          <button
            type="button"
            // Stop the pointer from starting a drag when the intent was to remove.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            aria-label={`Remover widget ${title}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {/* min-h-0 is required for overflow to work inside a flex column: without it the
          child refuses to shrink below its content height and the card grows. */}
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </div>
  )
}

/** Neutral, dashed empty state shared by the list widgets. */
export function WidgetEmpty({ icon: Icon, title, hint }: { icon: ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
