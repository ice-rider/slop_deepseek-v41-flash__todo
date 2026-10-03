import { CalendarDays, CheckCircle2, ListChecks, MessageSquare } from 'lucide-react'
import { Avatar, EmptyState } from '@/components/ui/primitives'
import { priorityMetaFor, swatchFor } from '@/lib/palette'
import { cn, dueMeta, percent } from '@/lib/utils'
import type { Card, Label, SearchHit } from '@/lib/types'

function isSearchHit(card: Card | SearchHit): card is SearchHit {
  return 'boardTitle' in card
}

export interface CardListProps {
  items: Array<Card | SearchHit>
  labels?: Label[]
  memberColors?: Record<string, string>
  emptyTitle?: string
  emptyDescription?: string
  onOpen: (cardId: string) => void
  /** Show the board and column for cross-board lists. */
  showContext?: boolean
}

/**
 * Dense, scannable list used by the board's list view, global search and
 * "My work" — the same row anatomy in every context so it reads consistently.
 */
export function CardList({
  items,
  labels = [],
  memberColors = {},
  emptyTitle = 'Nothing here',
  emptyDescription,
  onOpen,
  showContext = false,
}: CardListProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {items.map((card) => {
        const priority = priorityMetaFor(card.priority)
        const due = dueMeta(card.dueDate, Boolean(card.completedAt))
        const checklist = card.checklist ?? { total: 0, done: 0 }
        const cardLabels = labels.filter((label) => (card.labelIds ?? []).includes(label.id))
        const context = isSearchHit(card) ? card : null
        const done = Boolean(card.completedAt) || Boolean(context?.columnIsDone)

        return (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => onOpen(card.id)}
              className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-elevated"
            >
              <span aria-hidden className={cn('mt-1 h-8 w-[3px] shrink-0 rounded-full', priority.bar)} />

              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="flex items-center gap-2">
                  {done ? <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-500" /> : null}
                  <span
                    className={cn(
                      'min-w-0 truncate text-[13.5px] font-medium text-fg',
                      done && 'text-muted line-through decoration-[1.5px]',
                    )}
                  >
                    {card.title}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-1.5">
                  {showContext && context ? (
                    <>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium',
                          swatchFor(context.boardColor).soft,
                          swatchFor(context.boardColor).text,
                          swatchFor(context.boardColor).border,
                        )}
                      >
                        {context.boardTitle}
                      </span>
                      <span className="text-[11px] text-subtle">{context.columnTitle}</span>
                    </>
                  ) : null}

                  {cardLabels.slice(0, 3).map((label) => {
                    const swatch = swatchFor(label.color)
                    return (
                      <span
                        key={label.id}
                        className={cn(
                          'inline-flex rounded-full border px-1.5 py-px text-[10.5px] font-medium',
                          swatch.soft,
                          swatch.text,
                          swatch.border,
                        )}
                      >
                        {label.name}
                      </span>
                    )
                  })}

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
                    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-px text-[11px] text-muted">
                      <ListChecks aria-hidden className="size-3" />
                      {checklist.done}/{checklist.total} · {percent(checklist.done, checklist.total)}%
                    </span>
                  ) : null}

                  {card.commentCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-px text-[11px] text-muted">
                      <MessageSquare aria-hidden className="size-3" />
                      {card.commentCount}
                    </span>
                  ) : null}

                  <span
                    className={cn(
                      'rounded-md border px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide',
                      priority.chip,
                    )}
                  >
                    {priority.label}
                  </span>
                </span>
              </span>

              <span className="mt-0.5 shrink-0">
                {card.assigneeId ? (
                  <Avatar
                    name={card.assigneeName || 'Assigned'}
                    color={memberColors[card.assigneeId] ?? '#64748b'}
                    size="sm"
                    title={card.assigneeName}
                  />
                ) : (
                  <span className="text-[11px] text-subtle">Unassigned</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
