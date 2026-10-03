import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Inbox, ListTodo } from 'lucide-react'
import { CardList } from '@/components/board/CardList'
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives'
import { useSearch } from '@/hooks/queries'
import { emptyFilters, type CardFilters, type SearchHit } from '@/lib/types'
import { cn, daysFromToday, pluralise } from '@/lib/utils'

type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

const buckets: Array<{ id: Bucket; title: string; hint: string; className: string }> = [
  { id: 'overdue', title: 'Overdue', hint: 'Past due and still open', className: 'text-rose-600 dark:text-rose-400' },
  { id: 'today', title: 'Today', hint: 'Due before midnight', className: 'text-sky-600 dark:text-sky-400' },
  { id: 'week', title: 'Next seven days', hint: 'Coming up', className: 'text-amber-600 dark:text-amber-400' },
  { id: 'later', title: 'Later', hint: 'Beyond this week', className: 'text-muted' },
  { id: 'none', title: 'No due date', hint: 'Unscheduled work', className: 'text-subtle' },
]

function bucketFor(card: SearchHit): Bucket {
  if (card.completedAt) return 'later'
  const days = daysFromToday(card.dueDate)
  if (days === null) return 'none'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 7) return 'week'
  return 'later'
}

/**
 * Everything assigned to the signed-in user, grouped by urgency.
 *
 * Uses the server-side search endpoint so it covers every board at once, with a
 * "completed" toggle for reviewing what was finished.
 */
export function MyWorkPage() {
  const navigate = useNavigate()
  const mineFilters: CardFilters = useMemo(() => ({ ...emptyFilters, assignee: 'me', sort: 'due' }), [])
  const doneFilters: CardFilters = useMemo(
    () => ({ ...emptyFilters, assignee: 'me', sort: 'updated' }),
    [],
  )

  const open = useSearch(mineFilters)
  const completed = useSearch(doneFilters)

  const grouped = useMemo(() => {
    const map: Record<Bucket, SearchHit[]> = { overdue: [], today: [], week: [], later: [], none: [] }
    for (const card of open.data ?? []) {
      if (card.completedAt) continue
      map[bucketFor(card)].push(card)
    }
    return map
  }, [open.data])

  const openCount = Object.values(grouped).reduce((sum, list) => sum + list.length, 0)
  const doneList = (completed.data ?? []).filter((card) => card.completedAt)

  if (open.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-panel" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7 p-4 pb-10 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">My work</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {openCount === 0
            ? 'Nothing is assigned to you right now.'
            : `${pluralise(openCount, 'open card')} assigned to you across every board.`}
        </p>
      </header>

      {openCount === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-6" />}
          title="Your plate is clear"
          description="Assign yourself a card from any board and it will show up here, grouped by urgency."
        />
      ) : (
        <div className="space-y-7">
          {buckets.map((bucket) => {
            const cards = grouped[bucket.id]
            if (cards.length === 0) return null
            return (
              <section key={bucket.id} className="space-y-2.5">
                <header className="flex items-center gap-2">
                  <h2 className={cn('text-[14px] font-semibold', bucket.className)}>{bucket.title}</h2>
                  <Badge className="border-line bg-elevated text-muted">{cards.length}</Badge>
                  <span className="text-[12px] text-subtle">{bucket.hint}</span>
                </header>
                <CardList
                  items={cards}
                  showContext
                  onOpen={(cardId) => {
                    const card = cards.find((candidate) => candidate.id === cardId)
                    if (card) navigate(`/boards/${card.boardId}?card=${card.id}`)
                  }}
                />
              </section>
            )
          })}
        </div>
      )}

      <section className="space-y-2.5">
        <header className="flex flex-wrap items-center gap-2">
          <CheckCircle2 aria-hidden className="size-4 text-emerald-500" />
          <h2 className="text-[14px] font-semibold text-fg">Completed</h2>
          <Badge className="border-line bg-elevated text-muted">{doneList.length}</Badge>
          <span className="text-[12px] text-subtle">Recently finished cards assigned to you</span>
        </header>
        <CardList
          items={doneList.slice(0, 25)}
          showContext
          emptyTitle="Nothing completed yet"
          emptyDescription="Cards you finish will collect here."
          onOpen={(cardId) => {
            const card = doneList.find((candidate) => candidate.id === cardId)
            if (card) navigate(`/boards/${card.boardId}?card=${card.id}`)
          }}
        />
      </section>

      <p className="flex items-center gap-2 text-[12px] text-subtle">
        <Inbox aria-hidden className="size-3.5" />
        Tip: press <kbd className="rounded border border-line bg-elevated px-1">g</kbd> then{' '}
        <kbd className="rounded border border-line bg-elevated px-1">d</kbd> to jump to the dashboard.
      </p>
    </div>
  )
}
