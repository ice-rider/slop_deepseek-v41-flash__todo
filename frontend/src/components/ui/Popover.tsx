import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface PopoverProps {
  /** Rendered in place; receives the props needed to open/close the panel. */
  trigger: (state: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode
  children: (state: { close: () => void }) => ReactNode
  align?: 'start' | 'end' | 'center'
  side?: 'bottom' | 'top'
  className?: string
  /** Panel width in pixels; defaults to the trigger width. */
  width?: number
  label?: string
}

/**
 * Lightweight anchored popover.
 *
 * Positioning is computed in a layout effect and clamped to the viewport, which
 * keeps menus usable inside horizontally scrolled board columns where a purely
 * CSS-anchored panel would be clipped.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
  width,
  label,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((value) => !value), [])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect()
      if (!anchor) return
      const panelWidth = width ?? Math.max(anchor.width, 200)
      const panelHeight = panelRef.current?.offsetHeight ?? 240
      const gap = 6
      const margin = 8

      let left: number
      if (align === 'end') left = anchor.right - panelWidth
      else if (align === 'center') left = anchor.left + anchor.width / 2 - panelWidth / 2
      else left = anchor.left

      left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin)

      let top: number
      if (side === 'top') {
        top = anchor.top - panelHeight - gap
        if (top < margin) top = anchor.bottom + gap
      } else {
        top = anchor.bottom + gap
        if (top + panelHeight > window.innerHeight - margin) {
          const flipped = anchor.top - panelHeight - gap
          top = flipped >= margin ? flipped : Math.max(margin, window.innerHeight - panelHeight - margin)
        }
      }
      setCoords({ top, left, width: panelWidth })
    }

    place()
    // Re-place once the panel has measured itself.
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, side, width])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open && panelRef.current) {
      const first = panelRef.current.querySelector<HTMLElement>(
        'input:not([type="hidden"]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }
  }, [open])

  return (
    <>
      {trigger({ open, toggle, ref: triggerRef })}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={label}
              style={{
                position: 'fixed',
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                width: coords?.width,
                visibility: coords ? 'visible' : 'hidden',
              }}
              className={cn(
                'z-90 animate-[pop_120ms_cubic-bezier(0.22,1,0.36,1)] rounded-xl border border-line bg-surface p-1.5 shadow-lift',
                className,
              )}
            >
              {children({ close })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/** A menu row: consistent padding, hover and optional selected state. */
export function PopoverItem({
  children,
  onClick,
  selected,
  danger,
  disabled,
  icon,
  hint,
}: {
  children: ReactNode
  onClick?: () => void
  selected?: boolean
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  hint?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition',
        'disabled:pointer-events-none disabled:opacity-50',
        danger ? 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400' : 'text-fg hover:bg-elevated',
        selected && !danger && 'bg-elevated',
      )}
    >
      {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11.5px] text-subtle">{hint}</span> : null}
    </button>
  )
}

export function PopoverLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</p>
}

export function PopoverSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-line" />
}
