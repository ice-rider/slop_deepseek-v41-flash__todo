import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  Check,
  GripVertical,
  MoreHorizontal,
  Palette,
  Pencil,
  Target,
  Trash2,
} from 'lucide-react'
import { CardComposer } from '@/components/board/CardComposer'
import { SortableCardTile } from '@/components/board/CardTile'
import { Button, IconButton, Input, Tooltip } from '@/components/ui/primitives'
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator } from '@/components/ui/Popover'
import { ConfirmDialog } from '@/components/ui/Modal'
import { swatchFor, swatchNames } from '@/lib/palette'
import { cn, pluralise } from '@/lib/utils'
import type { Card, Column, Label, Priority } from '@/lib/types'

interface ColumnViewProps {
  column: Column
  /** Cards visible after filtering, already ordered. */
  cards: Card[]
  /** Total cards in the column, including ones hidden by filters. */
  totalCards: number
  labels: Label[]
  memberColors: Record<string, string>
  compact: boolean
  readOnly: boolean
  onCreateCard: (
    columnId: string,
    input: { title: string; description: string; priority: Priority },
  ) => Promise<unknown> | void
  onOpenCard: (cardId: string) => void
  onUpdateColumn: (
    columnId: string,
    patch: Partial<{ title: string; color: string; wipLimit: number; isDone: boolean }>,
  ) => void
  onDeleteColumn: (columnId: string, moveTo?: string) => void
  otherColumns: Column[]
  /** True when the `n` shortcut targeted this column. */
  composerRequested?: boolean
  /** Changes on every request so a repeat press re-opens the composer. */
  composerRequestId?: number
}

