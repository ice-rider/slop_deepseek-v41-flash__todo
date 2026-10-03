import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, CheckCircle2, Circle, ListChecks, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/primitives'
import { priorityMetaFor, swatchFor } from '@/lib/palette'
import { cn, dueMeta, truncate } from '@/lib/utils'
import type { Card, Label } from '@/lib/types'

export interface CardTileProps {
  card: Card
  labels: Label[]
  /** userId -> avatar colour, taken from the board member list. */
  memberColors?: Record<string, string>
  /** Rendered inside a DragOverlay: no sorting hooks, slight lift. */
  overlay?: boolean
  isDone?: boolean
  compact?: boolean
  onOpen?: (cardId: string) => void
  /** Keyboard hint shown when the tile has focus. */
  focused?: boolean
}

function CardTileInner({ card, labels, memberColors, overlay, isDone, compact, focused }: CardTileProps) {
  const priority = priorityMetaFor(card.priority)
  const due = dueMeta(card.dueDate, Boolean(card.completedAt))
  const checklist = card.checklist ?? { total: 0, done: 0 }
  const cardLabels = labels.filter((label) => (card.labelIds ?? []).includes(label.id))
  const completed = Boolean(card.completedAt) || isDone

  return (
    <article
      aria-label={card.title}
      className={cn(
        'group/card relative w-full overflow-hidden rounded-card border border-line bg-surface text-left transition',
        'hover:border-line-strong hover:shadow-soft',
        overlay ? 'rotate-[1.2deg] cursor-grabbing shadow-lift ring-2 ring-[var(--ring)]' : 'cursor-grab',
        focused && 'ring-2 ring-[var(--ring)]',
        compact ? 'p-2.5' : 'p-3',
      )}
    >
      {card.coverColor ? (
        <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', swatchFor(card.coverColor).solid)} />
      ) : null}

      {/* Priority is signalled by a thin edge bar so it reads at a glance. */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', priority.bar)} />

      <div className={cn('space-y-2', card.coverColor && 'pt-1')}>
        {cardLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {cardLabels.slice(0, 4).map((label) => {
              const swatch = swatchFor(label.color)
              return (
                <span
                  key={label.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-medium',
                    swatch.soft,
                    swatch.text,
                    swatch.border,
                  )}
                >
                  {label.name}
                </span>
              )
            })}
            {cardLabels.length > 4 ? (
              <span className="self-center text-[10.5px] text-subtle">+{cardLabels.length - 4}</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-start gap-2">
          {completed ? (
            <CheckCircle2 aria-label="Completed" className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          ) : null}
          <h4
            className={cn(
              'min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-fg',
              completed && 'text-muted line-through decoration-[1.5px]',
            )}
          >
            {card.title}
          </h4>
        </div>

        {!compact && card.description.trim() ? (
          <p className="line-clamp-2 pl-0 text-[12.5px] leading-relaxed text-muted">
            {truncate(
              card.description
                .replace(/```[\s\S]*?```/g, ' ')
                .replace(/[#*_>`~[\]()!-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
              140,
            )}
          </p>
        ) : null}

        {(due || checklist.total > 0 || card.commentCount > 0 || card.assigneeId) && (
          <footer className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {due ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium',
                  due.className,
                )}
              >
                <CalendarDays aria-hidden className="size-3" />
                {due.label}
              </span>
            ) : null}

            {checklist.total > 0 ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium',
                  checklist.done === checklist.total
                    ? 'border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : 'border-line bg-elevated text-muted',
                )}
              >
                <ListChecks aria-hidden className="size-3" />
                {checklist.done}/{checklist.total}
              </span>
            ) : null}

            {card.commentCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-px text-[11px] font-medium text-muted">
                <MessageSquare aria-hidden className="size-3" />
                {card.commentCount}
              </span>
            ) : null}

            <span className="ml-auto flex items-center gap-1.5">
              <span
                className={cn(
                  'rounded-md border px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide',
                  priority.chip,
                )}
                title={`${priority.label} priority`}
              >
                {priority.label}
              </span>
              {card.assigneeId ? (
                <Avatar
                  name={card.assigneeName || 'Assigned'}
                  color={memberColors?.[card.assigneeId] ?? '#64748b'}
                  size="xs"
                  title={card.assigneeName}
                />
              ) : null}
            </span>
          </footer>
        )}
      </div>
    </article>
  )
}

/** Presentational tile, reused by the drag overlay. */
export const CardTile = memo(CardTileInner)

/** Sortable wrapper: adds drag handles and keyboard semantics. */
export function SortableCardTile({
  card,
  labels,
  memberColors,
  isDone,
  compact,
  onOpen,
  disabled,
}: CardTileProps & { disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
    data: { type: 'card', columnId: card.columnId },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('touch-none', isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
      onClick={() => {
        // PointerSensor uses a distance threshold, so a plain click still lands.
        if (!isDragging) onOpen?.(card.id)
      }}
    >
      <CardTile card={card} labels={labels} memberColors={memberColors} isDone={isDone} compact={compact} />
    </div>
  )
}

/** Small helper used by empty-column states. */
export function EmptyCardGlyph() {
  return <Circle aria-hidden className="size-3.5 text-subtle" />
}
