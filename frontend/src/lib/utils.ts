import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { LOCALE } from '@/lib/i18n'

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const startOfToday = (): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** Whole days between today and a date (negative = in the past). */
export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((target.getTime() - startOfToday().getTime()) / 86_400_000)
}

export function isOverdue(iso: string | null | undefined, completed = false): boolean {
  if (completed) return false
  const days = daysFromToday(iso)
  return days !== null && days < 0
}

export function isDueToday(iso: string | null | undefined): boolean {
  return daysFromToday(iso) === 0
}

export interface DueMeta {
  label: string
  /** Chip classes appropriate for the urgency. */
  className: string
  overdue: boolean
  today: boolean
}

const DUE_NEUTRAL = 'bg-elevated text-muted border-line'
const DUE_SOON = 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25'
const DUE_TODAY = 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25'
const DUE_OVERDUE = 'bg-rose-500/14 text-rose-700 dark:text-rose-300 border-rose-500/30'
const DUE_DONE = 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'

/** Human-friendly due-date chip: "Today", "Tomorrow", "3d late", "12 Mar". */
export function dueMeta(iso: string | null | undefined, completed = false): DueMeta | null {
  const days = daysFromToday(iso)
  if (days === null || !iso) return null
  const date = new Date(iso)

  if (completed) {
    return { label: formatShortDate(date), className: DUE_DONE, overdue: false, today: false }
  }
  if (days < 0) {
    return {
      label: days === -1 ? 'Yesterday' : `${Math.abs(days)}d late`,
      className: DUE_OVERDUE,
      overdue: true,
      today: false,
    }
  }
  if (days === 0) return { label: 'Today', className: DUE_TODAY, overdue: false, today: true }
  if (days === 1) return { label: 'Tomorrow', className: DUE_SOON, overdue: false, today: false }
  if (days <= 7) return { label: `In ${days}d`, className: DUE_SOON, overdue: false, today: false }
  return { label: formatShortDate(date), className: DUE_NEUTRAL, overdue: false, today: false }
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

/** `<input type="date">` value (yyyy-mm-dd) for a stored timestamp. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Convert a date input value into an RFC3339 timestamp at local end-of-day. */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, 17, 0, 0).toISOString()
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((then - Date.now()) / 1000)
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ]
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
  let value = seconds
  for (const [unit, step] of table) {
    if (Math.abs(value) < step) return formatter.format(Math.round(value), unit)
    value /= step
  }
  return formatter.format(Math.round(value), 'year')
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

/** Move an item between indices without mutating the input array. */
export function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const item of items) {
    const group = key(item)
    ;(out[group] ??= []).push(item)
  }
  return out
}

/** Very small fuzzy matcher used by the command palette. */
export function fuzzyScore(needle: string, haystack: string): number {
  const query = needle.trim().toLowerCase()
  if (!query) return 1
  const target = haystack.toLowerCase()
  if (target.includes(query)) {
    // Prefer prefix matches, then earlier matches.
    return 100 - target.indexOf(query) + (target.startsWith(query) ? 50 : 0)
  }
  let score = 0
  let index = 0
  for (const char of query) {
    const found = target.indexOf(char, index)
    if (found === -1) return 0
    score += 1
    index = found + 1
  }
  return score
}

export function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`
}

/** Debounce a callback, returning a cancel handle. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return wrapped
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Stable id for optimistic client-side rows. */
export function tempId(): string {
  return `temp-${Math.random().toString(36).slice(2, 10)}`
}
