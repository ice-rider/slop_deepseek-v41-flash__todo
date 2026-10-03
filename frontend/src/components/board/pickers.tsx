import { useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, Tag, Target, User2, X } from 'lucide-react'
import { Avatar, Badge, IconButton, Input } from '@/components/ui/primitives'
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator } from '@/components/ui/Popover'
import { priorityMeta, priorities, swatchFor, swatchNames } from '@/lib/palette'
import { cn, fromDateInputValue, toDateInputValue } from '@/lib/utils'
import { formatDate } from '@/lib/i18n'
import type { Label, Member, Priority } from '@/lib/types'

/** Shared chip styling for the drawer's meta controls. */
const chipClass =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-fg transition hover:border-line-strong disabled:pointer-events-none disabled:opacity-60'

export function LabelPicker({
  labels,
  selectedIds,
  onToggle,
  onCreate,
  onManage,
  readOnly,
}: {
  labels: Label[]
  selectedIds: string[]
  onToggle: (labelId: string, attached: boolean) => void
  onCreate?: (name: string, color: string) => void
  onManage?: () => void
  readOnly: boolean
}) {
  const [draft, setDraft] = useState('')
  const selected = labels.filter((label) => selectedIds.includes(label.id))

  return (
    <Popover
      align="start"
      label="Labels"
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" disabled={readOnly} onClick={toggle} className={chipClass}>
          <Tag aria-hidden className="size-3.5 text-muted" />
          {selected.length === 0 ? (
            <span className="text-muted">Labels</span>
          ) : (
            <span className="flex items-center gap-1">
              {selected.slice(0, 3).map((label) => (
                <span
                  key={label.id}
                  className={cn('size-2.5 rounded-full', swatchFor(label.color).solid)}
                  title={label.name}
                />
              ))}
              <span className="text-muted">{selected.length}</span>
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5 text-subtle" />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <PopoverLabel>Labels on this board</PopoverLabel>
          {labels.length === 0 ? (
            <p className="px-2.5 py-2 text-[12.5px] text-subtle">No labels yet — create the first one below.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {labels.map((label) => {
                const active = selectedIds.includes(label.id)
                return (
                  <PopoverItem
                    key={label.id}
                    selected={active}
                    onClick={() => onToggle(label.id, active)}
                    icon={
                      <span className={cn('inline-block size-2.5 rounded-full', swatchFor(label.color).solid)} />
                    }
                    hint={active ? <Check className="size-3.5" /> : undefined}
                  >
                    {label.name}
                  </PopoverItem>
                )
              })}
            </div>
          )}

          {onCreate && !readOnly ? (
            <>
              <PopoverSeparator />
              <form
                className="flex items-center gap-1.5 px-1.5 pb-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = draft.trim()
                  if (!name) return
                  onCreate(name, swatchNames[name.length % swatchNames.length])
                  setDraft('')
                }}
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="New label"
                  aria-label="New label name"
                  className="h-8 py-0 text-[12.5px]"
                />
              </form>
            </>
          ) : null}

          {onManage ? (
            <>
              <PopoverSeparator />
              <PopoverItem
                icon={<Tag className="size-3.5" />}
                onClick={() => {
                  close()
                  onManage()
                }}
              >
                Manage labels
              </PopoverItem>
            </>
          ) : null}
        </>
      )}
    </Popover>
  )
}

