import { useAuthStore } from '@/store/auth'
import type {
  Activity,
  ApiMeta,
  Board,
  BoardSnapshot,
  BoardSummary,
  Card,
  CardDetail,
  ChecklistItem,
  Column,
  Comment,
  DashboardPayload,
  Label,
  Member,
  Priority,
  SearchHit,
  Session,
  Stats,
  User,
} from '@/lib/types'

const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'
export const API_BASE = RAW_BASE.replace(/\/+$/, '')

/** Structured API failure, carrying the server's machine-readable code. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>
  readonly requestId?: string

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.requestId = requestId
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }

  get isValidation(): boolean {
    return this.status === 422
  }
}

/** Callback invoked when the session cannot be recovered. */
let onSessionLost: (() => void) | null = null
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Attach (and if needed refresh) credentials. Defaults to true. */
  auth?: boolean
  signal?: AbortSignal
  /** Internal: prevents infinite refresh loops. */
  allowRefresh?: boolean
}

/** De-duplicate concurrent refreshes so a burst of 401s triggers one call. */
let refreshPromise: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) return false
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!response.ok) return false
      const session = (await response.json()) as Session
      useAuthStore.getState().setTokens(session.accessToken, session.refreshToken)
      useAuthStore.getState().setUser(session.user)
      return true
    } catch {
      return false
    } finally {
      // Cleared by the caller chain, not here, so parallel callers all observe
      // the same settled promise.
      setTimeout(() => {
        refreshPromise = null
      }, 0)
    }
  })()

  return refreshPromise
}

async function readError(response: Response): Promise<ApiError> {
  let code = 'http_error'
  let message = response.statusText || `Request failed with status ${response.status}`
  let fields: Record<string, string> | undefined
  let requestId: string | undefined
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; fields?: Record<string, string>; requestId?: string }
    }
    if (payload?.error) {
      code = payload.error.code ?? code
      message = payload.error.message ?? message
      fields = payload.error.fields
      requestId = payload.error.requestId
    }
  } catch {
    // Non-JSON error body (proxy timeout, HTML error page, ...).
  }
  return new ApiError(response.status, code, message, fields, requestId)
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal, allowRefresh = true } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (auth) {
    const token = useAuthStore.getState().accessToken
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.')
  }

  if (response.status === 401 && auth && allowRefresh) {
    const refreshed = await refreshSession()
    if (refreshed) {
      return request<T>(path, { ...options, allowRefresh: false })
    }
    useAuthStore.getState().markExpired()
    onSessionLost?.()
    throw new ApiError(401, 'unauthorized', 'Your session has expired. Please sign in again.')
  }

  if (!response.ok) throw await readError(response)

  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Build the SSE URL; EventSource cannot set headers, so the token rides along
 *  as a query parameter (the backend accepts it for this route only). */
