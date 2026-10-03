import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Flame,
  Inbox,
  LayoutDashboard,
  ListTodo,
  TrendingUp,
} from 'lucide-react'
import { CardList } from '@/components/board/CardList'
import { Button, EmptyState, ProgressBar, Skeleton } from '@/components/ui/primitives'
import { priorityMeta, priorityMetaFor, swatchFor } from '@/lib/palette'
import { cn, percent, pluralise } from '@/lib/utils'
import { LOCALE, formatDate } from '@/lib/i18n'
import { useDashboard } from '@/hooks/queries'
import type { DayCount, Priority, SearchHit } from '@/lib/types'

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'
  icon: React.ReactNode
}) {
  const tones = {
    neutral: 'text-fg',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-rose-600 dark:text-rose-400',
    brand: 'text-brand',
  }
  return (
    <div className="rounded-panel border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', tones[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted">{hint}</p> : null}
    </div>
  )
}

/** Completion trend as a compact CSS bar chart (no charting dependency). */
function TrendChart({ data }: { data: DayCount[] }) {
  const max = Math.max(1, ...data.map((point) => point.count))
  return (
    <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Cards completed over the last 14 days">
      {data.map((point) => {
        const height = Math.max(3, Math.round((point.count / max) * 100))
        const date = new Date(`${point.date}T00:00:00Z`)
        return (
          <div key={point.date} className="group/bar flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative flex h-24 w-full items-end">
              <div
                className={cn(
                  'w-full rounded-t-[4px] transition-all duration-300',
                  point.count > 0 ? 'bg-brand/80 group-hover/bar:bg-brand' : 'bg-elevated',
                )}
                style={{ height: `${height}%` }}
              />
              <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg shadow-soft group-hover/bar:block">
                {point.count} on {formatDate(date, { day: 'numeric', month: 'short' })}
              </span>
            </div>
            <span className="text-[9.5px] tabular-nums text-subtle">
              {date.toLocaleDateString(LOCALE, { day: 'numeric' })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SectionRail({
  title,
  icon,
  cards,
  emptyMessage,
  onOpen,
}: {
  title: string
  icon: React.ReactNode
  cards: SearchHit[]
  emptyMessage: string
  onOpen: (card: SearchHit) => void
}) {
  return (
    <section className="space-y-2.5">
      <header className="flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
        <span className="text-[12px] text-subtle">{cards.length}</span>
      </header>
      {cards.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line px-3.5 py-4 text-[12.5px] text-subtle">
          {emptyMessage}
        </p>
      ) : (
        <CardList items={cards} onOpen={(cardId) => {
          const card = cards.find((candidate) => candidate.id === cardId)
          if (card) onOpen(card)
        }} showContext />
      )}
    </section>
  )
}

/**
 * Account-wide overview: what is on fire, what is moving, and where to look next.
 * Every rail links straight into the relevant card.
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const dashboard = useDashboard()

  const stats = dashboard.data?.stats
  const sections = dashboard.data?.sections
  const boards = dashboard.data?.boards ?? []

  const totalTracked = stats?.totalCards ?? 0
  const completionRate = stats ? percent(stats.completedCards, stats.totalCards) : 0

  const priorityRows = useMemo(() => {
    if (!stats) return []
    const order: Priority[] = [3, 2, 1, 0]
    const max = Math.max(1, ...order.map((priority) => stats.byPriority[priorityMeta[priority].label.toLowerCase()] ?? 0))
    return order.map((priority) => {
      const label = priorityMeta[priority].label.toLowerCase()
      const count = stats.byPriority[label] ?? 0
      return { priority, label, count, width: Math.round((count / max) * 100) }
    })
  }, [stats])

  const openCard = (card: SearchHit) => {
    navigate(`/boards/${card.boardId}?card=${card.id}`)
  }

  if (dashboard.isLoading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 rounded-panel" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-panel" />
      </div>
    )
  }

  if (dashboard.isError) {
    return (
      <EmptyState
        className="py-24"
        icon={<AlertTriangle className="size-6 text-amber-500" />}
        title="Could not load your dashboard"
        description="Check your connection and try again."
        action={
          <Button variant="secondary" onClick={() => void dashboard.refetch()}>
            Retry
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 p-4 pb-10 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {totalTracked === 0
              ? 'Nothing tracked yet — create a board and add your first card.'
              : `${pluralise(totalTracked, 'card')} across ${pluralise(boards.length, 'board')}, ${completionRate}% complete.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={<ListTodo className="size-4" />} onClick={() => navigate('/my-work')}>
            My work
          </Button>
          <Button
            variant="primary"
            icon={<LayoutDashboard className="size-4" />}
            onClick={() => navigate('/boards')}
          >
            All boards
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="In flight"
          value={(stats?.totalCards ?? 0) - (stats?.completedCards ?? 0)}
          hint={`${stats?.completedCards ?? 0} completed`}
          icon={<Inbox className="size-4" />}
        />
        <StatCard
          label="Overdue"
          value={stats?.overdueCards ?? 0}
          hint={stats?.overdueCards ? 'Needs attention today' : 'Nothing overdue — nice'}
          tone={stats?.overdueCards ? 'danger' : 'success'}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatCard
          label="Due today"
          value={stats?.dueToday ?? 0}
          hint={`${stats?.dueThisWeek ?? 0} due within a week`}
          tone={stats?.dueToday ? 'warning' : 'neutral'}
          icon={<CalendarClock className="size-4" />}
        />
        <StatCard
          label="Completion"
          value={`${completionRate}%`}
          hint={`${stats?.unassigned ?? 0} cards unassigned`}
          tone="brand"
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-panel border border-line bg-surface p-4">
          <header className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <TrendingUp aria-hidden className="size-4 text-muted" />
              Completed in the last 14 days
            </h2>
            <span className="text-[12px] text-subtle">
              {stats?.completedByDay?.reduce((sum, point) => sum + point.count, 0) ?? 0} done
            </span>
          </header>
          <div className="mt-4">
            {stats?.completedByDay?.length ? (
              <TrendChart data={stats.completedByDay} />
            ) : (
              <p className="py-8 text-center text-[12.5px] text-subtle">No completion history yet.</p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <Flame aria-hidden className="size-4 text-muted" />
              By priority
            </h2>
            <ul className="mt-3 space-y-2.5">
              {priorityRows.map((row) => (
                <li key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className={cn('size-2 rounded-full', priorityMetaFor(row.priority).bar)} />
                      {priorityMetaFor(row.priority).label}
                    </span>
                    <span className="tabular-nums text-subtle">{row.count}</span>
                  </div>
                  <ProgressBar value={row.width} tone={row.priority === 3 ? 'danger' : row.priority === 2 ? 'warning' : 'brand'} />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-panel border border-line bg-surface p-4">
            <h2 className="text-[14px] font-semibold text-fg">Boards</h2>
            <ul className="mt-3 space-y-2">
              {boards.slice(0, 6).map((board) => {
                const swatch = swatchFor(board.color)
                const done = board.doneCount
                return (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/boards/${board.id}`)}
                      className="group flex w-full items-center gap-2.5 rounded-xl px-1 py-1.5 text-left transition hover:bg-elevated"
                    >
                      <span className={cn('size-2.5 shrink-0 rounded-full', swatch.solid)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{board.title}</span>
                        <span className="mt-1 block">
                          <ProgressBar value={done} max={Math.max(1, board.cardCount)} tone="success" />
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-subtle">
                        {done}/{board.cardCount}
                      </span>
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-subtle opacity-0 transition group-hover:opacity-100"
                      />
                    </button>
                  </li>
                )
              })}
              {boards.length === 0 ? (
                <li className="text-[12.5px] text-subtle">No boards yet.</li>
              ) : null}
            </ul>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionRail
          title="Overdue"
          icon={<AlertTriangle className="size-4 text-rose-500" />}
          cards={sections?.overdue ?? []}
          emptyMessage="Nothing is overdue. Keep it that way."
          onOpen={openCard}
        />
        <SectionRail
          title="Due this week"
          icon={<CalendarClock className="size-4 text-amber-500" />}
          cards={sections?.dueSoon ?? []}
          emptyMessage="No deadlines in the next seven days."
          onOpen={openCard}
        />
        <SectionRail
          title="Assigned to me"
          icon={<CheckCircle2 className="size-4 text-brand" />}
          cards={sections?.assigned ?? []}
          emptyMessage="Nothing is assigned to you right now."
          onOpen={openCard}
        />
        <SectionRail
          title="Recently updated"
          icon={<LayoutDashboard className="size-4 text-muted" />}
          cards={sections?.recent ?? []}
          emptyMessage="No recent activity."
          onOpen={openCard}
        />
      </div>
    </div>
  )
}
