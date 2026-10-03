import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CornerDownLeft,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Kbd } from '@/components/ui/primitives'
import { api, filterQuery } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { swatchFor } from '@/lib/palette'
import { cn, fuzzyScore, truncate } from '@/lib/utils'
import { emptyFilters } from '@/lib/types'
import { useBoards } from '@/hooks/queries'
import { useResolvedTheme, useUiStore } from '@/store/ui'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: React.ReactNode
  keywords?: string
  run: () => void
}

/**
 * Command palette (⌘K).
 *
 * Combines navigation, actions and a live card search into one ranked list, so
 * the same keystroke gets you to a board or to a specific card.
 */
export function CommandPalette({
  open,
  onClose,
  onNewBoard,
  onOpenHelp,
}: {
  open: boolean
  onClose: () => void
  onNewBoard: () => void
  onOpenHelp: () => void
}) {
  const navigate = useNavigate()
  const boards = useBoards()
  const setTheme = useUiStore((state) => state.setTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const resolvedTheme = useResolvedTheme()

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebounced('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const cardSearch = useQuery({
    queryKey: queryKeys.search(`palette:${debounced}`),
    queryFn: ({ signal }) => api.search(filterQuery({ ...emptyFilters, q: debounced }, undefined), signal),
    enabled: open && debounced.length >= 2,
    select: (data) => data.cards.slice(0, 6),
    staleTime: 15_000,
  })

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      onClose()
      navigate(path)
    }
    const items: Command[] = [
      {
        id: 'nav-dashboard',
        label: 'Go to dashboard',
        group: 'Navigate',
        icon: <LayoutDashboard className="size-4" />,
        keywords: 'home overview stats',
        run: go('/dashboard'),
      },
      {
        id: 'nav-mywork',
        label: 'Go to my work',
        hint: 'g m',
        group: 'Navigate',
        icon: <ListTodo className="size-4" />,
        keywords: 'assigned tasks mine',
        run: go('/my-work'),
      },
      {
        id: 'nav-search',
        label: 'Search all cards',
        group: 'Navigate',
        icon: <Search className="size-4" />,
        keywords: 'find filter',
        run: go('/search'),
      },
      {
        id: 'action-new-board',
        label: 'Create a new board',
        group: 'Actions',
        icon: <Plus className="size-4" />,
        keywords: 'add project kanban',
        run: () => {
          onClose()
          onNewBoard()
        },
      },
      {
        id: 'action-theme',
        label: resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 't',
        group: 'Actions',
        icon: resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
        keywords: 'dark light appearance',
        run: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
          onClose()
        },
      },
      {
        id: 'action-sidebar',
        label: 'Toggle the sidebar',
        hint: 'b',
        group: 'Actions',
        icon: <LayoutDashboard className="size-4" />,
        keywords: 'collapse expand',
        run: () => {
          toggleSidebar()
          onClose()
        },
      },
      {
        id: 'action-shortcuts',
        label: 'Show keyboard shortcuts',
        hint: '?',
        group: 'Actions',
        icon: <Keyboard className="size-4" />,
        keywords: 'help keys',
        run: () => {
          onClose()
          onOpenHelp()
        },
      },
      {
        id: 'nav-settings',
        label: 'Open settings',
        group: 'Navigate',
        icon: <Settings className="size-4" />,
        keywords: 'profile account password',
        run: go('/settings'),
      },
    ]

    for (const board of boards.data ?? []) {
      items.push({
        id: `board-${board.id}`,
        label: board.title,
        hint: `${board.cardCount} cards`,
        group: 'Boards',
        icon: <span className={cn('size-2.5 rounded-full', swatchFor(board.color).solid)} />,
        keywords: `${board.title} ${board.description}`,
        run: go(`/boards/${board.id}`),
      })
    }

    for (const card of cardSearch.data ?? []) {
      items.push({
        id: `card-${card.id}`,
        label: card.title,
        hint: `${card.boardTitle} · ${card.columnTitle}`,
        group: 'Cards',
        icon: <Search className="size-4" />,
        keywords: card.title,
        run: () => {
          onClose()
          navigate(`/boards/${card.boardId}?card=${card.id}`)
        },
      })
    }

    return items
  }, [boards.data, cardSearch.data, navigate, onClose, onNewBoard, onOpenHelp, resolvedTheme, setTheme, toggleSidebar])

  const results = useMemo(() => {
    if (!query.trim()) {
      // Show navigation first, then a handful of boards.
      return commands.filter((command) => command.group !== 'Cards').slice(0, 12)
    }
    return commands
      .map((command) => ({
        command,
        score: Math.max(fuzzyScore(query, command.label), fuzzyScore(query, command.keywords ?? '') - 10),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map((entry) => entry.command)
  }, [commands, query])

  useEffect(() => {
    setCursor(0)
  }, [results.length, query])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  let lastGroup = ''

  return (
    <Modal open={open} onClose={onClose} bare size="lg" label="Command palette">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Search aria-hidden className="size-4 text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((value) => Math.min(value + 1, results.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((value) => Math.max(value - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              results[cursor]?.run()
            }
          }}
          placeholder="Type a command or search cards…"
          aria-label="Command palette"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
        />
        <Kbd>Esc</Kbd>
      </div>

      <ul ref={listRef} className="max-h-[26rem] overflow-y-auto p-2" role="listbox">
        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-[13px] text-subtle">
            {cardSearch.isFetching ? 'Searching…' : 'No matches. Try a board name or a card title.'}
          </li>
        ) : null}

        {results.map((command, index) => {
          const showGroup = command.group !== lastGroup
          lastGroup = command.group
          return (
            <li key={command.id}>
              {showGroup ? (
                <p className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">
                  {command.group}
                </p>
              ) : null}
              <button
                type="button"
                data-index={index}
                role="option"
                aria-selected={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={command.run}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition',
                  index === cursor ? 'bg-elevated' : 'hover:bg-elevated/60',
                )}
              >
                <span className="shrink-0 text-muted">{command.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{command.label}</span>
                {command.hint ? (
                  <span className="shrink-0 truncate text-[11.5px] text-subtle">{truncate(command.hint, 40)}</span>
                ) : null}
                {index === cursor ? (
                  <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-subtle" />
                ) : (
                  <ArrowRight aria-hidden className="size-3.5 shrink-0 text-transparent" />
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <footer className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11.5px] text-subtle">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="ml-auto">Search covers titles and descriptions</span>
      </footer>
    </Modal>
  )
}
