import { useState } from 'react'
import { Plus, Tag, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button, IconButton, Input } from '@/components/ui/primitives'
import { swatchFor, swatchNames } from '@/lib/palette'
import { cn } from '@/lib/utils'
import type { Label } from '@/lib/types'

/**
 * Board label management: rename, recolour and delete in one place, with the
 * same swatch palette used everywhere else so colours stay recognisable.
 */
export function LabelManagerDialog({
  open,
  labels,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  pending,
}: {
  open: boolean
  labels: Label[]
  onClose: () => void
  onCreate: (name: string, color: string) => void
  onUpdate: (labelId: string, patch: { name?: string; color?: string }) => void
  onDelete: (labelId: string) => void
  pending?: boolean
}) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('sky')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Labels"
      description="Labels are shared by everyone on this board."
      size="md"
    >
      <div className="space-y-4">
        <ul className="space-y-1.5">
          {labels.length === 0 ? (
            <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-subtle">
              No labels yet. Create your first one below.
            </li>
          ) : null}
          {labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2">
              <span className={cn('size-3 shrink-0 rounded-full', swatchFor(label.color).solid)} />
              {editing === label.id ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    if (draft.trim() && draft.trim() !== label.name) onUpdate(label.id, { name: draft.trim() })
                    setEditing(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEditing(null)
                  }}
                  className="h-7 py-0 text-[13px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(label.id)
                    setDraft(label.name)
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-fg"
                >
                  {label.name}
                </button>
              )}

              <div className="flex shrink-0 items-center gap-1">
                {swatchNames.slice(0, 8).map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Set ${label.name} to ${name}`}
                    onClick={() => onUpdate(label.id, { color: name })}
                    className={cn(
                      'size-3.5 rounded-full transition',
                      swatchFor(name).solid,
                      label.color === name ? 'ring-2 ring-fg ring-offset-1 ring-offset-surface' : 'hover:scale-125',
                    )}
                  />
                ))}
                <IconButton
                  aria-label={`Delete ${label.name}`}
                  className="ml-1 size-7 text-rose-600 dark:text-rose-400"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => onDelete(label.id)}
                />
              </div>
            </li>
          ))}
        </ul>

        <form
          className="flex items-center gap-2 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            const name = newName.trim()
            if (!name) return
            onCreate(name, newColor)
            setNewName('')
          }}
        >
          <Tag aria-hidden className="size-4 shrink-0 text-subtle" />
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New label name"
            aria-label="New label name"
            className="h-9 text-[13px]"
          />
          <div className="flex shrink-0 items-center gap-1">
            {swatchNames.slice(0, 8).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={`Use ${name}`}
                onClick={() => setNewColor(name)}
                className={cn(
                  'size-4 rounded-full transition',
                  swatchFor(name).solid,
                  newColor === name ? 'ring-2 ring-fg ring-offset-1 ring-offset-surface' : 'hover:scale-110',
                )}
              />
            ))}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={!newName.trim()}
            icon={<Plus className="size-3.5" />}
          >
            Add
          </Button>
        </form>
      </div>
    </Modal>
  )
}
