import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, filterQuery } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useAuthStore } from '@/store/auth'
import type { CardFilters } from '@/lib/types'

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta(),
    queryFn: ({ signal }) => api.meta(signal),
    staleTime: Infinity,
  })
}

export function useBoards(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.boards(includeArchived),
    queryFn: ({ signal }) => api.listBoards(includeArchived, signal),
    select: (data) => data.boards,
  })
}

export function useBoard(boardId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.board(boardId ?? '', includeArchived),
    queryFn: ({ signal }) => api.getBoard(boardId as string, includeArchived, signal),
    enabled: Boolean(boardId),
    // Realtime events keep this fresh; a longer stale time avoids refetch storms.
    staleTime: 5_000,
  })
}

export function useCardDetail(cardId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.card(cardId ?? ''),
    queryFn: ({ signal }) => api.getCard(cardId as string, signal),
    enabled: Boolean(cardId),
    select: (data) => data.card,
    staleTime: 2_000,
  })
}

export function useBoardActivity(boardId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boardActivity(boardId ?? ''),
    queryFn: ({ signal }) => api.boardActivity(boardId as string, signal),
    enabled: Boolean(boardId),
    select: (data) => data.activity,
  })
}

export function useStats(boardId?: string) {
  return useQuery({
    queryKey: queryKeys.stats(boardId),
    queryFn: ({ signal }) => api.stats(boardId, signal),
    select: (data) => data.stats,
    staleTime: 15_000,
  })
}

export function useDashboard() {
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken))
  return useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: ({ signal }) => api.dashboard(signal),
    enabled: isAuthenticated,
    staleTime: 10_000,
  })
}

export function useSearch(filters: CardFilters, boardId?: string, enabled = true) {
  const query = filterQuery(filters, boardId)
  return useQuery({
    queryKey: queryKeys.search(query),
    queryFn: ({ signal }) => api.search(query, signal),
    enabled,
    select: (data) => data.cards,
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  })
}

export function useUserDirectory(query: string) {
  return useQuery({
    queryKey: queryKeys.users(query),
    queryFn: ({ signal }) => api.listUsers(query, signal),
    select: (data) => data.users,
    staleTime: 30_000,
  })
}

/** Invalidate everything that could be affected by a board mutation. */
export function useBoardInvalidator() {
  const client = useQueryClient()
  return (boardId?: string) => {
    client.invalidateQueries({ queryKey: ['boards'] })
    if (boardId) client.invalidateQueries({ queryKey: ['board', boardId] })
    client.invalidateQueries({ queryKey: ['stats'] })
    client.invalidateQueries({ queryKey: ['dashboard'] })
    client.invalidateQueries({ queryKey: ['search'] })
  }
}

/** Convenience wrapper used by mutations that only touch one card. */
export function useMutationInvalidator() {
  const client = useQueryClient()
  return {
    card: (cardId: string) => client.invalidateQueries({ queryKey: queryKeys.card(cardId) }),
    board: (boardId: string) => client.invalidateQueries({ queryKey: ['board', boardId] }),
    boards: () => client.invalidateQueries({ queryKey: ['boards'] }),
    stats: () => client.invalidateQueries({ queryKey: ['stats'] }),
    dashboard: () => client.invalidateQueries({ queryKey: ['dashboard'] }),
    search: () => client.invalidateQueries({ queryKey: ['search'] }),
  }
}
