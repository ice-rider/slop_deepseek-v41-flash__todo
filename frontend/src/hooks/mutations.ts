import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/auth'
import type { BoardSnapshot, Priority, Session } from '@/lib/types'

/** Apply a successful session to the auth store. */
function useSessionWriter() {
  const setSession = useAuthStore((state) => state.setSession)
  return (session: Session) => setSession(session)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function useLogin() {
  const writeSession = useSessionWriter()
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.login(input),
    onSuccess: writeSession,
  })
}

export function useRegister() {
  const writeSession = useSessionWriter()
  return useMutation({
    mutationFn: (input: { email: string; name: string; password: string }) => api.register(input),
    onSuccess: writeSession,
  })
}

export function useLogout() {
  const client = useQueryClient()
  const { refreshToken, signOut } = useAuthStore.getState()
  return useMutation({
    mutationFn: () => api.logout(refreshToken),
    onSettled: () => {
      signOut()
      client.clear()
    },
  })
}

export function useUpdateProfile() {
  const setUser = useAuthStore((state) => state.setUser)
  return useMutation({
    mutationFn: (input: { name?: string; avatarColor?: string; password?: string }) => api.updateMe(input),
    onSuccess: (data) => setUser(data.user),
  })
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export function useCreateBoard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; description?: string; color?: string; template?: string }) =>
      api.createBoard(input),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.board(data.board.id), data.snapshot)
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateBoard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (
      input: Partial<{ title: string; description: string; color: string; starred: boolean; archived: boolean }>,
    ) => api.updateBoard(boardId, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteBoard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (boardId: string) => api.deleteBoard(boardId),
    onSuccess: (_data, boardId) => {
      client.removeQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/**
 * Board mutations for callers that are not bound to one board (the board
 * gallery), so starring or archiving does not need a hook per board.
 */
export function useBoardSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      boardId,
      ...input
    }: {
      boardId: string
    } & Partial<{ title: string; description: string; color: string; starred: boolean; archived: boolean }>) =>
      api.updateBoard(boardId, input),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ['board', variables.boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function useCreateColumn(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; color?: string; wipLimit?: number; isDone?: boolean }) =>
      api.createColumn(boardId, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
    },
  })
}

export function useUpdateColumn(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      columnId,
      ...input
    }: {
      columnId: string
    } & Partial<{ title: string; color: string; wipLimit: number; isDone: boolean }>) =>
      api.updateColumn(columnId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['board', boardId] }),
  })
}

export function useDeleteColumn(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ columnId, moveTo }: { columnId: string; moveTo?: string }) =>
      api.deleteColumn(columnId, moveTo),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
    },
  })
}

export function useReorderColumns(boardId: string) {
  const client = useQueryClient()
  const key = queryKeys.board(boardId)
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderColumns(boardId, ids),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<BoardSnapshot>(key)
      if (previous) {
        const byId = new Map(previous.columns.map((column) => [column.id, column]))
        const columns = ids
          .map((id, index) => {
            const column = byId.get(id)
            return column ? { ...column, position: index } : null
          })
          .filter((column): column is NonNullable<typeof column> => column !== null)
        client.setQueryData<BoardSnapshot>(key, { ...previous, columns })
      }
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function useCreateCard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      columnId,
      ...input
    }: {
      columnId: string
      title: string
      description?: string
      priority?: Priority
      dueDate?: string | null
      assigneeId?: string | null
      labelIds?: string[]
    }) => api.createCard(columnId, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useUpdateCard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string
    } & Partial<{
      title: string
      description: string
      priority: Priority
      dueDate: string | null
      assigneeId: string | null
      coverColor: string
      archived: boolean
      labelIds: string[]
    }>) => api.updateCard(id, input),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: queryKeys.card(variables.id) })
      client.invalidateQueries({ queryKey: ['stats'] })
      client.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

/** Patch a card in place without leaving the drawer (fast, no refetch flash). */
export function usePatchCard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string
    } & Parameters<typeof api.updateCard>[1]) => api.updateCard(id, input),
    onMutate: async ({ id, ...input }) => {
      const cardKey = queryKeys.card(id)
      await client.cancelQueries({ queryKey: cardKey })
      const previous = client.getQueryData(cardKey)
      client.setQueryData(cardKey, (current: unknown) => {
        if (!current || typeof current !== 'object') return current
        const envelope = current as { card?: Record<string, unknown> }
        if (!envelope.card) return current
        return { ...envelope, card: { ...envelope.card, ...input } }
      })
      return { previous }
    },
    onError: (_error, variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.card(variables.id), context.previous)
    },
    onSettled: (_data, _error, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.card(variables.id) })
      client.invalidateQueries({ queryKey: ['board', boardId] })
    },
  })
}

