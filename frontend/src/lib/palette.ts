/**
 * Static colour maps.
 *
 * Tailwind's compiler only sees class names that appear literally in the
 * source, so every swatch is written out in full rather than composed from
 * template strings.
 */
import type { Priority } from './types'

export interface Swatch {
  /** Tinted background, used for chips and badges. */
  soft: string
  /** Text colour that pairs with `soft`. */
  text: string
  /** Saturated background, used for dots and bars. */
  solid: string
  /** Border accent. */
  border: string
  /** Board header gradient stops. */
  gradient: string
}

const swatch = (soft: string, text: string, solid: string, border: string, gradient: string): Swatch => ({
  soft,
  text,
  solid,
  border,
  gradient,
})

export const swatches: Record<string, Swatch> = {
  slate: swatch(
    'bg-slate-500/12',
    'text-slate-700 dark:text-slate-300',
    'bg-slate-500',
    'border-slate-500/25',
    'from-slate-500/25 to-slate-500/5',
  ),
  gray: swatch(
    'bg-gray-500/12',
    'text-gray-700 dark:text-gray-300',
    'bg-gray-500',
    'border-gray-500/25',
    'from-gray-500/25 to-gray-500/5',
  ),
  red: swatch(
    'bg-red-500/12',
    'text-red-700 dark:text-red-300',
    'bg-red-500',
    'border-red-500/25',
    'from-red-500/25 to-red-500/5',
  ),
  rose: swatch(
    'bg-rose-500/12',
    'text-rose-700 dark:text-rose-300',
    'bg-rose-500',
    'border-rose-500/25',
    'from-rose-500/25 to-rose-500/5',
  ),
  orange: swatch(
    'bg-orange-500/14',
    'text-orange-700 dark:text-orange-300',
    'bg-orange-500',
    'border-orange-500/25',
    'from-orange-500/25 to-orange-500/5',
  ),
  amber: swatch(
    'bg-amber-500/14',
    'text-amber-700 dark:text-amber-300',
    'bg-amber-500',
    'border-amber-500/25',
    'from-amber-500/25 to-amber-500/5',
  ),
  yellow: swatch(
    'bg-yellow-500/14',
    'text-yellow-700 dark:text-yellow-300',
    'bg-yellow-500',
    'border-yellow-500/25',
    'from-yellow-500/25 to-yellow-500/5',
  ),
  lime: swatch(
    'bg-lime-500/14',
    'text-lime-700 dark:text-lime-300',
    'bg-lime-500',
    'border-lime-500/25',
    'from-lime-500/25 to-lime-500/5',
  ),
  green: swatch(
    'bg-green-500/12',
    'text-green-700 dark:text-green-300',
    'bg-green-500',
    'border-green-500/25',
    'from-green-500/25 to-green-500/5',
  ),
  emerald: swatch(
    'bg-emerald-500/12',
    'text-emerald-700 dark:text-emerald-300',
    'bg-emerald-500',
    'border-emerald-500/25',
    'from-emerald-500/25 to-emerald-500/5',
  ),
  teal: swatch(
    'bg-teal-500/12',
    'text-teal-700 dark:text-teal-300',
    'bg-teal-500',
    'border-teal-500/25',
    'from-teal-500/25 to-teal-500/5',
  ),
  cyan: swatch(
    'bg-cyan-500/12',
    'text-cyan-700 dark:text-cyan-300',
    'bg-cyan-500',
    'border-cyan-500/25',
    'from-cyan-500/25 to-cyan-500/5',
  ),
  sky: swatch(
    'bg-sky-500/12',
    'text-sky-700 dark:text-sky-300',
    'bg-sky-500',
    'border-sky-500/25',
    'from-sky-500/25 to-sky-500/5',
  ),
  blue: swatch(
    'bg-blue-500/12',
    'text-blue-700 dark:text-blue-300',
    'bg-blue-500',
    'border-blue-500/25',
    'from-blue-500/25 to-blue-500/5',
  ),
  indigo: swatch(
    'bg-indigo-500/12',
    'text-indigo-700 dark:text-indigo-300',
    'bg-indigo-500',
    'border-indigo-500/25',
    'from-indigo-500/25 to-indigo-500/5',
  ),
  violet: swatch(
    'bg-violet-500/12',
    'text-violet-700 dark:text-violet-300',
    'bg-violet-500',
    'border-violet-500/25',
    'from-violet-500/25 to-violet-500/5',
  ),
  purple: swatch(
    'bg-purple-500/12',
    'text-purple-700 dark:text-purple-300',
    'bg-purple-500',
    'border-purple-500/25',
    'from-purple-500/25 to-purple-500/5',
  ),
  fuchsia: swatch(
    'bg-fuchsia-500/12',
    'text-fuchsia-700 dark:text-fuchsia-300',
    'bg-fuchsia-500',
    'border-fuchsia-500/25',
    'from-fuchsia-500/25 to-fuchsia-500/5',
  ),
  pink: swatch(
    'bg-pink-500/12',
    'text-pink-700 dark:text-pink-300',
    'bg-pink-500',
    'border-pink-500/25',
    'from-pink-500/25 to-pink-500/5',
  ),
}

export const swatchNames = Object.keys(swatches)

export function swatchFor(name: string | undefined | null): Swatch {
  if (!name) return swatches.slate
  return swatches[name] ?? swatches.slate
}

/** Deterministic colour for a label name when the user has not picked one. */
export function colorForName(name: string): string {
  const palette = ['sky', 'violet', 'amber', 'rose', 'emerald', 'cyan', 'orange', 'fuchsia', 'indigo', 'teal']
  let sum = 0
  for (const char of name) sum += char.codePointAt(0) ?? 0
  return palette[sum % palette.length]
}

export interface PriorityMeta {
  value: Priority
  label: string
  /** Chip classes. */
  chip: string
  /** Left-edge bar class for the card tile. */
  bar: string
  /** Sort weight, highest first. */
  weight: number
}

export const priorityMeta: Record<Priority, PriorityMeta> = {
  0: {
    value: 0,
    label: 'Low',
    chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-300 border-slate-500/25',
    bar: 'bg-slate-400/70',
    weight: 0,
  },
  1: {
    value: 1,
    label: 'Medium',
    chip: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25',
    bar: 'bg-sky-500/80',
    weight: 1,
  },
  2: {
    value: 2,
    label: 'High',
    chip: 'bg-amber-500/14 text-amber-700 dark:text-amber-300 border-amber-500/25',
    bar: 'bg-amber-500/85',
    weight: 2,
  },
  3: {
    value: 3,
    label: 'Urgent',
    chip: 'bg-rose-500/14 text-rose-700 dark:text-rose-300 border-rose-500/30',
    bar: 'bg-rose-500/90',
    weight: 3,
  },
}

export const priorities: Priority[] = [0, 1, 2, 3]

export function priorityMetaFor(value: number): PriorityMeta {
  const clamped = Math.min(3, Math.max(0, Math.round(value))) as Priority
  return priorityMeta[clamped]
}
