import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { HelpDialog } from '@/components/layout/HelpDialog'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { BoardCreateDialog } from '@/components/board/dialogs'
import { useHotkeys, type HotkeyDefinition } from '@/hooks/useHotkeys'
import { useRealtime } from '@/hooks/useRealtime'
import { applyTheme, useUiStore } from '@/store/ui'
import { useAuthStore } from '@/store/auth'

/**
 * Application chrome: navigation, top bar, overlays and the global shortcuts.
 *
 * The realtime connection lives here so there is exactly one SSE stream per
 * browser tab regardless of which page is open.
 */
export function AppShell() {
  const navigate = useNavigate()
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const user = useAuthStore((state) => state.user)
  const realtimeStatus = useRealtime()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  /** Active two-key sequence prefix (`g`), or null. */
  const [sequencePrefix, setSequencePrefix] = useState<string | null>(null)

  // Keep <html> in sync with the stored theme, including OS changes.
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  // A sequence prefix expires so a stray `g` never changes the meaning of a
  // later keystroke.
  useEffect(() => {
    if (!sequencePrefix) return
    const timer = window.setTimeout(() => setSequencePrefix(null), 1400)
    return () => window.clearTimeout(timer)
  }, [sequencePrefix])

  const sequenceHotkey = (key: string, label: string, path: string): HotkeyDefinition => ({
    id: `goto-${path}`,
    keys: key,
    label,
    group: 'Navigation',
    // Only armed while `g` is pending, so single-key board shortcuts stay free.
    enabled: sequencePrefix === 'g',
    run: () => {
      setSequencePrefix(null)
      navigate(path)
    },
  })

  const hotkeys: HotkeyDefinition[] = [
    {
      id: 'palette',
      keys: 'mod+k',
      label: 'Command palette',
      group: 'Navigation',
      allowInInput: true,
      run: () => setPaletteOpen(true),
    },
    {
      id: 'help',
      keys: '?',
      label: 'Shortcut list',
      group: 'General',
      run: () => setHelpOpen(true),
    },
    {
      id: 'theme',
      keys: 't',
      label: 'Toggle theme',
      group: 'General',
      run: () => toggleTheme(),
    },
    {
      id: 'sidebar',
      keys: 'b',
      label: 'Toggle sidebar',
      group: 'General',
      run: () => toggleSidebar(),
    },
    {
      id: 'goto-prefix',
      keys: 'g',
      label: 'Go to…',
      group: 'Navigation',
      enabled: sequencePrefix === null,
      run: () => setSequencePrefix('g'),
    },
    sequenceHotkey('d', 'Go to dashboard', '/dashboard'),
    sequenceHotkey('m', 'Go to my work', '/my-work'),
    sequenceHotkey('s', 'Search cards', '/search'),
    sequenceHotkey('a', 'All boards', '/boards'),
  ]

  useHotkeys(hotkeys)

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <div className="hidden md:flex">
        <Sidebar onNewBoard={() => setNewBoardOpen(true)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          realtimeStatus={realtimeStatus}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onNewBoard={() => setNewBoardOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewBoard={() => setNewBoardOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <BoardCreateDialog
        open={newBoardOpen}
        onClose={() => setNewBoardOpen(false)}
        onCreated={(boardId) => {
          setNewBoardOpen(false)
          navigate(`/boards/${boardId}`)
        }}
      />

      <p className="sr-only" aria-live="polite">
        {user ? `Signed in as ${user.name}. Realtime status: ${realtimeStatus}.` : ''}
      </p>
    </div>
  )
}
