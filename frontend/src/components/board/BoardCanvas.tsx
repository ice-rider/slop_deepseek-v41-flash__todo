import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { ColumnView } from '@/components/board/ColumnView'
import { CardTile } from '@/components/board/CardTile'
import { Button, EmptyState } from '@/components/ui/primitives'
import {
  buildLayout,
  columnOfCard,
  matchesFilters,
  mergeOrder,
  moveAcrossColumns,
  moveWithinColumn,
  type BoardLayout,
} from '@/lib/board'
import { setDragging } from '@/lib/dragState'
import { cn } from '@/lib/utils'
import type { BoardSnapshot, Card, CardFilters, Priority } from '@/lib/types'

interface BoardCanvasProps {
  snapshot: BoardSnapshot
  filters: CardFilters
  compact: boolean
  readOnly: boolean
  currentUserId?: string
  /** Column whose composer should open, plus a token that changes per request. */
  composerColumnId?: string | null
  composerRequestId?: number
  onOpenCard: (cardId: string) => void
  onCreateCard: (
    columnId: string,
    input: { title: string; description: string; priority: Priority },
  ) => Promise<unknown> | void
  onUpdateColumn: (
    columnId: string,
    patch: Partial<{ title: string; color: string; wipLimit: number; isDone: boolean }>,
  ) => void
  onDeleteColumn: (columnId: string, moveTo?: string) => void
  onCreateColumn: () => void
  onReorder: (
    payload: Array<{ id: string; cardIds: string[] }>,
    handlers?: { onError?: (error: unknown) => void },
  ) => void
}

/**
 * The kanban surface.
 *
 * Ordering lives in one `layout` map (columnId -> ordered card ids) that also
 * tracks cards hidden by the active filter. A drag operates on the visible
 * slice and `mergeOrder` folds the result back, so dropping a card never
 * scrambles the cards the user cannot see.
 */
