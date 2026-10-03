import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  CalendarClock,
  Clock,
  Columns3,
  Eye,
  Hash,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Type,
} from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Button, IconButton, Skeleton, Textarea } from '@/components/ui/primitives'
import { ActivityFeed, ChecklistPanel, CommentsPanel, PanelHeading } from '@/components/board/CardPanels'
import { Markdown } from '@/components/board/Markdown'
import {
  AssigneePicker,
  CardLabelChips,
  CoverColorPicker,
  DueDatePicker,
  LabelPicker,
  PriorityPicker,
} from '@/components/board/pickers'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useCardDetail } from '@/hooks/queries'
import {
  useChecklistMutations,
  useCommentMutations,
  useCreateLabel,
  useDeleteCard,
  usePatchCard,
  useToggleCardLabel,
} from '@/hooks/mutations'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import type { Column, Label, Member, Priority } from '@/lib/types'

interface CardDrawerProps {
  boardId: string
  cardId: string | null
  columns: Column[]
  members: Member[]
  labels: Label[]
  currentUserId?: string
  readOnly: boolean
  onClose: () => void
  onManageLabels?: () => void
  /** Move the card to the board's done column (used by the `d` shortcut). */
  doneColumnId?: string
}

const DESCRIPTION_DEBOUNCE_MS = 1200