export function eventsUrl(boardId?: string): string | null {
  const token = useAuthStore.getState().accessToken
  if (!token) return null
  const params = new URLSearchParams({ access_token: token })
  if (boardId) params.set('boardId', boardId)
  return `${API_BASE}/events?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Endpoint surface
// ---------------------------------------------------------------------------

export const api = {
  // -- auth --
  register: (input: { email: string; name: string; password: string }) =>
    request<Session>('/auth/register', { method: 'POST', body: input, auth: false }),

  login: (input: { email: string; password: string }) =>
    request<Session>('/auth/login', { method: 'POST', body: input, auth: false }),

  logout: (refreshToken: string | null) =>
    request<void>('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }),

  me: () => request<{ user: User }>('/auth/me'),

  updateMe: (input: { name?: string; avatarColor?: string; password?: string }) =>
    request<{ user: User }>('/users/me', { method: 'PATCH', body: input }),

  listUsers: (query: string, signal?: AbortSignal) =>
    request<{ users: User[] }>(`/users?q=${encodeURIComponent(query)}`, { signal }),

  // -- boards --
  listBoards: (includeArchived = false, signal?: AbortSignal) =>
    request<{ boards: BoardSummary[] }>(`/boards?archived=${includeArchived}`, { signal }),

  createBoard: (input: { title: string; description?: string; color?: string; template?: string }) =>
    request<{ board: Board; snapshot: BoardSnapshot }>('/boards', { method: 'POST', body: input }),

  getBoard: (boardId: string, includeArchived = false, signal?: AbortSignal) =>
    request<BoardSnapshot>(`/boards/${boardId}?archived=${includeArchived}`, { signal }),

  updateBoard: (
    boardId: string,
    input: Partial<{ title: string; description: string; color: string; starred: boolean; archived: boolean }>,
  ) => request<{ board: Board }>(`/boards/${boardId}`, { method: 'PATCH', body: input }),

  deleteBoard: (boardId: string) => request<void>(`/boards/${boardId}`, { method: 'DELETE' }),

  boardActivity: (boardId: string, signal?: AbortSignal) =>
    request<{ activity: Activity[] }>(`/boards/${boardId}/activity`, { signal }),

  boardStats: (boardId: string, signal?: AbortSignal) =>
    request<{ stats: Stats }>(`/boards/${boardId}/stats`, { signal }),

  reorderBoard: (boardId: string, columns: Array<{ id: string; cardIds: string[] }>) =>
    request<BoardSnapshot>(`/boards/${boardId}/reorder`, { method: 'POST', body: { columns } }),

  addMember: (boardId: string, input: { email: string; role: string }) =>
    request<{ member: Member }>(`/boards/${boardId}/members`, { method: 'POST', body: input }),

  removeMember: (boardId: string, userId: string) =>
    request<void>(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),

  // -- columns --
  createColumn: (
    boardId: string,
    input: { title: string; color?: string; wipLimit?: number; isDone?: boolean },
  ) => request<{ column: Column }>(`/boards/${boardId}/columns`, { method: 'POST', body: input }),

  updateColumn: (
    columnId: string,
    input: Partial<{ title: string; color: string; wipLimit: number; isDone: boolean }>,
  ) => request<{ column: Column }>(`/columns/${columnId}`, { method: 'PATCH', body: input }),

  deleteColumn: (columnId: string, moveTo?: string) =>
    request<void>(`/columns/${columnId}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`, {
      method: 'DELETE',
    }),

  reorderColumns: (boardId: string, ids: string[]) =>
    request<{ ok: boolean }>(`/boards/${boardId}/columns/reorder`, { method: 'POST', body: { ids } }),

  // -- cards --
  createCard: (
    columnId: string,
    input: {
      title: string
      description?: string
      priority?: Priority
      dueDate?: string | null
      assigneeId?: string | null
      labelIds?: string[]
    },
  ) => request<{ card: Card }>(`/columns/${columnId}/cards`, { method: 'POST', body: input }),

  getCard: (cardId: string, signal?: AbortSignal) =>
    request<{ card: CardDetail }>(`/cards/${cardId}`, { signal }),

  updateCard: (
    cardId: string,
    input: Partial<{
      title: string
      description: string
      priority: Priority
      dueDate: string | null
      assigneeId: string | null
      coverColor: string
      archived: boolean
      labelIds: string[]
    }>,
  ) => request<{ card: Card }>(`/cards/${cardId}`, { method: 'PATCH', body: input }),

  deleteCard: (cardId: string, hard = false) =>
    request<void>(`/cards/${cardId}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),

  moveCard: (cardId: string, columnId: string, position: number) =>
    request<{ card: Card }>(`/cards/${cardId}/move`, { method: 'POST', body: { columnId, position } }),

  attachLabel: (cardId: string, labelId: string) =>
    request<{ card: CardDetail }>(`/cards/${cardId}/labels`, { method: 'POST', body: { labelId } }),

  detachLabel: (cardId: string, labelId: string) =>
    request<{ card: CardDetail }>(`/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' }),

  // -- checklist --
  addChecklistItem: (cardId: string, text: string) =>
    request<{ item: ChecklistItem }>(`/cards/${cardId}/checklist`, { method: 'POST', body: { text } }),

  updateChecklistItem: (itemId: string, input: { text?: string; done?: boolean }) =>
    request<{ item: ChecklistItem }>(`/checklist/${itemId}`, { method: 'PATCH', body: input }),

  deleteChecklistItem: (itemId: string) => request<void>(`/checklist/${itemId}`, { method: 'DELETE' }),

  // -- comments --
  addComment: (cardId: string, body: string) =>
    request<{ comment: Comment }>(`/cards/${cardId}/comments`, { method: 'POST', body: { body } }),

  updateComment: (commentId: string, body: string) =>
    request<{ comment: Comment }>(`/comments/${commentId}`, { method: 'PATCH', body: { body } }),

  deleteComment: (commentId: string) => request<void>(`/comments/${commentId}`, { method: 'DELETE' }),

  // -- labels --
  createLabel: (boardId: string, input: { name: string; color?: string }) =>
    request<{ label: Label }>(`/boards/${boardId}/labels`, { method: 'POST', body: input }),

  updateLabel: (labelId: string, input: { name?: string; color?: string }) =>
    request<{ label: Label }>(`/labels/${labelId}`, { method: 'PATCH', body: input }),

  deleteLabel: (labelId: string) => request<void>(`/labels/${labelId}`, { method: 'DELETE' }),

  // -- views --
  search: (query: string, signal?: AbortSignal) => request<{ cards: SearchHit[]; count: number }>(`/search?${query}`, { signal }),

  stats: (boardId?: string, signal?: AbortSignal) =>
    request<{ stats: Stats }>(`/stats${boardId ? `?boardId=${encodeURIComponent(boardId)}` : ''}`, { signal }),

  dashboard: (signal?: AbortSignal) => request<DashboardPayload>('/dashboard', { signal }),

  meta: (signal?: AbortSignal) => request<ApiMeta>('/meta', { auth: false, signal }),
}

/** Serialise the filter model into the search endpoint's query string. */
export function filterQuery(
  filters: {
    q: string
    labelIds: string[]
    priorities: Priority[]
    assignee: string
    due: string
    sort: string
  },
  boardId?: string,
): string {
  const params = new URLSearchParams()
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (boardId) params.set('boardId', boardId)
  for (const labelId of filters.labelIds) params.append('label', labelId)
  for (const priority of filters.priorities) params.append('priority', String(priority))
  if (filters.assignee !== 'anyone') params.set('assignee', filters.assignee)
  if (filters.due !== 'any') params.set('due', filters.due)
  if (filters.sort) params.set('sort', filters.sort)
  params.set('limit', '120')
  return params.toString()
}