export function BoardCanvas({
  snapshot,
  filters,
  compact,
  readOnly,
  currentUserId,
  composerColumnId,
  composerRequestId,
  onOpenCard,
  onCreateCard,
  onUpdateColumn,
  onDeleteColumn,
  onCreateColumn,
  onReorder,
}: BoardCanvasProps) {
  const columns = useMemo(
    () => snapshot.columns.slice().sort((a, b) => a.position - b.position),
    [snapshot.columns],
  )
  const cardsById = useMemo(() => {
    const map = new Map<string, Card>()
    for (const card of snapshot.cards) map.set(card.id, card)
    return map
  }, [snapshot.cards])
  const memberColors = useMemo(() => {
    const map: Record<string, string> = {}
    for (const member of snapshot.members) map[member.userId] = member.avatarColor
    return map
  }, [snapshot.members])

  const [layout, setLayout] = useState<BoardLayout>(() => buildLayout(columns, snapshot.cards))
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const layoutBeforeDrag = useRef<BoardLayout | null>(null)
  const draggingRef = useRef(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  // Adopt authoritative server state whenever it changes, unless a drag is live.
  useEffect(() => {
    if (draggingRef.current) return
    setLayout(buildLayout(columns, snapshot.cards))
  }, [columns, snapshot.cards])

  useEffect(() => {
    return () => {
      // Never leave the shared drag flag stuck if the board unmounts mid-drag.
      if (draggingRef.current) {
        draggingRef.current = false
        setDragging(false)
      }
    }
  }, [])

  const visibleByColumn = useMemo(() => {
    const out: Record<string, Card[]> = {}
    for (const column of columns) {
      out[column.id] = (layout[column.id] ?? [])
        .map((id) => cardsById.get(id))
        .filter((card): card is Card => Boolean(card))
        .filter((card) => matchesFilters(card, filters, currentUserId))
    }
    return out
  }, [columns, layout, cardsById, filters, currentUserId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const persist = useCallback(
    (next: BoardLayout, onError?: (error: unknown) => void) => {
      const payload = columns.map((column) => ({ id: column.id, cardIds: next[column.id] ?? [] }))
      onReorder(payload, { onError })
    },
    [columns, onReorder],
  )

  const restoreBeforeDrag = useCallback(() => {
    const before = layoutBeforeDrag.current
    if (before) {
      layoutRef.current = before
      setLayout(before)
    }
  }, [])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(String(event.active.id))
    layoutBeforeDrag.current = layoutRef.current
    draggingRef.current = true
    setDragging(true)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || readOnly) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const current = layoutRef.current
    const fromColumn = columnOfCard(current, activeId)
    const toColumn = over.data.current?.type === 'column' ? overId : columnOfCard(current, overId)
    if (!fromColumn || !toColumn || fromColumn === toColumn) return

    const next = moveAcrossColumns(current, activeId, fromColumn, toColumn, overId === toColumn ? null : overId)
    layoutRef.current = next
    setLayout(next)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const activeId = String(active.id)

    setActiveCardId(null)
    draggingRef.current = false
    setDragging(false)

    if (!over) {
      restoreBeforeDrag()
      return
    }

    const current = layoutRef.current
    const overId = String(over.id)
    const columnId = columnOfCard(current, activeId)
    const moved = columnId && overId !== columnId ? moveWithinColumn(current, columnId, activeId, overId) : current

    // Fold the visible ordering back into the full ordering. For columns the
    // drag did not touch this is the identity operation.
    const merged: BoardLayout = {}
    for (const column of columns) {
      const visible = (visibleByColumn[column.id] ?? []).map((card) => card.id)
      merged[column.id] = mergeOrder(moved[column.id] ?? [], visible)
    }

    layoutRef.current = merged
    setLayout(merged)

    const before = layoutBeforeDrag.current
    if (before && sameOrder(before, merged)) return

    persist(merged, restoreBeforeDrag)
  }

  const handleDragCancel = () => {
    setActiveCardId(null)
    draggingRef.current = false
    setDragging(false)
    restoreBeforeDrag()
  }

  const activeCard = activeCardId ? cardsById.get(activeCardId) : undefined

  if (columns.length === 0) {
    return (
      <EmptyState
        icon={<SlidersHorizontal className="size-6" />}
        title="This board has no columns yet"
        description="Columns are the stages your work moves through. Add the first one to get started."
        action={
          readOnly ? null : (
            <Button variant="primary" onClick={onCreateColumn} icon={<Plus className="size-4" />}>
              Add a column
            </Button>
          )
        }
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={cn('scroll-x flex h-full min-h-0 items-start gap-3 px-4 pb-4 pt-1')}>
        {columns.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            cards={visibleByColumn[column.id] ?? []}
            totalCards={(layout[column.id] ?? []).length}
            labels={snapshot.labels}
            memberColors={memberColors}
            compact={compact}
            readOnly={readOnly}
            onOpenCard={onOpenCard}
            onCreateCard={onCreateCard}
            onUpdateColumn={onUpdateColumn}
            onDeleteColumn={onDeleteColumn}
            otherColumns={columns.filter((other) => other.id !== column.id)}
            composerRequested={composerColumnId === column.id}
            composerRequestId={composerColumnId === column.id ? composerRequestId : undefined}
          />
        ))}

        {!readOnly ? (
          <div className="flex w-[16rem] shrink-0 snap-start items-start pt-1">
            <button
              type="button"
              onClick={onCreateColumn}
              className="flex w-full items-center justify-center gap-2 rounded-panel border border-dashed border-line px-4 py-3 text-[13px] font-medium text-muted transition hover:border-brand/50 hover:bg-brand-soft/30 hover:text-fg"
            >
              <Plus aria-hidden className="size-4" />
              Add column
            </button>
          </div>
        ) : null}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {activeCard ? (
          <div style={{ width: '18rem' }}>
            <CardTile
              card={activeCard}
              labels={snapshot.labels}
              memberColors={memberColors}
              isDone={columns.find((column) => column.id === activeCard.columnId)?.isDone}
              compact={compact}
              overlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** Compare two layouts by ordered content. */
function sameOrder(a: BoardLayout, b: BoardLayout): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    const listA = a[key] ?? []
    const listB = b[key] ?? []
    if (listA.length !== listB.length) return false
    for (let index = 0; index < listA.length; index += 1) {
      if (listA[index] !== listB[index]) return false
    }
  }
  return true
}