export function ColumnView({
  column,
  cards,
  totalCards,
  labels,
  memberColors,
  compact,
  readOnly,
  onCreateCard,
  onOpenCard,
  onUpdateColumn,
  onDeleteColumn,
  otherColumns,
  composerRequested,
  composerRequestId,
}: ColumnViewProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { type: 'column', columnId: column.id } })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(column.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moveTo, setMoveTo] = useState(otherColumns[0]?.id ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const swatch = swatchFor(column.color)
  const overLimit = column.wipLimit > 0 && totalCards > column.wipLimit
  const atLimit = column.wipLimit > 0 && totalCards >= column.wipLimit
  const hiddenCount = Math.max(0, totalCards - cards.length)

  useEffect(() => {
    setTitleDraft(column.title)
  }, [column.title])

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingTitle])

  const commitTitle = () => {
    setEditingTitle(false)
    const next = titleDraft.trim()
    if (next && next !== column.title) onUpdateColumn(column.id, { title: next })
    else setTitleDraft(column.title)
  }

  return (
    <section
      aria-label={`${column.title} column`}
      className={cn(
        'flex max-h-full w-[19rem] shrink-0 snap-start flex-col rounded-panel border bg-surface/70 backdrop-blur-[2px] transition',
        overLimit ? 'border-rose-500/45' : 'border-line',
        isOver && 'border-brand/60 bg-brand-soft/25',
      )}
    >
      <header className="flex items-start gap-2 px-3 pb-2 pt-3">
        <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', swatch.solid)} />

        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <Input
              ref={titleInputRef}
              value={titleDraft}
              aria-label="Column title"
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTitle()
                if (event.key === 'Escape') {
                  setTitleDraft(column.title)
                  setEditingTitle(false)
                }
              }}
              className="h-7 px-1.5 py-0 text-[13.5px] font-semibold"
            />
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setEditingTitle(true)}
              className="group/title flex w-full items-center gap-1.5 text-left"
              title={readOnly ? column.title : 'Rename column'}
            >
              <h3 className="truncate text-[13.5px] font-semibold text-fg">{column.title}</h3>
              {column.isDone ? (
                <Check aria-label="Counts as done" className="size-3.5 shrink-0 text-emerald-500" />
              ) : null}
              {!readOnly ? (
                <Pencil
                  aria-hidden
                  className="size-3 shrink-0 text-subtle opacity-0 transition group-hover/title:opacity-100"
                />
              ) : null}
            </button>
          )}

          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-subtle">
            <span>{pluralise(totalCards, 'card')}</span>
            {hiddenCount > 0 ? <span className="text-amber-600 dark:text-amber-400">· {hiddenCount} hidden</span> : null}
            {column.wipLimit > 0 ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-medium',
                  overLimit
                    ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                    : atLimit
                      ? 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      : 'border-line bg-elevated text-muted',
                )}
                title={`Work-in-progress limit: ${column.wipLimit}`}
              >
                <Target aria-hidden className="size-3" />
                {totalCards}/{column.wipLimit}
              </span>
            ) : null}
          </div>
        </div>

        {!readOnly ? (
          <Popover
            align="end"
            label={`${column.title} options`}
            trigger={({ toggle, ref }) => (
              <IconButton
                ref={ref}
                aria-label={`${column.title} options`}
                onClick={toggle}
                icon={<MoreHorizontal className="size-4" />}
                className="size-7"
              />
            )}
          >
            {({ close }) => (
              <>
                <PopoverLabel>Column</PopoverLabel>
                <PopoverItem
                  icon={<Pencil className="size-3.5" />}
                  onClick={() => {
                    close()
                    setEditingTitle(true)
                  }}
                >
                  Rename
                </PopoverItem>
                <PopoverItem
                  icon={<Check className="size-3.5" />}
                  selected={column.isDone}
                  onClick={() => {
                    close()
                    onUpdateColumn(column.id, { isDone: !column.isDone })
                  }}
                >
                  {column.isDone ? 'Not a done column' : 'Counts as done'}
                </PopoverItem>

                <PopoverSeparator />
                <PopoverLabel>Work-in-progress limit</PopoverLabel>
                <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
                  {[0, 1, 2, 3, 4, 6, 8].map((limit) => (
                    <button
                      key={limit}
                      type="button"
                      onClick={() => {
                        close()
                        onUpdateColumn(column.id, { wipLimit: limit })
                      }}
                      className={cn(
                        'h-6 min-w-7 rounded-md border px-1.5 text-[11.5px] font-medium transition',
                        column.wipLimit === limit
                          ? 'border-brand bg-brand-soft text-fg'
                          : 'border-line bg-elevated text-muted hover:text-fg',
                      )}
                    >
                      {limit === 0 ? '∞' : limit}
                    </button>
                  ))}
                </div>

                <PopoverSeparator />
                <PopoverLabel>Colour</PopoverLabel>
                <div className="flex flex-wrap gap-1.5 px-2.5 pb-1.5 pt-1">
                  {swatchNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-label={name}
                      onClick={() => {
                        close()
                        onUpdateColumn(column.id, { color: name })
                      }}
                      className={cn(
                        'size-5 rounded-full ring-offset-2 ring-offset-surface transition',
                        swatchFor(name).solid,
                        column.color === name ? 'ring-2 ring-fg' : 'hover:scale-110',
                      )}
                    />
                  ))}
                </div>

                <PopoverSeparator />
                <PopoverItem
                  danger
                  icon={<Trash2 className="size-3.5" />}
                  disabled={otherColumns.length === 0}
                  onClick={() => {
                    close()
                    setConfirmDelete(true)
                  }}
                >
                  Delete column
                </PopoverItem>
              </>
            )}
          </Popover>
        ) : null}

        <GripVertical aria-hidden className="mt-1 size-4 text-subtle/60" />
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3',
          cards.length === 0 && 'flex flex-col justify-center',
        )}
      >
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCardTile
              key={card.id}
              card={card}
              labels={labels}
              memberColors={memberColors}
              isDone={column.isDone}
              compact={compact}
              onOpen={onOpenCard}
            />
          ))}
        </SortableContext>

        {cards.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-subtle">
            {totalCards > 0
              ? `${pluralise(totalCards, 'card')} hidden by filters`
              : 'Drop a card here or add one below'}
          </p>
        ) : null}
      </div>

      {!readOnly ? (
        <div className="border-t border-line/70 p-2.5">
          {atLimit && !overLimit ? (
            <Tooltip label={`WIP limit of ${column.wipLimit} reached — raise it to add more`}>
              <p className="flex w-full items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
                <Target aria-hidden className="size-3.5" />
                At the WIP limit
              </p>
            </Tooltip>
          ) : (
            <CardComposer
              columnTitle={column.title}
              requestId={composerRequested ? composerRequestId : undefined}
              onSubmit={(input) => onCreateCard(column.id, input)}
            />
          )}
        </div>
      ) : null}

      {!readOnly && otherColumns.length > 0 ? (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete “${column.title}”?`}
          description={
            totalCards > 0
              ? `${pluralise(totalCards, 'card')} will move to the column you pick. This cannot be undone.`
              : 'This column is empty and will be removed. This cannot be undone.'
          }
          confirmLabel="Delete column"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            onDeleteColumn(column.id, totalCards > 0 ? moveTo : undefined)
            setConfirmDelete(false)
          }}
        >
          {totalCards > 0 ? (
            <div className="mt-3 space-y-2">
              <label htmlFor={`move-${column.id}`} className="text-[13px] font-medium text-muted">
                Move cards to
              </label>
              <div className="flex flex-wrap gap-1.5" id={`move-${column.id}`}>
                {otherColumns.map((target) => (
                  <Button
                    key={target.id}
                    size="sm"
                    variant={moveTo === target.id ? 'primary' : 'secondary'}
                    icon={<Palette className="size-3.5" />}
                    onClick={() => setMoveTo(target.id)}
                  >
                    {target.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  )
}
