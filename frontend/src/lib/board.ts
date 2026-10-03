import { arrayMove } from '@/lib/utils'
import type { Card, CardFilters, Column } from '@/lib/types'

/** cardId -> ordered card ids, including cards hidden by the active filters. */
export type BoardLayout = Record<string, string[]>

/** Build the full ordering for every column from a server snapshot. */
export function buildLayout(columns: Column[], cards: Card[]): BoardLayout {
  const layout: BoardLayout = {}
  for (const column of columns) layout[column.id] = []
  const known = cards
    .filter((card) => layout[card.columnId] !== undefined)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
  for (const card of known) layout[card.columnId].push(card.id)
  return layout
}

/**
 * Re-insert a visible ordering into the full ordering.
 *
 * Hidden cards keep their slots, and the visible cards take the positions in
 * the order the user produced. This is what makes drag-and-drop safe while a
 * filter is hiding part of a column.
 */
export function mergeOrder(full: string[], visible: string[]): string[] {
  const visibleSet = new Set(visible)
  const pool = visible.slice()
  const result: string[] = []
  for (const id of full) {
    if (visibleSet.has(id)) {
      const next = pool.shift()
      result.push(next ?? id)
    } else {
      result.push(id)
    }
  }
  result.push(...pool)
  return result
}

/** Apply a drag result within one column to the full ordering. */
export function moveWithinColumn(layout: BoardLayout, columnId: string, activeId: string, overId: string): BoardLayout {
  const list = layout[columnId]
  if (!list) return layout
  const from = list.indexOf(activeId)
  const to = list.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return layout
  return { ...layout, [columnId]: arrayMove(list, from, to) }
}

/** Move a card into another column, landing at the drop target's slot. */
export function moveAcrossColumns(
  layout: BoardLayout,
  activeId: string,
  fromColumnId: string,
  toColumnId: string,
  overId: string | null,
): BoardLayout {
  const from = layout[fromColumnId]
  const to = layout[toColumnId]
  if (!from || !to) return layout
  const withoutActive = from.filter((id) => id !== activeId)
  const targetIndex = overId ? to.indexOf(overId) : -1
  const insertAt = targetIndex >= 0 ? targetIndex : to.length
  return {
    ...layout,
    [fromColumnId]: withoutActive,
    [toColumnId]: [...to.slice(0, insertAt), activeId, ...to.slice(insertAt)],
  }
}

export function columnOfCard(layout: BoardLayout, cardId: string): string | null {
  for (const [columnId, ids] of Object.entries(layout)) {
    if (ids.includes(cardId)) return columnId
  }
  return null
}

/**
 * Client-side filter predicate.
 *
 * Board filtering happens in the browser so typing feels instant; the server's
 * /search endpoint backs the global search and "my work" views where the whole
 * account is in scope.
 */
export function matchesFilters(card: Card, filters: CardFilters, currentUserId?: string): boolean {
  const query = filters.q.trim().toLowerCase()
  if (query) {
    const haystack = `${card.title}\n${card.description}`.toLowerCase()
    if (!haystack.includes(query)) return false
  }

  if (filters.labelIds.length > 0) {
    const cardLabels = card.labelIds ?? []
    if (!filters.labelIds.some((labelId) => cardLabels.includes(labelId))) return false
  }

  if (filters.priorities.length > 0 && !filters.priorities.includes(card.priority)) return false

  if (filters.assignee === 'me') {
    if (!currentUserId || card.assigneeId !== currentUserId) return false
  } else if (filters.assignee === 'unassigned') {
    if (card.assigneeId) return false
  } else if (filters.assignee !== 'anyone') {
    if (card.assigneeId !== filters.assignee) return false
  }

  if (filters.due !== 'any') {
    const due = card.dueDate ? new Date(card.dueDate) : null
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const endOfToday = new Date(start.getTime() + 86_400_000)
    const endOfWeek = new Date(start.getTime() + 7 * 86_400_000)
    const completed = Boolean(card.completedAt)
    switch (filters.due) {
      case 'overdue':
        if (!due || completed || due.getTime() >= Date.now()) return false
        break
      case 'today':
        if (!due || due < start || due >= endOfToday) return false
        break
      case 'week':
        if (!due || due < start || due >= endOfWeek) return false
        break
      case 'none':
        if (due) return false
        break
      default:
        break
    }
  }

  return true
}

export function sortCards(cards: Card[], sort: CardFilters['sort']): Card[] {
  const copy = cards.slice()
  switch (sort) {
    case 'priority':
      return copy.sort((a, b) => b.priority - a.priority || a.position - b.position)
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    case 'created':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    case 'updated':
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    case 'due':
    default:
      return copy.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.position - b.position
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      })
  }
}
