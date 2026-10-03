import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Command,
  Keyboard,
  LogOut,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Avatar, Button, IconButton, Kbd, Tooltip } from '@/components/ui/primitives'
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator } from '@/components/ui/Popover'
import { cn } from '@/lib/utils'
import { useLogout } from '@/hooks/mutations'
import { useAuthStore } from '@/store/auth'
import { useResolvedTheme, useUiStore } from '@/store/ui'
import type { RealtimeStatus } from '@/hooks/useRealtime'

function RealtimeBadge({ status }: { status: RealtimeStatus }) {
  const config = {
    live: {
      label: 'Live',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      dot: 'bg-emerald-500',
    },
    connecting: {
      label: 'Connecting',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      dot: 'bg-amber-500 animate-pulse',
    },
    offline: {
      label: 'Offline',
      className: 'border-line bg-elevated text-muted',
      dot: 'bg-slate-400',
    },
  }[status]

  return (
    <Tooltip
      label={
        status === 'live'
          ? 'Realtime updates connected'
          : status === 'connecting'
            ? 'Connecting to the realtime stream…'
            : 'Realtime stream offline — reconnecting automatically'
      }
    >
      <span
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium',
          config.className,
        )}
      >
        {status === 'offline' ? (
          <WifiOff aria-hidden className="size-3.5" />
        ) : (
          <Wifi aria-hidden className="size-3.5" />
        )}
        <span className={cn('size-1.5 rounded-full', config.dot)} />
        {config.label}
      </span>
    </Tooltip>
  )
}

/**
 * Top bar: global search entry point, realtime status, theme and account.
 *
 * The search field is a button that opens the command palette rather than an
 * input, so there is exactly one place to type a query anywhere in the app.
 */
export function Topbar({
  realtimeStatus,
  onOpenPalette,
  onOpenHelp,
  onNewBoard,
}: {
  realtimeStatus: RealtimeStatus
  onOpenPalette: () => void
  onOpenHelp: () => void
  onNewBoard: () => void
}) {
  const user = useAuthStore((state) => state.user)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const logout = useLogout()
  const navigate = useNavigate()

  const isDark = useResolvedTheme() === 'dark'

  return (
    <header className="glass z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
      {collapsed ? (
        <IconButton
          aria-label="Show sidebar"
          onClick={toggleSidebar}
          icon={<PanelLeft className="size-4" />}
        />
      ) : null}

      <button
        type="button"
        onClick={onOpenPalette}
        className="group flex h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-[13px] text-subtle transition hover:border-line-strong hover:text-muted"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search boards, cards and actions…</span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd>
            <Command aria-hidden className="size-2.5" />K
          </Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <RealtimeBadge status={realtimeStatus} />

        <Button
          variant="secondary"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={onNewBoard}
          icon={<Plus className="size-3.5" />}
        >
          New board
        </Button>

        <Tooltip label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
          <IconButton
            aria-label="Toggle theme"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            icon={isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          />
        </Tooltip>

        <Tooltip label="Keyboard shortcuts">
          <IconButton aria-label="Keyboard shortcuts" onClick={onOpenHelp} icon={<Keyboard className="size-4" />} />
        </Tooltip>

        <Popover
          align="end"
          label="Account"
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={toggle}
              aria-label="Account menu"
              className="rounded-full transition hover:opacity-90"
            >
              <Avatar name={user?.name ?? 'You'} color={user?.avatarColor} size="md" />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <div className="px-2.5 py-2">
                <p className="truncate text-[13px] font-semibold text-fg">{user?.name}</p>
                <p className="truncate text-[12px] text-subtle">{user?.email}</p>
              </div>
              <PopoverSeparator />
              <PopoverItem
                icon={<Settings className="size-3.5" />}
                onClick={() => {
                  close()
                  navigate('/settings')
                }}
              >
                Settings
              </PopoverItem>
              <PopoverItem
                icon={<Keyboard className="size-3.5" />}
                onClick={() => {
                  close()
                  onOpenHelp()
                }}
                hint="?"
              >
                Keyboard shortcuts
              </PopoverItem>
              <PopoverItem
                icon={<BookOpen className="size-3.5" />}
                onClick={() => {
                  close()
                  window.open('/api/v1/meta', '_blank', 'noopener')
                }}
              >
                API info
              </PopoverItem>
              <PopoverSeparator />
              <PopoverLabel>Theme</PopoverLabel>
              <div className="flex gap-1 px-1.5 pb-1">
                {(['light', 'dark', 'system'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTheme(mode)}
                    className={cn(
                      'h-7 flex-1 rounded-lg border text-[12px] font-medium capitalize transition',
                      theme === mode ? 'border-brand bg-brand-soft text-fg' : 'border-line text-muted hover:text-fg',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <PopoverSeparator />
              <PopoverItem
                danger
                icon={<LogOut className="size-3.5" />}
                onClick={() => {
                  close()
                  logout.mutate()
                }}
              >
                Sign out
              </PopoverItem>
            </>
          )}
        </Popover>
      </div>
    </header>
  )
}
