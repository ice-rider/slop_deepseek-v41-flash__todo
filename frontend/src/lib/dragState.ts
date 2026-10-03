/**
 * Drag bookkeeping shared between the board and the realtime layer.
 *
 * While a drag is in flight the local cache holds the optimistic arrangement.
 * An incoming server event at that moment would overwrite it, so realtime
 * invalidation is deferred until the drop settles.
 */

let dragging = false
let pending: (() => void) | null = null

export function setDragging(value: boolean): void {
  dragging = value
  if (!value && pending) {
    const flush = pending
    pending = null
    // Run after the drop handler has committed its optimistic state.
    queueMicrotask(flush)
  }
}

export function isDragging(): boolean {
  return dragging
}

/** Run `task` now, or once the current drag finishes. */
export function afterDrag(task: () => void): void {
  if (!dragging) {
    task()
    return
  }
  pending = task
}
