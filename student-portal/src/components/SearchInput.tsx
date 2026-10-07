import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  className?: string
}

/** Small filter field used inside teacher sections. Controlled; clearable. */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', label = 'Filtrar lista', className }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        role="searchbox"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl bg-background pr-9 pl-9"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Case/accent-insensitive "contains" test used by the filter helpers. */
export function matchesQuery(text: string | null | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('pt-BR')
  if (!needle) return true
  const haystack = (text ?? '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return haystack.includes(needle.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}