export function AssigneePicker({
  members,
  value,
  onChange,
  readOnly,
}: {
  members: Member[]
  value: string | null
  onChange: (userId: string | null) => void
  readOnly: boolean
}) {
  const current = members.find((member) => member.userId === value)

  return (
    <Popover
      align="start"
      label="Assignee"
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" disabled={readOnly} onClick={toggle} className={chipClass}>
          {current ? (
            <>
              <Avatar name={current.name} color={current.avatarColor} size="xs" />
              <span className="max-w-32 truncate">{current.name}</span>
            </>
          ) : (
            <>
              <User2 aria-hidden className="size-3.5 text-muted" />
              <span className="text-muted">Assign</span>
            </>
          )}
          <ChevronDown aria-hidden className="size-3.5 text-subtle" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="max-h-64 overflow-y-auto">
          <PopoverItem
            selected={!value}
            icon={<User2 className="size-3.5" />}
            onClick={() => {
              onChange(null)
              close()
            }}
          >
            Unassigned
          </PopoverItem>
          <PopoverSeparator />
          {members.map((member) => (
            <PopoverItem
              key={member.userId}
              selected={member.userId === value}
              icon={<Avatar name={member.name} color={member.avatarColor} size="xs" />}
              onClick={() => {
                onChange(member.userId)
                close()
              }}
            >
              {member.name}
            </PopoverItem>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function PriorityPicker({
  value,
  onChange,
  readOnly,
}: {
  value: Priority
  onChange: (priority: Priority) => void
  readOnly: boolean
}) {
  const meta = priorityMeta[value]
  return (
    <Popover
      align="start"
      label="Priority"
      trigger={({ toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          disabled={readOnly}
          onClick={toggle}
          className={cn(chipClass, meta.chip, 'border')}
        >
          <Target aria-hidden className="size-3.5" />
          {meta.label}
          <ChevronDown aria-hidden className="size-3.5 opacity-60" />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {priorities.map((priority) => (
            <PopoverItem
              key={priority}
              selected={priority === value}
              onClick={() => {
                onChange(priority)
                close()
              }}
              icon={<span className={cn('inline-block size-2.5 rounded-full', priorityMeta[priority].bar)} />}
            >
              {priorityMeta[priority].label}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  )
}

export function DueDatePicker({
  value,
  onChange,
  readOnly,
}: {
  value: string | null
  onChange: (value: string | null) => void
  readOnly: boolean
}) {
  const dateValue = toDateInputValue(value)
  const quick = useMemo(() => {
    const base = new Date()
    base.setHours(17, 0, 0, 0)
    const offset = (days: number) => {
      const next = new Date(base)
      next.setDate(next.getDate() + days)
      return next.toISOString()
    }
    return [
      { label: 'Today', value: offset(0) },
      { label: 'Tomorrow', value: offset(1) },
      { label: 'In 3 days', value: offset(3) },
      { label: 'Next week', value: offset(7) },
      { label: 'In 2 weeks', value: offset(14) },
    ]
  }, [])

  return (
    <Popover
      align="start"
      label="Due date"
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" disabled={readOnly} onClick={toggle} className={chipClass}>
          <CalendarDays aria-hidden className="size-3.5 text-muted" />
          {value ? (
            <span>{formatDate(value, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          ) : (
            <span className="text-muted">Due date</span>
          )}
          {value ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear due date"
              className="ml-0.5 rounded p-0.5 text-subtle hover:text-fg"
              onClick={(event) => {
                event.stopPropagation()
                onChange(null)
              }}
            >
              <X className="size-3" />
            </span>
          ) : (
            <ChevronDown aria-hidden className="size-3.5 text-subtle" />
          )}
        </button>
      )}
    >
      {({ close }) => (
        <div className="w-56 space-y-2 p-1.5">
          <Input
            type="date"
            aria-label="Due date"
            value={dateValue}
            onChange={(event) => {
              onChange(fromDateInputValue(event.target.value))
              close()
            }}
            className="h-8 py-0 text-[12.5px]"
          />
          <div className="space-y-0.5">
            {quick.map((option) => (
              <PopoverItem
                key={option.label}
                onClick={() => {
                  onChange(option.value)
                  close()
                }}
              >
                {option.label}
              </PopoverItem>
            ))}
          </div>
          {value ? (
            <>
              <PopoverSeparator />
              <PopoverItem
                danger
                icon={<X className="size-3.5" />}
                onClick={() => {
                  onChange(null)
                  close()
                }}
              >
                Remove due date
              </PopoverItem>
            </>
          ) : null}
        </div>
      )}
    </Popover>
  )
}

export function CoverColorPicker({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (color: string) => void
  readOnly: boolean
}) {
  return (
    <Popover
      align="start"
      label="Cover colour"
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" disabled={readOnly} onClick={toggle} className={chipClass}>
          <span className={cn('inline-block size-3 rounded-sm', value ? swatchFor(value).solid : 'bg-line')} />
          <span className="text-muted">Cover</span>
        </button>
      )}
    >
      {({ close }) => (
        <div className="grid w-48 grid-cols-6 gap-1.5 p-2">
          <button
            type="button"
            aria-label="No cover"
            onClick={() => {
              onChange('')
              close()
            }}
            className={cn(
              'flex size-5 items-center justify-center rounded-full border border-line text-subtle',
              !value && 'ring-2 ring-fg',
            )}
          >
            <X className="size-3" />
          </button>
          {swatchNames.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              onClick={() => {
                onChange(name)
                close()
              }}
              className={cn(
                'size-5 rounded-full ring-offset-2 ring-offset-surface transition',
                swatchFor(name).solid,
                value === name ? 'ring-2 ring-fg' : 'hover:scale-110',
              )}
            />
          ))}
        </div>
      )}
    </Popover>
  )
}

/** Inline chip list shown under the card title in the drawer. */
export function CardLabelChips({
  labels,
  onRemove,
  readOnly,
}: {
  labels: Label[]
  onRemove: (labelId: string) => void
  readOnly: boolean
}) {
  if (labels.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => {
        const swatch = swatchFor(label.color)
        return (
          <Badge key={label.id} className={cn(swatch.soft, swatch.text, swatch.border)}>
            {label.name}
            {!readOnly ? (
              <IconButton
                aria-label={`Remove ${label.name}`}
                onClick={() => onRemove(label.id)}
                icon={<X className="size-3" />}
                className="-mr-1 size-4"
              />
            ) : null}
          </Badge>
        )
      })}
    </div>
  )
}
