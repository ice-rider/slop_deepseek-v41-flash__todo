import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, AlertTriangle, LayoutGrid, Plus, Star, Users } from 'lucide-react'
import { BoardCreateDialog } from '@/components/board/dialogs'
import { Badge, Button, EmptyState, IconButton, ProgressBar, Skeleton, Switch } from '@/components/ui/primitives'
import { swatchFor } from '@/lib/palette'
import { cn, percent, pluralise } from '@/lib/utils'
import { useBoards } from '@/hooks/queries'
import { useBoardSettings } from '@/hooks/mutations'
import { ApiError } from '@/lib/api'
import type { BoardSummary } from '@/lib/types'

function BoardCard({
  board,
  onOpen,
  onToggleStar,
  onToggleArchive,
}: {
  board: BoardSummary
  onOpen: () => void
  onToggleStar: () => void
  onToggleArchive: () => void
}) {
  const swatch = swatchFor(board.color)
  const done = percent(board.doneCount, Math.max(1, board.cardCount))

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-panel border border-line bg-surface transition',
        'hover:border-line-strong hover:shadow-soft',
      )}
    >
      <div aria-hidden className={cn('h-16 bg-gradient-to-br', swatch.gradient)} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <h2 className="truncate text-[15px] font-semibold text-fg">{board.title}</h2>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
              {board.description || 'No description yet.'}
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              aria-label={board.starred ? `Unstar ${board.title}` : `Star ${board.title}`}
              className="size-7"
              onClick={onToggleStar}
              icon={<Star className={cn('size-3.5', board.starred && 'fill-amber-400 text-amber-400')} />}
            />
            <IconButton
              aria-label={board.archived ? `Restore ${board.title}` : `Archive ${board.title}`}
              className="size-7"
              onClick={onToggleArchive}
              icon={board.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11.5px] text-subtle">
            <span>
              {board.doneCount}/{board.cardCount} done
            </span>
            <span>{done}%</span>
          </div>
          <ProgressBar value={board.doneCount} max={Math.max(1, board.cardCount)} tone="success" />
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <Badge className="border-line bg-elevated text-muted">
            <LayoutGrid aria-hidden className="size-3" />
            {pluralise(board.columnCount, 'column')}
          </Badge>
          <Badge className="border-line bg-elevated text-muted">
            <Users aria-hidden className="size-3" />
            {board.role ?? 'member'}
          </Badge>
          {board.overdueCount > 0 ? (
            <Badge className="border-rose-500/30 bg-rose-500/12 text-rose-700 dark:text-rose-300">
              <AlertTriangle aria-hidden className="size-3" />
              {board.overdueCount} overdue
            </Badge>
          ) : null}
          {board.archived ? (
            <Badge className="border-line bg-elevated text-subtle">Archived</Badge>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto opacity-0 transition group-hover:opacity-100"
            onClick={onOpen}
          >
            Open
          </Button>
        </div>
      </div>
    </article>
  )
}

/** Gallery of every board the account can reach. */
export function BoardsPage() {
  const navigate = useNavigate()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const boards = useBoards(includeArchived)
  const updateBoard = useBoardSettings()

  const reportError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : 'Could not update the board')

  const toggleStar = (board: BoardSummary) => {
    updateBoard.mutate(
      { boardId: board.id, starred: !board.starred },
      {
        onSuccess: () => toast.success(board.starred ? 'Removed from starred' : 'Starred'),
        onError: reportError,
      },
    )
  }

  const toggleArchive = (board: BoardSummary) => {
    const archiving = !board.archived
    updateBoard.mutate(
      { boardId: board.id, archived: archiving },
      {
        onSuccess: () => toast.success(archiving ? 'Board archived' : 'Board restored'),
        onError: reportError,
      },
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-10 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Boards</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {boards.data ? `${pluralise(boards.data.length, 'board')} you can access.` : 'Loading your boards…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-56">
            <Switch
              checked={includeArchived}
              onChange={setIncludeArchived}
              label="Show archived"
              description="Include boards you archived."
            />
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
            New board
          </Button>
        </div>
      </header>

      {boards.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-52 rounded-panel" />
          ))}
        </div>
      ) : boards.data?.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-6" />}
          title="No boards yet"
          description="Boards hold your columns and cards. Start with a template — you can change everything later."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
              Create your first board
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {boards.data?.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onOpen={() => navigate(`/boards/${board.id}`)}
              onToggleStar={() => toggleStar(board)}
              onToggleArchive={() => toggleArchive(board)}
            />
          ))}
        </div>
      )}

      <BoardCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(boardId) => navigate(`/boards/${boardId}`)}
      />
    </div>
  )
}
