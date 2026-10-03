import { Command, Keyboard, MousePointerClick, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Kbd } from '@/components/ui/primitives'
import { prettyKeys, shortcutReference } from '@/hooks/useHotkeys'

/** Shortcut cheat sheet, grouped the same way the hotkeys are registered. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts and gestures"
      description="FlowBoard is built to be driven without the mouse."
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {shortcutReference.map((group) => (
            <section key={group.group} className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{group.group}</h3>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={`${group.group}-${item.keys}`} className="flex items-center gap-2 text-[13px]">
                    <span className="flex shrink-0 items-center gap-1">
                      {prettyKeys(item.keys).map((part) => (
                        <Kbd key={part}>{part}</Kbd>
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 text-muted">{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="space-y-2 rounded-xl border border-line bg-elevated/50 p-3.5">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            <MousePointerClick aria-hidden className="size-4 text-muted" />
            Mouse and touch
          </h3>
          <ul className="space-y-1 text-[12.5px] text-muted">
            <li>Drag a card by its face to reorder it or move it between columns.</li>
            <li>Click a card to open its full detail, comments and activity.</li>
            <li>Double-check a column title to rename it; the ⋯ menu holds colour, WIP limits and deletion.</li>
            <li>Drop a card into a column at its work-in-progress limit and the board will refuse, keeping your flow honest.</li>
          </ul>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line p-3">
            <Sparkles aria-hidden className="size-4 text-brand" />
            <p className="mt-1.5 text-[12.5px] font-medium text-fg">Realtime</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Boards sync live for everyone. The status pill in the header shows the stream state.
            </p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <Command aria-hidden className="size-4 text-brand" />
            <p className="mt-1.5 text-[12.5px] font-medium text-fg">Command palette</p>
            <p className="mt-0.5 text-[12px] text-muted">
              ⌘K searches boards, cards and actions — the fastest way to jump anywhere.
            </p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <Keyboard aria-hidden className="size-4 text-brand" />
            <p className="mt-1.5 text-[12.5px] font-medium text-fg">Keyboard drag</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Focus a card, press Space to lift it, use the arrow keys and Space again to drop.
            </p>
          </div>
        </section>
      </div>
    </Modal>
  )
}
