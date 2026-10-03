import { type Ref } from 'react'
import {
  ArrowDownUp,
  Filter,
  LayoutGrid,
  List,
  Rows3,
  Search,
  SlidersHorizontal,
  Tag,
  User2,
  X,
} from 'lucide-react'
import { Badge, Button, IconButton, Input, SegmentedControl, Switch } from '@/components/ui/primitives'
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator } from '@/components/ui/Popover'
import { priorityMeta, priorities, swatchFor } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { isFilterActive, type CardFilters, type Label, type Member, type Priority } from '@/lib/types'

interface BoardToolbarProps {
  filters: CardFilters
  labels: Label[]
  members: Member[]
  matchCount: number
  totalCount: number
  view: 'board' | 'list'
  compact: boolean
  showArchived: boolean
  /** Controlled by the page so the `f` shortcut can toggle it. */
  filtersOpen: boolean
  onFiltersOpenChange: (open: boolean) => void
  searchRef?: Ref<HTMLInputElement>
  onFiltersChange: (patch: Partial<CardFilters>) => void
  onReset: () => void
  onViewChange: (view: 'board' | 'list') => void
  onCompactChange: (compact: boolean) => void
  onShowArchivedChange: (showArchived: boolean) => void
  onManageLabels: () => void
}

const assigneeOptions = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'me', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
] as const

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
  { value: 'created', label: 'Newest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title A–Z' },
] as const

/**
 * Board-level controls: search, filtering, sorting and view options.
 *
 * Filtering is client-side, so every keystroke narrows the board immediately
 * while the counts stay honest about how much is hidden.
 */
