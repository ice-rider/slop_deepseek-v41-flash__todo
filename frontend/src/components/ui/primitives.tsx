import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Loader2 } from 'lucide-react'
import { cn, initials } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-brand-fg hover:brightness-110 active:brightness-95 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]',
  secondary: 'bg-elevated text-fg border border-line hover:border-line-strong hover:bg-surface',
  ghost: 'text-muted hover:text-fg hover:bg-elevated',
  danger: 'bg-danger text-white hover:brightness-110',
  subtle: 'bg-brand-soft text-fg hover:brightness-[0.97] dark:hover:brightness-110',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9.5 px-3.5 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 justify-center rounded-xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading = false, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center font-medium transition-[background-color,color,border-color,filter,transform] duration-150',
        'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985]',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { size = 'icon', variant = 'ghost', className, ...props },
  ref,
) {
  return <Button ref={ref} size={size} variant={variant} className={cn('shrink-0', className)} {...props} />
})

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const inputClass = cn(
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg transition',
  'placeholder:text-subtle hover:border-line-strong',
  'focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--ring)]',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputClass, 'resize-y leading-relaxed', className)} {...props} />
  },
)

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: string
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function Badge({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-5',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function Avatar({
  name,
  color,
  size = 'md',
  title,
  className,
}: {
  name: string
  color?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  title?: string
  className?: string
}) {
  const sizes = {
    xs: 'size-5 text-[9px]',
    sm: 'size-6.5 text-[10px]',
    md: 'size-8 text-[11px]',
    lg: 'size-11 text-sm',
  }
  return (
    <span
      title={title ?? name}
      aria-hidden={title ? undefined : true}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: color ?? '#64748b' }}
    >
      {initials(name)}
    </span>
  )
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <Loader2 aria-hidden className="size-4 animate-spin text-muted" />
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-lg bg-gradient-to-r from-elevated via-line to-elevated bg-[length:200%_100%]',
        className,
      )}
    />
  )
}

export function ProgressBar({
  value,
  max = 100,
  className,
  tone = 'brand',
  label,
}: {
  value: number
  max?: number
  className?: string
  tone?: 'brand' | 'success' | 'warning' | 'danger'
  label?: string
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  const tones = {
    brand: 'bg-brand',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
  }
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-elevated', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description ? <span className="mt-0.5 block text-[12.5px] text-subtle">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-transparent bg-brand' : 'border-line bg-elevated',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: ReactNode; title?: string }>
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-0.5 rounded-xl border border-line bg-elevated p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[9px] font-medium transition',
              size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-3 text-[13px]',
              active ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-subtle">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-[13px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-elevated px-1.5 font-sans text-[11px] font-medium text-muted">
      {children}
    </kbd>
  )
}

export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-[11.5px] font-medium text-fg opacity-0 shadow-lift transition-opacity delay-200 group-hover/tip:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {label}
      </span>
    </span>
  )
}