export function CardDrawer({
  boardId,
  cardId,
  columns,
  members,
  labels,
  currentUserId,
  readOnly,
  onClose,
  onManageLabels,
  doneColumnId,
}: CardDrawerProps) {
  const client = useQueryClient()
  const { data: card, isLoading, isError } = useCardDetail(cardId)
  const patchCard = usePatchCard(boardId)
  const toggleLabel = useToggleCardLabel(boardId)
  const deleteCard = useDeleteCard(boardId)
  const createLabel = useCreateLabel(boardId)

  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [previewDescription, setPreviewDescription] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const descriptionTimer = useRef<number | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const checklist = useChecklistMutations(boardId, cardId ?? '')
  const comments = useCommentMutations(boardId, cardId ?? '')

  const moveMutation = useMutation({
    mutationFn: ({ targetColumnId }: { targetColumnId: string }) =>
      api.moveCard(cardId as string, targetColumnId, Number.MAX_SAFE_INTEGER),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: queryKeys.card(cardId ?? '') })
      client.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  // Reset drafts whenever a different card is opened.
  useEffect(() => {
    if (!card) return
    setTitleDraft(card.title)
    setDescriptionDraft(card.description)
    setPreviewDescription(false)
  }, [card?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (descriptionTimer.current) window.clearTimeout(descriptionTimer.current)
    }
  }, [])

  // Keep the single-line-looking title textarea exactly as tall as its content.
  useEffect(() => {
    const element = titleRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [titleDraft])

  const saveTitle = useCallback(() => {
    if (!card) return
    const next = titleDraft.trim()
    if (!next) {
      setTitleDraft(card.title)
      return
    }
    if (next !== card.title) patchCard.mutate({ id: card.id, title: next })
  }, [card, titleDraft, patchCard])

  const saveDescription = useCallback(
    (value: string) => {
      if (!card) return
      if (value === card.description) return
      patchCard.mutate({ id: card.id, description: value })
    },
    [card, patchCard],
  )

  const scheduleDescriptionSave = useCallback(
    (value: string) => {
      if (descriptionTimer.current) window.clearTimeout(descriptionTimer.current)
      descriptionTimer.current = window.setTimeout(() => saveDescription(value), DESCRIPTION_DEBOUNCE_MS)
    },
    [saveDescription],
  )

  const column = useMemo(() => columns.find((item) => item.id === card?.columnId), [columns, card?.columnId])
  const doneColumn = useMemo(() => columns.find((item) => item.id === doneColumnId), [columns, doneColumnId])
  const isInDoneColumn = Boolean(column?.isDone)

  if (!cardId) return null

  const header = (
    <Drawer
      open
      onClose={onClose}
      label="Card details"
      title={
        <span className="flex items-center gap-1.5">
          <Hash aria-hidden className="size-3.5" />
          {card ? card.board.title : 'Card'}
        </span>
      }
      subtitle={
        card ? (
          <span className="flex items-center gap-2">
            <span>{card.column.title}</span>
            <span aria-hidden>·</span>
            <span>updated {formatRelative(card.updatedAt)}</span>
          </span>
        ) : null
      }
      headerExtra={
        card && !readOnly ? (
          <>
            <IconButton
              aria-label={card.archived ? 'Restore card' : 'Archive card'}
              title={card.archived ? 'Restore card' : 'Archive card'}
              icon={card.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              onClick={() => patchCard.mutate({ id: card.id, archived: !card.archived })}
            />
            <IconButton
              aria-label="Delete card"
              title="Delete card permanently"
              className="text-rose-600 dark:text-rose-400"
              icon={<Trash2 className="size-4" />}
              onClick={() => setConfirmDelete(true)}
            />
          </>
        ) : null
      }
    >
      {isLoading || !card ? (
        isError ? (
          <div className="p-6 text-center text-[13px] text-muted">
            This card could not be loaded. It may have been deleted.
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )
      ) : (
        <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          {/* Main column */}
          <div className="min-w-0 space-y-6">
            <div className="space-y-3">
              <textarea
                ref={titleRef}
                value={titleDraft}
                readOnly={readOnly}
                rows={1}
                aria-label="Card title"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                  if (event.key === 'Escape') {
                    setTitleDraft(card.title)
                    event.currentTarget.blur()
                  }
                }}
                className={cn(
                  'w-full resize-none overflow-hidden rounded-lg border border-transparent bg-transparent px-2 py-1 -ml-2 text-[19px] font-semibold leading-snug text-fg',
                  'transition hover:border-line focus:border-brand focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[var(--ring)]',
                  readOnly && 'pointer-events-none',
                )}
              />

              <CardLabelChips
                labels={card.labels}
                readOnly={readOnly}
                onRemove={(labelId) => toggleLabel.mutate({ cardId: card.id, labelId, attached: true })}
              />
            </div>

            {/* Description */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Pencil aria-hidden className="size-4 text-muted" />
                <h3 className="text-[13px] font-semibold text-fg">Description</h3>
                <span className="ml-auto flex items-center gap-1">
                  {patchCard.isPending ? (
                    <span className="flex items-center gap-1 text-[11.5px] text-subtle">
                      <Loader2 aria-hidden className="size-3 animate-spin" />
                      Saving
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Eye className="size-3.5" />}
                    onClick={() => setPreviewDescription((value) => !value)}
                  >
                    {previewDescription ? 'Edit' : 'Preview'}
                  </Button>
                </span>
              </div>

              {previewDescription ? (
                card.description.trim() ? (
                  <Markdown className="rounded-xl border border-line bg-elevated/40 px-3 py-2.5">
                    {card.description}
                  </Markdown>
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[12.5px] text-subtle">
                    Nothing to preview yet.
                  </p>
                )
              ) : (
                <Textarea
                  value={descriptionDraft}
                  readOnly={readOnly}
                  rows={6}
                  aria-label="Card description"
                  placeholder="Add context, acceptance criteria, links… Markdown is supported."
                  onChange={(event) => {
                    setDescriptionDraft(event.target.value)
                    scheduleDescriptionSave(event.target.value)
                  }}
                  onBlur={(event) => {
                    if (descriptionTimer.current) window.clearTimeout(descriptionTimer.current)
                    saveDescription(event.target.value)
                  }}
                  className="text-[13.5px]"
                />
              )}
            </section>

            <ChecklistPanel
              items={card.checklist}
              readOnly={readOnly}
              busy={checklist.add.isPending || checklist.update.isPending || checklist.remove.isPending}
              onAdd={(text) => checklist.add.mutate(text)}
              onToggle={(itemId, done) => checklist.update.mutate({ itemId, done })}
              onRename={(itemId, text) => checklist.update.mutate({ itemId, text })}
              onDelete={(itemId) => checklist.remove.mutate(itemId)}
            />

            <CommentsPanel
              comments={card.comments}
              currentUserId={currentUserId}
              readOnly={readOnly}
              busy={comments.add.isPending}
              onAdd={(body) => comments.add.mutateAsync(body)}
              onEdit={(commentId, body) => comments.update.mutate({ commentId, body })}
              onDelete={(commentId) => comments.remove.mutate(commentId)}
            />
          </div>

          {/* Sidebar */}
          <aside className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Properties</h3>
              <div className="flex flex-wrap gap-1.5">
                <AssigneePicker
                  members={members}
                  value={card.assigneeId}
                  readOnly={readOnly}
                  onChange={(userId) => patchCard.mutate({ id: card.id, assigneeId: userId })}
                />
                <PriorityPicker
                  value={card.priority as Priority}
                  readOnly={readOnly}
                  onChange={(priority) => patchCard.mutate({ id: card.id, priority })}
                />
                <DueDatePicker
                  value={card.dueDate}
                  readOnly={readOnly}
                  onChange={(value) => patchCard.mutate({ id: card.id, dueDate: value })}
                />
                <LabelPicker
                  labels={labels}
                  selectedIds={card.labels.map((label) => label.id)}
                  readOnly={readOnly}
                  onToggle={(labelId, attached) => toggleLabel.mutate({ cardId: card.id, labelId, attached })}
                  onCreate={(name, color) => createLabel.mutate({ name, color })}
                  onManage={onManageLabels}
                />
                <CoverColorPicker
                  value={card.coverColor}
                  readOnly={readOnly}
                  onChange={(color) => patchCard.mutate({ id: card.id, coverColor: color })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Column</h3>
              <div className="space-y-1">
                {columns.map((option) => {
                  const active = option.id === card.columnId
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={readOnly || active || moveMutation.isPending}
                      onClick={() => moveMutation.mutate({ targetColumnId: option.id })}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition',
                        active
                          ? 'border-brand/50 bg-brand-soft font-medium text-fg'
                          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
                        'disabled:cursor-default',
                      )}
                    >
                      <Columns3 aria-hidden className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{option.title}</span>
                      {active ? <span className="text-[10.5px] uppercase tracking-wide text-subtle">Current</span> : null}
                    </button>
                  )
                })}
              </div>
              {!readOnly && doneColumn && !isInDoneColumn ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  icon={<ArrowRight className="size-3.5" />}
                  onClick={() => moveMutation.mutate({ targetColumnId: doneColumn.id })}
                >
                  Move to {doneColumn.title}
                </Button>
              ) : null}
            </div>

            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Details</h3>
              <dl className="space-y-1.5 text-[12px]">
                <div className="flex items-center gap-2 text-muted">
                  <CalendarClock aria-hidden className="size-3.5 shrink-0" />
                  <dt className="sr-only">Created</dt>
                  <dd>Created {formatDateTime(card.createdAt)}</dd>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Clock aria-hidden className="size-3.5 shrink-0" />
                  <dt className="sr-only">Updated</dt>
                  <dd>Updated {formatRelative(card.updatedAt)}</dd>
                </div>
                {card.completedAt ? (
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <Save aria-hidden className="size-3.5 shrink-0" />
                    <dt className="sr-only">Completed</dt>
                    <dd>Completed {formatDateTime(card.completedAt)}</dd>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-muted">
                  <Type aria-hidden className="size-3.5 shrink-0" />
                  <dt className="sr-only">Card id</dt>
                  <dd className="truncate font-mono text-[11px]">{card.id.slice(0, 8)}</dd>
                </div>
              </dl>
            </div>

            <div className="space-y-2">
              <PanelHeading icon={<Clock className="size-4" />} title="Activity" count={card.activity.length} />
              <ActivityFeed activity={card.activity.slice(0, 12)} />
            </div>
          </aside>
        </div>
      )}
    </Drawer>
  )

  return (
    <>
      {header}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this card permanently?"
        description="Archiving keeps the card and its history. Deleting removes it for everyone and cannot be undone."
        confirmLabel="Delete permanently"
        loading={deleteCard.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (card) deleteCard.mutate({ cardId: card.id, hard: true })
          setConfirmDelete(false)
          onClose()
        }}
      />
    </>
  )
}
