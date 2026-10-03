/**
 * Wire types. These mirror the Go DTOs in backend/internal/store/models.go —
 * keep the two in sync when the API changes.
 */

export type Priority = 0 | 1 | 2 | 3

export type BoardRole = 'owner' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  avatarColor: string
  createdAt: string
}

export interface Board {
  id: string
  ownerId: string
  title: string
  description: string
  color: string
  starred: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  role?: BoardRole
}

export interface BoardSummary extends Board {
  columnCount: number
  cardCount: number
  doneCount: number
  overdueCount: number
}

export interface Column {
  id: string
  boardId: string
  title: string
  color: string
  wipLimit: number
  position: number
  isDone: boolean
  createdAt: string
}

export interface ChecklistProgress {
  total: number
  done: number
}

export interface Card {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string
  position: number
  priority: Priority
  dueDate: string | null
  assigneeId: string | null
  coverColor: string
  archived: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  labelIds?: string[]
  assigneeName?: string
  checklist: ChecklistProgress
  commentCount: number
}

export interface Label {
  id: string
  boardId: string
  name: string
  color: string
}

export interface ChecklistItem {
  id: string
  cardId: string
  text: string
  done: boolean
  position: number
  createdAt: string
}

export interface Comment {
  id: string
  cardId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface Activity {
  id: string
  boardId: string
  cardId: string | null
  actorId: string
  actorName: string
  verb: string
  summary: string
  createdAt: string
}

export interface Member {
  userId: string
  email: string
  name: string
  avatarColor: string
  role: BoardRole
  joinedAt: string
}

export interface BoardSnapshot {
  board: Board
  columns: Column[]
  cards: Card[]
  labels: Label[]
  members: Member[]
  activity: Activity[]
}

/**
 * GET /cards/{id} payload.
 *
 * Go embeds `Card` inside `CardDetail` and both declare a `checklist` JSON key.
 * `encoding/json` resolves that by depth — the shallower field wins — so the
 * detail endpoint returns the *item array* under `checklist`, shadowing the
 * `{ total, done }` progress aggregate used on card faces.
 */
export type CardDetail = Omit<Card, 'checklist'> & {
  checklist: ChecklistItem[]
  labels: Label[]
  comments: Comment[]
  activity: Activity[]
  assignee: User | null
  board: Board
  column: Column
}

export interface SearchHit extends Card {
  boardTitle: string
  boardColor: string
  columnTitle: string
  columnIsDone: boolean
}

export interface ColumnCount {
  columnId: string
  title: string
  count: number
}

export interface BoardCount {
  boardId: string
  title: string
  count: number
}

export interface DayCount {
  date: string
  count: number
}

export interface Stats {
  totalCards: number
  completedCards: number
  overdueCards: number
  dueToday: number
  dueThisWeek: number
  unassigned: number
  byPriority: Record<string, number>
  byColumn: ColumnCount[]
  byBoard: BoardCount[]
  completedByDay: DayCount[]
}

export interface Session {
  user: User
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  expiresAt: string
}

export interface DashboardPayload {
  stats: Stats
  sections: {
    overdue?: SearchHit[]
    dueSoon?: SearchHit[]
    assigned?: SearchHit[]
    recent?: SearchHit[]
  }
  boards: BoardSummary[]
}

export interface BoardTemplate {
  id: string
  name: string
  description: string
}

export interface ApiMeta {
  name: string
  version: string
  commit: string
  builtAt: string
  env: string
  startedAt: string
  priorities: string[]
  templates: BoardTemplate[]
  roles: string[]
}

export type RealtimeEventType =
  | 'hello'
  | 'resync'
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.reordered'
  | 'column.created'
  | 'column.updated'
  | 'column.deleted'
  | 'card.created'
  | 'card.updated'
  | 'card.moved'
  | 'card.deleted'
  | 'comment.added'
  | 'checklist.changed'
  | 'label.changed'
  | 'member.changed'

export interface RealtimeEvent {
  type: RealtimeEventType
  boardId?: string
  cardId?: string
  actorId?: string
  actorName?: string
  summary?: string
  data?: Record<string, unknown>
  at: string
}

/** Filter model shared by the board toolbar, search page and query layer. */
export interface CardFilters {
  q: string
  labelIds: string[]
  priorities: Priority[]
  assignee: 'anyone' | 'me' | 'unassigned' | string
  due: 'any' | 'overdue' | 'today' | 'week' | 'none'
  sort: 'due' | 'created' | 'updated' | 'priority' | 'title'
}

export const emptyFilters: CardFilters = {
  q: '',
  labelIds: [],
  priorities: [],
  assignee: 'anyone',
  due: 'any',
  sort: 'due',
}

export function isFilterActive(filters: CardFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.labelIds.length > 0 ||
    filters.priorities.length > 0 ||
    filters.assignee !== 'anyone' ||
    filters.due !== 'any'
  )
}
