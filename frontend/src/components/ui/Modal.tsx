import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/** Trap Tab focus inside a container while it is open. */
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const focusFirst = () => {
      const candidates = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      )
      // Prefer an explicitly marked auto-focus target.
      const auto = node.querySelector<HTMLElement>('[data-autofocus]')
      ;(auto ?? candidates[0] ?? node).focus()
    }
    focusFirst()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const candidates = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null,
      )
      if (candidates.length === 0) {
        event.preventDefault()
        return
      }
      const first = candidates[0]
      const last = candidates[candidates.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [active, ref])
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Hide the header entirely (used by the command palette). */
  bare?: boolean
  /** Accessible name for dialogs that render without a visible title. */
  label?: string
}

const modalSizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', bare, label }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

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
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 animate-[fade-in_140ms_ease-out] bg-black/45 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full animate-[pop_160ms_cubic-bezier(0.22,1,0.36,1)] rounded-panel border border-line bg-surface shadow-lift outline-none',
          modalSizes[size],
        )}
      >
        {!bare ? (
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="truncate text-[15px] font-semibold text-fg">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-0.5 text-[13px] text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton aria-label="Close dialog" onClick={onClose} icon={<X className="size-4" />} />
          </header>
        ) : null}
        <div className={cn(bare ? '' : 'px-5 py-4')}>{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  /** Optional extra controls rendered between the description and the actions. */
  children?: ReactNode
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
