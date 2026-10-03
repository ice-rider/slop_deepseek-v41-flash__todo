/** Central query-key factory so invalidations cannot drift from fetches. */
export const queryKeys = {
  meta: () => ['meta'] as const,
  boards: (includeArchived: boolean) => ['boards', includeArchived] as const,
  board: (boardId: string, includeArchived = false) => ['board', boardId, includeArchived] as const,
  boardActivity: (boardId: string) => ['board', boardId, 'activity'] as const,
  card: (cardId: string) => ['card', cardId] as const,
  search: (query: string) => ['search', query] as const,
  stats: (boardId?: string) => ['stats', boardId ?? 'all'] as const,
  dashboard: () => ['dashboard'] as const,
  users: (query: string) => ['users', query] as const,
} as const
