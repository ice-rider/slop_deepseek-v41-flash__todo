import { useCallback, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, LayoutGrid, List, Star, Target, Users } from 'lucide-react'
import { BoardCanvas } from '@/components/board/BoardCanvas'
import { BoardToolbar } from '@/components/board/BoardToolbar'
import { CardDrawer } from '@/components/board/CardDrawer'
import { CardList } from '@/components/board/CardList'
import { LabelManagerDialog } from '@/components/board/LabelManagerDialog'
import { ColumnCreateDialog } from '@/components/board/dialogs'
import { Button, EmptyState, IconButton, Skeleton } from '@/components/ui/primitives'
import { useBoard } from '@/hooks/queries'
import {
  useCreateCard,
  useCreateColumn,
  useCreateLabel,
  useDeleteColumn,
  useDeleteLabel,
  useMoveCard,
  useReorderBoard,
  useUpdateBoard,
  useUpdateColumn,
  useUpdateLabel,
} from '@/hooks/mutations'
import { useHotkeys, type HotkeyDefinition } from '@/hooks/useHotkeys'
import { ApiError } from '@/lib/api'
import { matchesFilters, sortCards } from '@/lib/board'
import { emptyFilters } from '@/lib/types'
import { useAuthStore } from '@/store/auth'
import { useUiStore } from '@/store/ui'
import { cn, pluralise } from '@/lib/utils'
import type { Card, Priority } from '@/lib/types'

/**
 * The board workspace: toolbar, kanban canvas or list view, and the card drawer.
 *
 * The board id comes from the route; the open card lives in the query string so
 * a card can be linked and the browser back button closes the drawer.
 */
