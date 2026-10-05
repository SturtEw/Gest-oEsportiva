import type { ComponentType, ReactNode } from 'react'

interface PageHeadingProps {
  /** Small uppercase label above the title, e.g. "Seus registros". */
  eyebrow: string
  title: string
  description?: ReactNode
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  /** Buttons aligned to the right of the title on wide screens. */
  actions?: ReactNode
  /** Lets a wrapping <section aria-labelledby> point at the title. */
  id?: string
  as?: 'h1' | 'h2'
}

/** Page title block shared by the portal areas (eyebrow + title + description). */
export function PageHeading({ eyebrow, title, description, icon: Icon, actions, id, as: Heading = 'h2' }: PageHeadingProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
          {eyebrow}
        </p>
        <Heading id={id} className="type-title mt-2 text-2xl font-extrabold leading-tight text-heading sm:text-3xl">
          {title}
        </Heading>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
