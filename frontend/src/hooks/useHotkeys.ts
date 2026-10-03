import { useEffect, useRef } from 'react'
import { isEditableTarget } from '@/lib/utils'

export interface HotkeyDefinition {
  /** Unique id, also used as the React key in the help sheet. */
  id: string
  /** Combination such as `mod+k`, `n`, `shift+/`, `escape`. */
  keys: string
  label: string
  group: 'Navigation' | 'Board' | 'Cards' | 'General'
  run: (event: KeyboardEvent) => void
  /** Allow the shortcut to fire while typing in a field. */
  allowInInput?: boolean
  enabled?: boolean
}

/** Build the canonical `mod+shift+k` style string for a keydown event. */
function combos(event: KeyboardEvent): string[] {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('mod')
  if (event.altKey) modifiers.push('alt')

  const withShift = [...modifiers, 'shift', key].join('+')
  const withoutShift = [...modifiers, key].join('+')
  return [withShift, withoutShift]
}

/**
 * Register global keyboard shortcuts.
 *
 * Definitions are read through a ref so handlers always see fresh closures
 * without re-binding the document listener on every render.
 */
export function useHotkeys(definitions: HotkeyDefinition[]): void {
  const ref = useRef(definitions)
  ref.current = definitions

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const candidates = combos(event)

      for (const definition of ref.current) {
        if (definition.enabled === false) continue
        if (!candidates.includes(definition.keys)) continue
        if (!definition.allowInInput && isEditableTarget(event.target)) continue
        event.preventDefault()
        definition.run(event)
        return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Human-readable key list, shared by the help sheet and the command palette. */
export const shortcutReference: Array<{ group: HotkeyDefinition['group']; items: Array<{ keys: string; label: string }> }> = [
  {
    group: 'Navigation',
    items: [
      { keys: 'mod+k', label: 'Open the command palette' },
      { keys: 'g d', label: 'Go to dashboard' },
      { keys: 'g m', label: 'Go to my work' },
      { keys: 'g s', label: 'Search all cards' },
      { keys: 'g a', label: 'All boards' },
      { keys: '/', label: 'Focus board search' },
      { keys: '?', label: 'Show this shortcut list' },
    ],
  },
  {
    group: 'Board',
    items: [
      { keys: 'n', label: 'New card in the first column' },
      { keys: 'c', label: 'New column' },
      { keys: 'b', label: 'Collapse or expand the sidebar' },
      { keys: 'v', label: 'Switch between board and list view' },
      { keys: 'f', label: 'Toggle the filter bar' },
      { keys: 't', label: 'Toggle light and dark theme' },
      { keys: 'esc', label: 'Close panels and dialogs' },
    ],
  },
  {
    group: 'Cards',
    items: [
      { keys: 'enter', label: 'Save the card being composed' },
      { keys: 'mod+enter', label: 'Post a comment' },
      { keys: 'd', label: 'Move the open card to the done column' },
      { keys: 'space', label: 'Lift a focused card, arrows to move, space to drop' },
      { keys: 'esc', label: 'Close panels and dialogs' },
    ],
  },
]

export function prettyKeys(keys: string): string[] {
  return keys.split('+').map((part) => {
    if (part === 'mod') return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
    if (part === 'shift') return 'Shift'
    if (part === 'alt') return 'Alt'
    if (part === 'escape' || part === 'esc') return 'Esc'
    if (part === 'enter') return '↵'
    if (part === 'delete') return 'Del'
    if (part === ' ') return 'Space'
    return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
  })
}
