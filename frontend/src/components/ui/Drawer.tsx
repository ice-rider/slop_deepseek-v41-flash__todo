import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/primitives'
import { useFocusTrap } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  headerExtra?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Width preset; the card drawer uses `wide` for the two-column layout. */
  size?: 'md' | 'wide'
  label?: string
}

/**
 * Right-hand sheet used for the card detail view.
 *
 * Unlike a modal it keeps the board visible and scrollable behind it, which
 * matches how people actually work across a kanban.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  size = 'wide',
  label,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, panelRef)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex justify-end">
      <div aria-hidden onClick={onClose} className="absolute inset-0 animate-[fade-in_140ms_ease-out] bg-black/35" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? 'Details'}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-line bg-surface shadow-lift outline-none',
          'animate-[slide-in_200ms_cubic-bezier(0.22,1,0.36,1)]',
          size === 'wide' ? 'sm:max-w-3xl' : 'sm:max-w-md',
        )}
        style={{
          // Local keyframes keep the sheet motion self-contained.
          animationName: 'drawer-in',
        }}
      >
        <style>{`@keyframes drawer-in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}`}</style>
        <header className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            {title ? <div className="truncate text-[13px] font-medium text-muted">{title}</div> : null}
            {subtitle ? <div className="mt-0.5 truncate text-[12.5px] text-subtle">{subtitle}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerExtra}
            <IconButton aria-label="Close panel" onClick={onClose} icon={<X className="size-4" />} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <footer className="border-t border-line px-4 py-3 sm:px-5">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  )
}
