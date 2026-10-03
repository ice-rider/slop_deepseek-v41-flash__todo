import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { CardList } from '@/components/board/CardList'
import { Badge, Button, EmptyState, IconButton, Input, SegmentedControl, Skeleton } from '@/components/ui/primitives'
import { Popover, PopoverItem, PopoverLabel } from '@/components/ui/Popover'
import { useBoards, useSearch } from '@/hooks/queries'
import { useUiStore } from '@/store/ui'
import { emptyFilters, type CardFilters, type Priority } from '@/lib/types'
import { priorityMeta, priorities, swatchFor } from '@/lib/palette'
import { cn, debounce, pluralise } from '@/lib/utils'

const dueOptions = [
  { value: 'any', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
] as const

const sortOptions = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
] as const

/**
 * Global search across every board.
 *
 * The query is debounced into the server endpoint so results stay correct as
 * the account grows well beyond what a single board snapshot could hold.
 */
export function SearchPage() {
  const navigate = useNavigate()
  const boards = useBoards()
  const showArchived = useUiStore((state) => state.showArchived)

  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [boardId, setBoardId] = useState<string | undefined>(undefined)
  const [priorities_, setPriorities] = useState<Priority[]>([])
  const [due, setDue] = useState<CardFilters['due']>('any')
  const [assignee, setAssignee] = useState<CardFilters['assignee']>('anyone')
  const [sort, setSort] = useState<CardFilters['sort']>('updated')

  const applyQuery = useMemo(() => debounce((value: string) => setQuery(value), 220), [])
  useEffect(() => () => applyQuery.cancel(), [applyQuery])

  const filters: CardFilters = useMemo(
    () => ({ ...emptyFilters, q: query, priorities: priorities_, due, assignee, sort }),
    [query, priorities_, due, assignee, sort],
  )

  const results = useSearch(filters, boardId)
  const activeFilters =
    priorities_.length + (due === 'any' ? 0 : 1) + (assignee === 'anyone' ? 0 : 1) + (boardId ? 1 : 0)

  const clearAll = () => {
    setDraftQuery('')
    setQuery('')
    setPriorities([])
    setDue('any')
    setAssignee('anyone')
    setBoardId(undefined)
  }

  const hits = results.data ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pb-10 lg:p-6">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Search</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            Find any card by title or description, then narrow by board, label, priority, owner or deadline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input
              autoFocus
              value={draftQuery}
              onChange={(event) => {
                setDraftQuery(event.target.value)
                applyQuery(event.target.value)
              }}
              placeholder="Search titles and descriptions…"
              aria-label="Search all cards"
              className="h-11 pl-9.5 text-[14px]"
            />
            {draftQuery ? (
              <IconButton
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2"
                icon={<X className="size-3.5" />}
                onClick={() => {
                  setDraftQuery('')
                  setQuery('')
                }}
              />
            ) : null}
          </div>

          <Popover
            align="end"
            label="Filter by board"
            trigger={({ toggle, ref }) => (
              <Button
                ref={ref}
                variant={boardId ? 'secondary' : 'ghost'}
                onClick={toggle}
                icon={<SlidersHorizontal className="size-4" />}
              >
                {boardId ? (boards.data?.find((board) => board.id === boardId)?.title ?? 'Board') : 'All boards'}
              </Button>
            )}
          >
            {({ close }) => (
              <div className="max-h-64 w-56 overflow-y-auto">
                <PopoverItem
                  selected={!boardId}
                  onClick={() => {
                    setBoardId(undefined)
                    close()
                  }}
                >
                  All boards
                </PopoverItem>
                {(boards.data ?? []).map((board) => (
                  <PopoverItem
                    key={board.id}
                    selected={boardId === board.id}
                    icon={<span className={cn('size-2.5 rounded-full', swatchFor(board.color).solid)} />}
                    onClick={() => {
                      setBoardId(board.id)
                      close()
                    }}
                  >
                    {board.title}
                  </PopoverItem>
                ))}
              </div>
            )}
          </Popover>

          {activeFilters > 0 || draftQuery ? (
            <Button variant="ghost" onClick={clearAll} icon={<X className="size-4" />}>
              Clear
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {priorities.map((priority) => {
              const selected = priorities_.includes(priority)
              const meta = priorityMeta[priority]
              return (
                <button
                  key={priority}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setPriorities(selected ? priorities_.filter((value) => value !== priority) : [...priorities_, priority])
                  }
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium transition',
                    selected ? meta.chip : 'border-line bg-surface text-muted hover:text-fg',
                  )}
                >
                  <span className={cn('size-2 rounded-full', meta.bar)} />
                  {meta.label}
                </button>
              )
            })}
          </div>

          <SegmentedControl
            size="sm"
            value={due}
            onChange={(value) => setDue(value)}
            options={dueOptions.map((option) => ({ value: option.value, label: option.label }))}
          />

          <SegmentedControl
            size="sm"
            value={assignee === 'me' || assignee === 'unassigned' ? assignee : 'anyone'}
            onChange={(value) => setAssignee(value)}
            options={[
              { value: 'anyone', label: 'Anyone' },
              { value: 'me', label: 'Me' },
              { value: 'unassigned', label: 'Unassigned' },
            ]}
          />

          <Popover
            align="end"
            label="Sort results"
            trigger={({ toggle, ref }) => (
              <Button ref={ref} size="sm" variant="ghost" onClick={toggle}>
                Sort: {sortOptions.find((option) => option.value === sort)?.label}
              </Button>
            )}
          >
            {({ close }) => (
              <>
                <PopoverLabel>Order results</PopoverLabel>
                {sortOptions.map((option) => (
                  <PopoverItem
                    key={option.value}
                    selected={sort === option.value}
                    onClick={() => {
                      setSort(option.value as CardFilters['sort'])
                      close()
                    }}
                  >
                    {option.label}
                  </PopoverItem>
                ))}
              </>
            )}
          </Popover>

          <Badge className="ml-auto border-line bg-elevated text-muted">
            {results.isFetching ? 'Searching…' : `${pluralise(hits.length, 'result')}`}
          </Badge>
        </div>
      </header>

      {results.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-16 rounded-panel" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title={query ? 'No cards matched' : 'Start typing to search'}
          description={
            query
              ? 'Try a shorter phrase, or clear the filters to widen the search.'
              : 'Search covers card titles and descriptions across every board you can access.'
          }
          action={
            query ? (
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <CardList
          items={hits}
          showContext
          onOpen={(cardId) => {
            const card = hits.find((candidate) => candidate.id === cardId)
            if (card) navigate(`/boards/${card.boardId}?card=${card.id}`)
          }}
        />
      )}

      <p className="text-[12px] text-subtle">
        Including archived cards: {showArchived ? 'yes' : 'no'} — change this in a board&apos;s view options.
      </p>
    </div>
  )
}
