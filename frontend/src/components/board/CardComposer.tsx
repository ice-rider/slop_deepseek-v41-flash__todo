import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Loader2, Plus, X } from 'lucide-react'
import { IconButton, Textarea } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import type { Priority } from '@/lib/types'
import { priorityMeta } from '@/lib/palette'

interface CardComposerProps {
  columnTitle: string
  onSubmit: (input: { title: string; description: string; priority: Priority }) => Promise<unknown> | void
  onCancel?: () => void
  /** Start open (used when `n` is pressed). */
  autoFocus?: boolean
  /** Changing this value re-opens the composer, so `n` works repeatedly. */
  requestId?: number
  variant?: 'inline' | 'button'
}

/**
 * Inline "add card" affordance.
 *
 * Enter saves and keeps the composer open for the next card — the fastest path
 * for brain-dumping a backlog — while Shift+Enter inserts a newline and Escape
 * closes. A live priority cycle lets you capture urgency without a second step.
 */
export function CardComposer({
  columnTitle,
  onSubmit,
  onCancel,
  autoFocus,
  requestId,
  variant = 'inline',
}: CardComposerProps) {
  const [open, setOpen] = useState(Boolean(autoFocus))
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>(1)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  // A new request id means "open me", even if the composer was closed before.
  useEffect(() => {
    if (requestId) setOpen(true)
  }, [requestId])

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onSubmit({ title: trimmed, description: '', priority })
      setTitle('')
      setPriority(1)
      textareaRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    setOpen(false)
    setTitle('')
    setPriority(1)
    onCancel?.()
  }

  if (!open) {
    if (variant === 'button') {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-medium text-muted transition hover:bg-elevated hover:text-fg"
        >
          <Plus aria-hidden className="size-4" />
          Add card
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center gap-2 rounded-card border border-dashed border-line px-3 py-2.5 text-[13px] font-medium text-muted transition',
          'hover:border-brand/50 hover:bg-brand-soft/40 hover:text-fg',
        )}
      >
        <Plus aria-hidden className="size-4" />
        Add a card to {columnTitle}
      </button>
    )
  }

  return (
    <div className="rounded-card border border-brand/40 bg-surface p-2.5 shadow-soft">
      <Textarea
        ref={textareaRef}
        value={title}
        rows={2}
        placeholder={`What needs doing in ${columnTitle}?`}
        aria-label={`New card title for ${columnTitle}`}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        className="min-h-0 border-0 bg-transparent p-0 text-[13.5px] shadow-none focus:ring-0"
      />

      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Priority">
          {([0, 1, 2, 3] as Priority[]).map((value) => {
            const meta = priorityMeta[value]
            const active = priority === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${meta.label} priority`}
                title={`${meta.label} priority`}
                onClick={() => setPriority(value)}
                className={cn(
                  'h-6 rounded-md border px-1.5 text-[10.5px] font-semibold uppercase tracking-wide transition',
                  active ? meta.chip : 'border-line bg-elevated text-subtle hover:text-muted',
                )}
              >
                {meta.label.slice(0, 3)}
              </button>
            )
          })}
        </div>

        <span className="ml-auto hidden items-center gap-1 text-[11px] text-subtle sm:flex">
          <CornerDownLeft aria-hidden className="size-3" />
          to save
        </span>
        <IconButton aria-label="Cancel" onClick={close} icon={<X className="size-4" />} />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || saving}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition',
            'bg-brand text-brand-fg disabled:pointer-events-none disabled:opacity-45',
          )}
        >
          {saving ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
          Add
        </button>
      </div>
    </div>
  )
}
