import { useState } from 'react'
import {
  Activity as ActivityIcon,
  Archive,
  CircleCheck,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Markdown } from '@/components/board/Markdown'
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Input,
  ProgressBar,
  Spinner,
  Textarea,
  Tooltip,
} from '@/components/ui/primitives'
import { cn, formatRelative, percent } from '@/lib/utils'
import type { Activity, ChecklistItem, Comment } from '@/lib/types'

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export function ChecklistPanel({
  items,
  readOnly,
  busy,
  onAdd,
  onToggle,
  onRename,
  onDelete,
}: {
  items: ChecklistItem[]
  readOnly: boolean
  busy?: boolean
  onAdd: (text: string) => void
  onToggle: (itemId: string, done: boolean) => void
  onRename: (itemId: string, text: string) => void
  onDelete: (itemId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const done = items.filter((item) => item.done).length
  const progress = percent(done, items.length)

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <CircleCheck aria-hidden className="size-4 text-muted" />
        <h3 className="text-[13px] font-semibold text-fg">Subtasks</h3>
        {items.length > 0 ? (
          <span className="text-[12px] text-subtle">
            {done}/{items.length} · {progress}%
          </span>
        ) : null}
        {busy ? <Spinner className="ml-auto" label="Saving subtasks" /> : null}
      </header>

      {items.length > 0 ? (
        <ProgressBar value={done} max={items.length} tone={progress === 100 ? 'success' : 'brand'} label="Subtask progress" />
      ) : null}

      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="group/item flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-elevated">
            <input
              type="checkbox"
              checked={item.done}
              disabled={readOnly}
              aria-label={item.text}
              onChange={(event) => onToggle(item.id, event.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line accent-[var(--brand)]"
            />
            {editing === item.id ? (
              <Input
                autoFocus
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                onBlur={() => {
                  if (editDraft.trim() && editDraft.trim() !== item.text) onRename(item.id, editDraft.trim())
                  setEditing(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    setEditDraft(item.text)
                    setEditing(null)
                  }
                }}
                className="h-7 flex-1 py-0 text-[13px]"
              />
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setEditing(item.id)
                  setEditDraft(item.text)
                }}
                className={cn(
                  'flex-1 text-left text-[13px] leading-6',
                  item.done ? 'text-subtle line-through' : 'text-fg',
                )}
              >
                {item.text}
              </button>
            )}
            {!readOnly ? (
              <IconButton
                aria-label={`Delete subtask ${item.text}`}
                onClick={() => onDelete(item.id)}
                icon={<Trash2 className="size-3.5" />}
                className="opacity-0 transition group-hover/item:opacity-100"
              />
            ) : null}
          </li>
        ))}
      </ul>

      {!readOnly ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="Add a subtask"
            aria-label="New subtask"
            className="h-8 py-0 text-[13px]"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={submit}
            disabled={!draft.trim()}
            icon={<Plus className="size-3.5" />}
          >
            Add
          </Button>
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function CommentsPanel({
  comments,
  currentUserId,
  readOnly,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: Comment[]
  currentUserId?: string
  readOnly: boolean
  busy?: boolean
  onAdd: (body: string) => Promise<unknown> | void
  onEdit: (commentId: string, body: string) => void
  onDelete: (commentId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const submit = async () => {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    await onAdd(body)
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <MessageSquare aria-hidden className="size-4 text-muted" />
        <h3 className="text-[13px] font-semibold text-fg">Discussion</h3>
        {comments.length > 0 ? <span className="text-[12px] text-subtle">{comments.length}</span> : null}
        {busy ? <Spinner className="ml-auto" label="Saving comment" /> : null}
      </header>

      {comments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-subtle">
          No comments yet. Notes here are visible to everyone on the board.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => {
            const own = comment.authorId === currentUserId
            return (
              <li key={comment.id} className="group/comment flex gap-2.5">
                <Avatar name={comment.authorName} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-fg">{comment.authorName}</span>
                    <span className="shrink-0 text-[11.5px] text-subtle" title={comment.createdAt}>
                      {formatRelative(comment.createdAt)}
                      {comment.updatedAt !== comment.createdAt ? ' · edited' : ''}
                    </span>
                    {own && !readOnly ? (
                      <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover/comment:opacity-100">
                        <IconButton
                          aria-label="Edit comment"
                          className="size-6"
                          icon={<Pencil className="size-3" />}
                          onClick={() => {
                            setEditing(comment.id)
                            setEditDraft(comment.body)
                          }}
                        />
                        <IconButton
                          aria-label="Delete comment"
                          className="size-6"
                          icon={<Trash2 className="size-3" />}
                          onClick={() => onDelete(comment.id)}
                        />
                      </span>
                    ) : null}
                  </div>

                  {editing === comment.id ? (
                    <div className="mt-1.5 space-y-1.5">
                      <Textarea
                        autoFocus
                        rows={3}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        className="text-[13px]"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            if (editDraft.trim()) onEdit(comment.id, editDraft.trim())
                            setEditing(null)
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Markdown className="mt-1 rounded-lg bg-elevated/60 px-2.5 py-2">{comment.body}</Markdown>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly ? (
        <div className="space-y-1.5">
          <Textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="Write a comment… Markdown works. Ctrl/⌘ + Enter to post"
            aria-label="New comment"
            className="text-[13px]"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void submit()}
              disabled={!draft.trim()}
              icon={<MessageSquare className="size-3.5" />}
            >
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const verbLabels: Record<string, string> = {
  'board.created': 'created this board',
  'board.updated': 'updated the board',
  'board.starred': 'starred the board',
  'board.unstarred': 'unstarred the board',
  'board.archived': 'archived the board',
  'board.restored': 'restored the board',
  'board.reordered': 'rearranged the board',
  'column.created': 'added a column',
  'column.updated': 'updated a column',
  'column.deleted': 'deleted a column',
  'column.reordered': 'reordered columns',
  'card.created': 'created this card',
  'card.updated': 'updated this card',
  'card.moved': 'moved this card',
  'card.archived': 'archived this card',
  'card.restored': 'restored this card',
  'card.deleted': 'deleted a card',
  'checklist.added': 'added a subtask',
  'comment.added': 'commented',
  'member.added': 'added a member',
  'member.removed': 'removed a member',
}

function verbIcon(verb: string) {
  if (verb.startsWith('comment')) return <MessageSquare aria-hidden className="size-3" />
  if (verb.startsWith('checklist')) return <CircleCheck aria-hidden className="size-3" />
  if (verb.startsWith('card.deleted') || verb.startsWith('card.archived')) return <Archive aria-hidden className="size-3" />
  return <ActivityIcon aria-hidden className="size-3" />
}

export function ActivityFeed({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon className="size-5" />}
        title="No activity yet"
        description="Changes to this card will show up here."
      />
    )
  }
  return (
    <ol className="space-y-2.5">
      {activity.map((entry) => (
        <li key={entry.id} className="flex gap-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-elevated text-muted">
            {verbIcon(entry.verb)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-5 text-fg">
              <span className="font-semibold">{entry.actorName}</span>{' '}
              <span className="text-muted">{verbLabels[entry.verb] ?? entry.verb}</span>
              {entry.summary ? <span className="text-muted"> · {entry.summary}</span> : null}
            </p>
            <p className="text-[11.5px] text-subtle" title={entry.createdAt}>
              {formatRelative(entry.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Small shared header used by every drawer section. */
export function PanelHeading({
  icon,
  title,
  count,
  action,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  action?: React.ReactNode
}) {
  return (
    <header className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {typeof count === 'number' ? <span className="text-[12px] text-subtle">{count}</span> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </header>
  )
}

/** Presentational danger action used in the drawer footer. */
export function DangerAction({
  label,
  hint,
  onClick,
  icon = <Trash2 className="size-3.5" />,
}: {
  label: string
  hint?: string
  onClick: () => void
  icon?: React.ReactNode
}) {
  return (
    <Tooltip label={hint ?? label}>
      <span className="inline-flex">
        <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={onClick} icon={icon}>
          {label}
        </Button>
      </span>
    </Tooltip>
  )
}

/** Close affordance used inside panels. */
export function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <IconButton aria-label={label} onClick={onClick} icon={<X className="size-3.5" />} className="size-6" />
}