export function BoardToolbar({
  filters,
  labels,
  members,
  matchCount,
  totalCount,
  view,
  compact,
  showArchived,
  filtersOpen: showFilters,
  onFiltersOpenChange,
  searchRef,
  onFiltersChange,
  onReset,
  onViewChange,
  onCompactChange,
  onShowArchivedChange,
  onManageLabels,
}: BoardToolbarProps) {
  const active = isFilterActive(filters)
  const activeCount =
    filters.labelIds.length +
    filters.priorities.length +
    (filters.assignee === 'anyone' ? 0 : 1) +
    (filters.due === 'any' ? 0 : 1)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            ref={searchRef}
            value={filters.q}
            onChange={(event) => onFiltersChange({ q: event.target.value })}
            placeholder="Search this board…"
            aria-label="Search this board"
            className="h-9 pl-8.5 text-[13px]"
          />
          {filters.q ? (
            <IconButton
              aria-label="Clear search"
              className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
              icon={<X className="size-3.5" />}
              onClick={() => onFiltersChange({ q: '' })}
            />
          ) : null}
        </div>

        <Button
          variant={active || showFilters ? 'secondary' : 'ghost'}
          size="md"
          onClick={() => onFiltersOpenChange(!showFilters)}
          icon={<SlidersHorizontal className="size-4" />}
          aria-expanded={showFilters}
        >
          Filters
          {activeCount > 0 ? (
            <Badge className="border-brand/30 bg-brand-soft text-fg">{activeCount}</Badge>
          ) : null}
        </Button>

        <Popover
          align="end"
          label="Sort cards"
          trigger={({ toggle, ref }) => (
            <Button ref={ref} variant="ghost" onClick={toggle} icon={<ArrowDownUp className="size-4" />}>
              Sort
            </Button>
          )}
        >
          {({ close }) => (
            <>
              <PopoverLabel>Order within columns</PopoverLabel>
              {sortOptions.map((option) => (
                <PopoverItem
                  key={option.value}
                  selected={filters.sort === option.value}
                  onClick={() => {
                    onFiltersChange({ sort: option.value })
                    close()
                  }}
                >
                  {option.label}
                </PopoverItem>
              ))}
            </>
          )}
        </Popover>

        <SegmentedControl
          value={view}
          onChange={onViewChange}
          options={[
            { value: 'board', label: 'Board', icon: <LayoutGrid className="size-3.5" /> },
            { value: 'list', label: 'List', icon: <List className="size-3.5" /> },
          ]}
        />

        <Popover
          align="end"
          label="View options"
          trigger={({ toggle, ref }) => (
            <IconButton
              ref={ref}
              aria-label="View options"
              onClick={toggle}
              icon={<Rows3 className="size-4" />}
              variant="ghost"
            />
          )}
        >
          {() => (
            <div className="w-64 space-y-3 p-2">
              <Switch
                checked={compact}
                onChange={onCompactChange}
                label="Compact cards"
                description="Hide descriptions and tighten spacing."
              />
              <Switch
                checked={showArchived}
                onChange={onShowArchivedChange}
                label="Show archived"
                description="Include cards that were archived."
              />
              <div className="border-t border-line pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  icon={<Tag className="size-3.5" />}
                  onClick={onManageLabels}
                >
                  Manage labels
                </Button>
              </div>
            </div>
          )}
        </Popover>

        {active ? (
          <Button variant="ghost" onClick={onReset} icon={<X className="size-4" />}>
            Clear
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/60 px-2.5 py-2">
          <Filter aria-hidden className="size-3.5 shrink-0 text-subtle" />

          <Popover
            align="start"
            label="Filter by label"
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-medium transition',
                  filters.labelIds.length > 0
                    ? 'border-brand/40 bg-brand-soft text-fg'
                    : 'border-line bg-surface text-muted hover:text-fg',
                )}
              >
                <Tag aria-hidden className="size-3.5" />
                Labels
                {filters.labelIds.length > 0 ? <span>{filters.labelIds.length}</span> : null}
              </button>
            )}
          >
            {() => (
              <div className="max-h-60 w-52 overflow-y-auto">
                {labels.length === 0 ? (
                  <p className="px-2.5 py-2 text-[12.5px] text-subtle">No labels on this board yet.</p>
                ) : (
                  labels.map((label) => {
                    const selected = filters.labelIds.includes(label.id)
                    return (
                      <PopoverItem
                        key={label.id}
                        selected={selected}
                        icon={<span className={cn('inline-block size-2.5 rounded-full', swatchFor(label.color).solid)} />}
                        onClick={() =>
                          onFiltersChange({
                            labelIds: selected
                              ? filters.labelIds.filter((id) => id !== label.id)
                              : [...filters.labelIds, label.id],
                          })
                        }
                      >
                        {label.name}
                      </PopoverItem>
                    )
                  })
                )}
                <PopoverSeparator />
                <PopoverItem icon={<Tag className="size-3.5" />} onClick={onManageLabels}>
                  Manage labels
                </PopoverItem>
              </div>
            )}
          </Popover>

          <Popover
            align="start"
            label="Filter by priority"
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-medium transition',
                  filters.priorities.length > 0
                    ? 'border-brand/40 bg-brand-soft text-fg'
                    : 'border-line bg-surface text-muted hover:text-fg',
                )}
              >
                Priority
                {filters.priorities.length > 0 ? <span>{filters.priorities.length}</span> : null}
              </button>
            )}
          >
            {() =>
              priorities.map((priority: Priority) => {
                const selected = filters.priorities.includes(priority)
                return (
                  <PopoverItem
                    key={priority}
                    selected={selected}
                    icon={<span className={cn('inline-block size-2.5 rounded-full', priorityMeta[priority].bar)} />}
                    onClick={() =>
                      onFiltersChange({
                        priorities: selected
                          ? filters.priorities.filter((value) => value !== priority)
                          : [...filters.priorities, priority],
                      })
                    }
                  >
                    {priorityMeta[priority].label}
                  </PopoverItem>
                )
              })
            }
          </Popover>

          <Popover
            align="start"
            label="Filter by assignee"
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-medium transition',
                  filters.assignee !== 'anyone'
                    ? 'border-brand/40 bg-brand-soft text-fg'
                    : 'border-line bg-surface text-muted hover:text-fg',
                )}
              >
                <User2 aria-hidden className="size-3.5" />
                {assigneeOptions.find((option) => option.value === filters.assignee)?.label ??
                  members.find((member) => member.userId === filters.assignee)?.name ??
                  'Assignee'}
              </button>
            )}
          >
            {({ close }) => (
              <>
                {assigneeOptions.map((option) => (
                  <PopoverItem
                    key={option.value}
                    selected={filters.assignee === option.value}
                    onClick={() => {
                      onFiltersChange({ assignee: option.value })
                      close()
                    }}
                  >
                    {option.label}
                  </PopoverItem>
                ))}
                <PopoverSeparator />
                <PopoverLabel>Members</PopoverLabel>
                <div className="max-h-48 overflow-y-auto">
                  {members.map((member) => (
                    <PopoverItem
                      key={member.userId}
                      selected={filters.assignee === member.userId}
                      onClick={() => {
                        onFiltersChange({ assignee: member.userId })
                        close()
                      }}
                    >
                      {member.name}
                    </PopoverItem>
                  ))}
                </div>
              </>
            )}
          </Popover>

          <Popover
            align="start"
            label="Filter by due date"
            trigger={({ toggle, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-medium transition',
                  filters.due !== 'any'
                    ? 'border-brand/40 bg-brand-soft text-fg'
                    : 'border-line bg-surface text-muted hover:text-fg',
                )}
              >
                {dueOptions.find((option) => option.value === filters.due)?.label ?? 'Due'}
              </button>
            )}
          >
            {({ close }) =>
              dueOptions.map((option) => (
                <PopoverItem
                  key={option.value}
                  selected={filters.due === option.value}
                  onClick={() => {
                    onFiltersChange({ due: option.value })
                    close()
                  }}
                >
                  {option.label}
                </PopoverItem>
              ))
            }
          </Popover>

          <span className="ml-auto text-[12px] text-subtle">
            {active ? `${matchCount} of ${totalCount} cards match` : `${totalCount} cards`}
          </span>
        </div>
      ) : null}
    </div>
  )
}