export function useDeleteCard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, hard = false }: { cardId: string; hard?: boolean }) => api.deleteCard(cardId, hard),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: queryKeys.card(variables.cardId) })
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useMoveCard(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, columnId, position }: { cardId: string; columnId: string; position: number }) =>
      api.moveCard(cardId, columnId, position),
    onSettled: () => client.invalidateQueries({ queryKey: ['board', boardId] }),
  })
}

/**
 * Persist a whole drag outcome. The optimistic update reuses the same shape the
 * server returns, so a slow round-trip never makes the card jump back.
 */
export function useReorderBoard(boardId: string) {
  const client = useQueryClient()
  const key = queryKeys.board(boardId)
  return useMutation({
    mutationFn: (columns: Array<{ id: string; cardIds: string[] }>) => api.reorderBoard(boardId, columns),
    onMutate: async (columns) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<BoardSnapshot>(key)
      if (previous) {
        const placement = new Map<string, { columnId: string; position: number }>()
        columns.forEach((column) => {
          column.cardIds.forEach((cardId, position) => placement.set(cardId, { columnId: column.id, position }))
        })
        const cards = previous.cards.map((card) => {
          const next = placement.get(card.id)
          return next ? { ...card, ...next } : card
        })
        client.setQueryData<BoardSnapshot>(key, { ...previous, cards })
      }
      return { previous }
    },
    onError: (_error, _columns, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
    },
    onSuccess: (snapshot) => {
      client.setQueryData(key, snapshot)
      client.invalidateQueries({ queryKey: ['boards'] })
      client.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

/** Toggle a card between the done column and its previous home. */
export function useQuickArchive(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, archived }: { cardId: string; archived: boolean }) =>
      api.updateCard(cardId, { archived }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function useCreateLabel(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) => api.createLabel(boardId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['board', boardId] }),
  })
}

export function useUpdateLabel(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ labelId, ...input }: { labelId: string } & { name?: string; color?: string }) =>
      api.updateLabel(labelId, input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

export function useDeleteLabel(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (labelId: string) => api.deleteLabel(labelId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

/** Toggle one label on a card, updating both the board and the open drawer. */
export function useToggleCardLabel(boardId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ cardId, labelId, attached }: { cardId: string; labelId: string; attached: boolean }) => {
      if (attached) return api.detachLabel(cardId, labelId)
      return api.attachLabel(cardId, labelId)
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.card(variables.cardId) })
      client.invalidateQueries({ queryKey: ['board', boardId] })
      client.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export function useChecklistMutations(boardId: string, cardId: string) {
  const client = useQueryClient()
  const refresh = () => {
    client.invalidateQueries({ queryKey: queryKeys.card(cardId) })
    client.invalidateQueries({ queryKey: ['board', boardId] })
  }

  const add = useMutation({
    mutationFn: (text: string) => api.addChecklistItem(cardId, text),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ itemId, ...input }: { itemId: string } & { text?: string; done?: boolean }) =>
      api.updateChecklistItem(itemId, input),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (itemId: string) => api.deleteChecklistItem(itemId),
    onSuccess: refresh,
  })
  return { add, update, remove }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function useCommentMutations(boardId: string, cardId: string) {
  const client = useQueryClient()
  const refresh = () => {
    client.invalidateQueries({ queryKey: queryKeys.card(cardId) })
    client.invalidateQueries({ queryKey: ['board', boardId] })
  }

  const add = useMutation({
    mutationFn: (body: string) => api.addComment(cardId, body),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) => api.updateComment(commentId, body),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: refresh,
  })
  return { add, update, remove }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function useMemberMutations(boardId: string) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['board', boardId] })

  const add = useMutation({
    mutationFn: (input: { email: string; role: string }) => api.addMember(boardId, input),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(boardId, userId),
    onSuccess: refresh,
  })
  return { add, remove }
}
