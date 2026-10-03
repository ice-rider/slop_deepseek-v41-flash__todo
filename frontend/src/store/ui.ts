import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { emptyFilters, type CardFilters, type Priority } from '@/lib/types'

export type ThemeMode = 'light' | 'dark' | 'system'

interface UiState {
  theme: ThemeMode
  sidebarCollapsed: boolean
  /** Per-board filter state, keyed by board id, so switching boards remembers. */
  filters: Record<string, CardFilters>
  /** When true, columns show every card even if a filter matches none. */
  showArchived: boolean
  boardView: 'board' | 'list'
  compactCards: boolean

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  filtersFor: (boardId: string) => CardFilters
  patchFilters: (boardId: string, patch: Partial<CardFilters>) => void
  toggleLabelFilter: (boardId: string, labelId: string) => void
  togglePriorityFilter: (boardId: string, priority: Priority) => void
  resetFilters: (boardId: string) => void
  setShowArchived: (value: boolean) => void
  setBoardView: (view: 'board' | 'list') => void
  setCompactCards: (value: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarCollapsed: false,
      filters: {},
      showArchived: false,
      boardView: 'board',
      compactCards: false,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => {
        const current = get().theme
        const resolved =
          current === 'system'
            ? document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'light'
            : current
        set({ theme: resolved === 'dark' ? 'light' : 'dark' })
      },
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      filtersFor: (boardId) => get().filters[boardId] ?? emptyFilters,
      patchFilters: (boardId, patch) =>
        set((state) => ({
          filters: {
            ...state.filters,
            [boardId]: { ...(state.filters[boardId] ?? emptyFilters), ...patch },
          },
        })),
      toggleLabelFilter: (boardId, labelId) =>
        set((state) => {
          const current = state.filters[boardId] ?? emptyFilters
          const labelIds = current.labelIds.includes(labelId)
            ? current.labelIds.filter((id) => id !== labelId)
            : [...current.labelIds, labelId]
          return { filters: { ...state.filters, [boardId]: { ...current, labelIds } } }
        }),
      togglePriorityFilter: (boardId, priority) =>
        set((state) => {
          const current = state.filters[boardId] ?? emptyFilters
          const priorities = current.priorities.includes(priority)
            ? current.priorities.filter((value) => value !== priority)
            : [...current.priorities, priority]
          return { filters: { ...state.filters, [boardId]: { ...current, priorities } } }
        }),
      resetFilters: (boardId) =>
        set((state) => ({ filters: { ...state.filters, [boardId]: emptyFilters } })),

      setShowArchived: (showArchived) => set({ showArchived }),
      setBoardView: (boardView) => set({ boardView }),
      setCompactCards: (compactCards) => set({ compactCards }),
    }),
    {
      name: 'flowboard.ui',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        showArchived: state.showArchived,
        boardView: state.boardView,
        compactCards: state.compactCards,
      }),
    },
  ),
)

/** Apply the persisted theme to <html>; called on mount and on every change. */
export function applyTheme(theme: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = resolved
}

/** Subscribe to OS theme changes so "system" stays live. */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * The theme actually in effect right now.
 *
 * Kept in a hook (rather than reading the DOM during render) so a change to the
 * OS preference re-renders anything that displays the current mode.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUiStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    return watchSystemTheme(() => {
      setSystemDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
    })
  }, [])

  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}
