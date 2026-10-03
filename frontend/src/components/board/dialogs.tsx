import { useState } from 'react'
import { LayoutDashboard, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/primitives'
import { swatchFor, swatchNames } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { useCreateBoard } from '@/hooks/mutations'
import { useMeta } from '@/hooks/queries'
import { ApiError } from '@/lib/api'

const defaultTemplates = [
  { id: 'kanban', name: 'Classic kanban', description: 'Backlog → To do → In progress → Review → Done' },
  { id: 'sprint', name: 'Sprint board', description: 'Sprint backlog → In progress → Blocked → Done' },
  { id: 'personal', name: 'Personal planner', description: 'Today → This week → Someday → Done' },
  { id: 'blank', name: 'Simple list', description: 'To do → Done' },
]

const boardColors = ['indigo', 'violet', 'sky', 'emerald', 'amber', 'rose', 'cyan', 'fuchsia']

/** Create-board dialog with the same starter templates the API advertises. */
export function BoardCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (boardId: string) => void
}) {
  const meta = useMeta()
  const createBoard = useCreateBoard()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('kanban')
  const [color, setColor] = useState('indigo')
  const [error, setError] = useState<string | null>(null)

  const templates = meta.data?.templates?.length ? meta.data.templates : defaultTemplates

  const reset = () => {
    setTitle('')
    setDescription('')
    setTemplate('kanban')
    setColor('indigo')
    setError(null)
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('Give your board a name.')
      return
    }
    try {
      const result = await createBoard.mutateAsync({ title: title.trim(), description, template, color })
      reset()
      onCreated(result.board.id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the board.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="New board"
      description="Pick a starting layout — you can add, rename and recolour columns later."
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={createBoard.isPending}
            onClick={() => void submit()}
            icon={<Plus className="size-4" />}
          >
            Create board
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Board name" error={error} htmlFor="board-title">
          <Input
            id="board-title"
            value={title}
            data-autofocus
            placeholder="e.g. Q3 product launch"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </Field>

        <Field label="Description" hint="Optional — a sentence about what this board is for." htmlFor="board-description">
          <Textarea
            id="board-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-muted">Template</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((option) => {
              const active = template === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTemplate(option.id)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-xl border p-3 text-left transition',
                    active
                      ? 'border-brand bg-brand-soft/60 shadow-soft'
                      : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                    <LayoutDashboard aria-hidden className="size-3.5 text-muted" />
                    {option.name}
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">{option.description}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-muted">Accent colour</p>
          <div className="flex flex-wrap gap-2">
            {boardColors.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={color === name}
                onClick={() => setColor(name)}
                className={cn(
                  'size-7 rounded-full ring-offset-2 ring-offset-surface transition',
                  swatchFor(name).solid,
                  color === name ? 'ring-2 ring-fg' : 'hover:scale-110',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Small dialog for adding a column to the open board. */
export function ColumnCreateDialog({
  open,
  onClose,
  onSubmit,
  pending,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: { title: string; color: string; wipLimit: number; isDone: boolean }) => void
  pending?: boolean
}) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState('sky')
  const [wipLimit, setWipLimit] = useState(0)
  const [isDone, setIsDone] = useState(false)

  const reset = () => {
    setTitle('')
    setColor('sky')
    setWipLimit(0)
    setIsDone(false)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="New column"
      description="Columns are the stages a card moves through."
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!title.trim()}
            onClick={() => {
              onSubmit({ title: title.trim(), color, wipLimit, isDone })
              reset()
            }}
          >
            Add column
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="column-title">
          <Input
            id="column-title"
            value={title}
            data-autofocus
            placeholder="e.g. Waiting for review"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim()) {
                onSubmit({ title: title.trim(), color, wipLimit, isDone })
                reset()
              }
            }}
          />
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {swatchNames.slice(0, 10).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={color === name}
                onClick={() => setColor(name)}
                className={cn(
                  'size-6 rounded-full ring-offset-2 ring-offset-surface transition',
                  swatchFor(name).solid,
                  color === name ? 'ring-2 ring-fg' : 'hover:scale-110',
                )}
              />
            ))}
          </div>
        </Field>

        <Field label="Work-in-progress limit" hint="0 means unlimited. Cards are blocked from entering once full.">
          <Input
            type="number"
            min={0}
            max={99}
            value={wipLimit}
            onChange={(event) => setWipLimit(Math.max(0, Number(event.target.value) || 0))}
          />
        </Field>

        <Switch
          checked={isDone}
          onChange={setIsDone}
          label="Cards here count as done"
          description="Moving a card in marks it complete and records the time."
        />
      </div>
    </Modal>
  )
}
