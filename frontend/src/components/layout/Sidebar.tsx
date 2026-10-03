import { NavLink, useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronsLeft, LayoutDashboard, ListTodo, Plus, Search, Star } from 'lucide-react'
import { Button, IconButton, Skeleton, Tooltip } from '@/components/ui/primitives'
import { swatchFor } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { useBoards } from '@/hooks/queries'
import { useUiStore } from '@/store/ui'
import type { BoardSummary } from '@/lib/types'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/my-work', label: 'My work', icon: ListTodo },
  { to: '/search', label: 'Search', icon: Search },
]

function BoardRow({ board, collapsed }: { board: BoardSummary; collapsed: boolean }) {
  const swatch = swatchFor(board.color)
  if (collapsed) {
    return (
      <Tooltip label={`${board.title} · ${board.cardCount} cards`} side="bottom">
        <NavLink
          to={`/boards/${board.id}`}
          className={({ isActive }) =>
            cn(
              'mx-auto flex size-9 items-center justify-center rounded-xl border transition',
              isActive ? 'border-brand/40 bg-brand-soft' : 'border-transparent hover:bg-elevated',
            )
          }
        >
          <span className={cn('size-3 rounded-full', swatch.solid)} />
        </NavLink>
      </Tooltip>
    )
  }

  return (
    <NavLink
      to={`/boards/${board.id}`}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition',
          isActive ? 'bg-elevated font-medium text-fg' : 'text-muted hover:bg-elevated hover:text-fg',
        )
      }
    >
      <span className={cn('size-2.5 shrink-0 rounded-full', swatch.solid)} />
      <span className="min-w-0 flex-1 truncate">{board.title}</span>
      {board.overdueCount > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-rose-500/12 px-1.5 py-px text-[10.5px] font-semibold text-rose-600 dark:text-rose-400"
          title={`${board.overdueCount} overdue`}
        >
          <AlertTriangle aria-hidden className="size-3" />
          {board.overdueCount}
        </span>
      ) : null}
      <span className="text-[11.5px] text-subtle">{board.cardCount}</span>
    </NavLink>
  )
}

/**
 * Primary navigation.
 *
 * Collapses to an icon rail (persisted) so the board gets the full width on
 * smaller laptops, and keeps overdue counts visible without opening a board.
 */
export function Sidebar({ onNewBoard }: { onNewBoard: () => void }) {
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const setCollapsed = useUiStore((state) => state.setSidebarCollapsed)
  const boards = useBoards()
  const navigate = useNavigate()

  const starred = boards.data?.filter((board) => board.starred) ?? []
  const rest = boards.data?.filter((board) => !board.starred) ?? []

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-line bg-surface/70 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('flex items-center gap-2 px-3 py-3.5', collapsed && 'justify-center px-2')}>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 rounded-lg px-1 py-1 text-left"
          aria-label="FlowBoard home"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-brand text-[13px] font-bold text-brand-fg">
            F
          </span>
          {!collapsed ? <span className="text-[14px] font-semibold tracking-tight text-fg">FlowBoard</span> : null}
        </button>
        {!collapsed ? (
          <IconButton
            aria-label="Collapse sidebar"
            className="ml-auto"
            onClick={() => setCollapsed(true)}
            icon={<ChevronsLeft className="size-4" />}
          />
        ) : null}
      </div>

      <nav className={cn('space-y-0.5 px-2', collapsed && 'px-1.5')} aria-label="Main">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-elevated font-medium text-fg' : 'text-muted hover:bg-elevated hover:text-fg',
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon aria-hidden className="size-4 shrink-0" />
            {!collapsed ? <span>{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className={cn('mt-4 flex items-center gap-2 px-3 pb-1.5', collapsed && 'justify-center px-1.5')}>
        {!collapsed ? (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Boards</p>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className={cn('ml-auto px-1.5', collapsed && 'ml-0')}
          onClick={onNewBoard}
          aria-label="New board"
          icon={<Plus className="size-3.5" />}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-4">
        {boards.isLoading ? (
          <div className="space-y-1.5 px-1">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className={cn('h-8', collapsed ? 'w-9' : 'w-full')} />
            ))}
          </div>
        ) : null}

        {starred.length > 0 ? (
          <div className="space-y-0.5">
            {!collapsed ? (
              <p className="flex items-center gap-1.5 px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-subtle">
                <Star aria-hidden className="size-3 fill-current" />
                Starred
              </p>
            ) : null}
            {starred.map((board) => (
              <BoardRow key={board.id} board={board} collapsed={collapsed} />
            ))}
          </div>
        ) : null}

        <div className="space-y-0.5">
          {rest.map((board) => (
            <BoardRow key={board.id} board={board} collapsed={collapsed} />
          ))}
        </div>

        {boards.data?.length === 0 ? (
          <div className="px-2.5 py-3">
            {!collapsed ? (
              <>
                <p className="text-[12.5px] text-muted">No boards yet.</p>
                <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={onNewBoard}>
                  Create your first board
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <div className="border-t border-line p-2">
          <IconButton
            aria-label="Expand sidebar"
            className="mx-auto"
            onClick={() => setCollapsed(false)}
            icon={<ChevronsLeft className="size-4 rotate-180" />}
          />
        </div>
      ) : null}
    </aside>
  )
}