export function BoardPage() {
  const { boardId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const openCardId = searchParams.get('card')

  const showArchived = useUiStore((state) => state.showArchived)
  const setShowArchived = useUiStore((state) => state.setShowArchived)
  const boardView = useUiStore((state) => state.boardView)
  const setBoardView = useUiStore((state) => state.setBoardView)
  const compact = useUiStore((state) => state.compactCards)
  const setCompact = useUiStore((state) => state.setCompactCards)
  const allFilters = useUiStore((state) => state.filters)
  const patchFilters = useUiStore((state) => state.patchFilters)
  const resetFilters = useUiStore((state) => state.resetFilters)

  const filters = allFilters[boardId] ?? emptyFilters
  const currentUserId = useAuthStore((state) => state.user?.id)

  const board = useBoard(boardId, showArchived)
  const snapshot = board.data

  const [filtersOpen, setFiltersOpen] = useState(true)
  const [labelManagerOpen, setLabelManagerOpen] = useState(false)
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const [composerTarget, setComposerTarget] = useState<{ columnId: string; requestId: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const reorderBoard = useReorderBoard(boardId)
  const createCard = useCreateCard(boardId)
  const createColumn = useCreateColumn(boardId)
  const updateColumn = useUpdateColumn(boardId)
  const deleteColumn = useDeleteColumn(boardId)
  const updateBoard = useUpdateBoard(boardId)
  const moveCard = useMoveCard(boardId)
  const createLabel = useCreateLabel(boardId)
  const updateLabel = useUpdateLabel(boardId)
  const deleteLabel = useDeleteLabel(boardId)

  const columns = useMemo(
    () => (snapshot?.columns ?? []).slice().sort((a, b) => a.position - b.position),
    [snapshot?.columns],
  )
  const doneColumn = columns.find((column) => column.isDone)
  const openCard = snapshot?.cards.find((card) => card.id === openCardId)

  const memberColors = useMemo(() => {
    const map: Record<string, string> = {}
    for (const member of snapshot?.members ?? []) map[member.userId] = member.avatarColor
    return map
  }, [snapshot?.members])

  const matchedCards = useMemo(() => {
    if (!snapshot) return []
    return snapshot.cards.filter((card) => matchesFilters(card, filters, currentUserId))
  }, [snapshot, filters, currentUserId])

  const setOpenCard = useCallback(
    (cardId: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (cardId) next.set('card', cardId)
      else next.delete('card')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const openComposer = useCallback(
    (columnId?: string) => {
      const target = columnId ?? columns[0]?.id
      if (!target) return
      setComposerTarget({ columnId: target, requestId: Date.now() })
      // The request is a one-shot signal; the composer keeps itself open after.
      window.setTimeout(() => setComposerTarget(null), 600)
    },
    [columns],
  )

  const toggleDone = useCallback(() => {
    if (!openCard || !doneColumn) return
    const target = openCard.columnId === doneColumn.id ? columns[0] : doneColumn
    if (!target) return
    moveCard.mutate(
      { cardId: openCard.id, columnId: target.id, position: Number.MAX_SAFE_INTEGER },
      {
        onSuccess: () =>
          toast.success(openCard.columnId === doneColumn.id ? 'Moved back to the board' : `Moved to ${doneColumn.title}`),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not move the card'),
      },
    )
  }, [openCard, doneColumn, columns, moveCard])

  const hotkeys: HotkeyDefinition[] = [
    {
      id: 'new-card',
      keys: 'n',
      label: 'New card',
      group: 'Board',
      run: () => openComposer(),
    },
    {
      id: 'new-column',
      keys: 'c',
      label: 'New column',
      group: 'Board',
      run: () => setColumnDialogOpen(true),
    },
    {
      id: 'toggle-filters',
      keys: 'f',
      label: 'Toggle filters',
      group: 'Board',
      run: () => setFiltersOpen((value) => !value),
    },
    {
      id: 'toggle-view',
      keys: 'v',
      label: 'Toggle view',
      group: 'Board',
      run: () => setBoardView(boardView === 'board' ? 'list' : 'board'),
    },
    {
      id: 'focus-search',
      keys: '/',
      label: 'Focus search',
      group: 'Board',
      run: () => {
        setFiltersOpen(true)
        window.setTimeout(() => searchRef.current?.focus(), 0)
      },
    },
    {
      id: 'toggle-done',
      keys: 'd',
      label: 'Move the open card to done',
      group: 'Cards',
      enabled: Boolean(openCardId && doneColumn),
      run: () => toggleDone(),
    },
  ]

  useHotkeys(hotkeys)

  if (board.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <div className="flex gap-3">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-96 w-[19rem] rounded-panel" />
          ))}
        </div>
      </div>
    )
  }

  if (board.isError || !snapshot) {
    return (
      <EmptyState
        className="py-24"
        icon={<AlertTriangle className="size-6 text-amber-500" />}
        title="This board is not available"
        description="It may have been deleted, or you may not have access to it."
        action={
          <Button variant="secondary" onClick={() => void board.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const readOnly = snapshot.board.role === 'viewer'
  const overdueCount = snapshot.cards.filter(
    (card) => card.dueDate && !card.completedAt && new Date(card.dueDate).getTime() < Date.now(),
  ).length
  const doneCount = snapshot.cards.filter((card) => Boolean(card.completedAt) || card.columnId === doneColumn?.id).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{snapshot.board.title}</h1>
              <IconButton
                aria-label={snapshot.board.starred ? 'Unstar board' : 'Star board'}
                onClick={() => updateBoard.mutate({ starred: !snapshot.board.starred })}
                icon={
                  <Star
                    className={cn('size-4', snapshot.board.starred && 'fill-amber-400 text-amber-400')}
                  />
                }
              />
              {readOnly ? (
                <span className="rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  Read only
                </span>
              ) : null}
            </div>

            {snapshot.board.description ? (
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{snapshot.board.description}</p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
              <span>{pluralise(snapshot.cards.length, 'card')}</span>
              <span className="flex items-center gap-1">
                <Target aria-hidden className="size-3.5" />
                {doneCount} done
              </span>
              {overdueCount > 0 ? (
                <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                  <AlertTriangle aria-hidden className="size-3.5" />
                  {overdueCount} overdue
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <Users aria-hidden className="size-3.5" />
                {pluralise(snapshot.members.length, 'member')}
              </span>
              <span className="flex items-center gap-1">
                <LayoutGrid aria-hidden className="size-3.5" />
                {pluralise(columns.length, 'column')}
              </span>
            </div>
          </div>
        </div>

        <BoardToolbar
          filters={filters}
          labels={snapshot.labels}
          members={snapshot.members}
          matchCount={matchedCards.length}
          totalCount={snapshot.cards.length}
          view={boardView}
          compact={compact}
          showArchived={showArchived}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          searchRef={searchRef}
          onFiltersChange={(patch) => patchFilters(boardId, patch)}
          onReset={() => resetFilters(boardId)}
          onViewChange={setBoardView}
          onCompactChange={setCompact}
          onShowArchivedChange={setShowArchived}
          onManageLabels={() => setLabelManagerOpen(true)}
        />
      </header>

      <div className="min-h-0 flex-1">
        {boardView === 'board' ? (
          <BoardCanvas
            snapshot={snapshot}
            filters={filters}
            compact={compact}
            readOnly={readOnly}
            currentUserId={currentUserId}
            composerColumnId={composerTarget?.columnId}
            composerRequestId={composerTarget?.requestId}
            onOpenCard={setOpenCard}
            onCreateCard={async (columnId, input) => {
              await createCard.mutateAsync({
                columnId,
                title: input.title,
                description: input.description,
                priority: input.priority as Priority,
              })
            }}
            onUpdateColumn={(columnId, patch) => updateColumn.mutate({ columnId, ...patch })}
            onDeleteColumn={(columnId, moveTo) => {
              deleteColumn.mutate(
                { columnId, moveTo },
                { onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete') },
              )
            }}
            onCreateColumn={() => setColumnDialogOpen(true)}
            onReorder={(payload, handlers) => reorderBoard.mutate(payload, { onError: handlers?.onError })}
          />
        ) : (
          <div className="px-4 pb-6">
            {matchedCards.length === 0 ? (
              <EmptyState
                icon={<List className="size-5" />}
                title="No cards match the current filters"
                description="Clear the filters, or add a card to get things moving."
                action={
                  <Button variant="primary" onClick={() => openComposer()} disabled={readOnly}>
                    Add a card
                  </Button>
                }
              />
            ) : (
              <CardList
                items={sortCards(matchedCards as Card[], filters.sort)}
                labels={snapshot.labels}
                memberColors={memberColors}
                onOpen={setOpenCard}
                emptyTitle="No cards yet"
              />
            )}
          </div>
        )}
      </div>

      <CardDrawer
        boardId={boardId}
        cardId={openCardId}
        columns={columns}
        members={snapshot.members}
        labels={snapshot.labels}
        currentUserId={currentUserId}
        readOnly={readOnly}
        doneColumnId={doneColumn?.id}
        onClose={() => setOpenCard(null)}
        onManageLabels={() => setLabelManagerOpen(true)}
      />

      <LabelManagerDialog
        open={labelManagerOpen}
        labels={snapshot.labels}
        pending={createLabel.isPending}
        onClose={() => setLabelManagerOpen(false)}
        onCreate={(name, color) => createLabel.mutate({ name, color })}
        onUpdate={(labelId, patch) => updateLabel.mutate({ labelId, ...patch })}
        onDelete={(labelId) => deleteLabel.mutate(labelId)}
      />

      <ColumnCreateDialog
        open={columnDialogOpen}
        pending={createColumn.isPending}
        onClose={() => setColumnDialogOpen(false)}
        onSubmit={(input) => {
          createColumn.mutate(input, {
            onSuccess: () => {
              setColumnDialogOpen(false)
              toast.success(`Added ${input.title}`)
            },
            onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not add the column'),
          })
        }}
      />
    </div>
  )
}
