import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { eventsUrl } from '@/lib/api'
import { afterDrag } from '@/lib/dragState'
import { useAuthStore } from '@/store/auth'
import type { RealtimeEventType } from '@/lib/types'

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

/** Every event the server emits; each one refreshes the affected queries. */
const BOARD_SCOPED_EVENTS: RealtimeEventType[] = [
  'board.updated',
  'board.deleted',
  'board.reordered',
  'column.created',
  'column.updated',
  'column.deleted',
  'card.created',
  'card.updated',
  'card.moved',
  'card.deleted',
  'comment.added',
  'checklist.changed',
  'label.changed',
  'member.changed',
]

const INVALIDATE_DEBOUNCE_MS = 220

/**
 * Maintain a single SSE connection for the signed-in user and translate server
 * events into React Query invalidations.
 *
 * Invalidations are debounced and deferred while a drag is active so that
 * another user's edit can never yank a card out from under the pointer.
 */
export function useRealtime(): RealtimeStatus {
  const client = useQueryClient()
  const accessToken = useAuthStore((state) => state.accessToken)
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const retryRef = useRef(0)

  useEffect(() => {
    if (!accessToken) {
      setStatus('offline')
      return
    }
    const url = eventsUrl()
    if (!url) return

    let source: EventSource | null = null
    let flushTimer: number | null = null
    const dirtyBoards = new Set<string>()
    let closed = false

    const flush = () => {
      flushTimer = null
      const boards = Array.from(dirtyBoards)
      dirtyBoards.clear()
      afterDrag(() => {
        client.invalidateQueries({ queryKey: ['boards'] })
        client.invalidateQueries({ queryKey: ['stats'] })
        client.invalidateQueries({ queryKey: ['dashboard'] })
        client.invalidateQueries({ queryKey: ['search'] })
        for (const boardId of boards) {
          client.invalidateQueries({ queryKey: ['board', boardId] })
        }
      })
    }

    const schedule = (boardId?: string) => {
      if (boardId) dirtyBoards.add(boardId)
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flush, INVALIDATE_DEBOUNCE_MS)
      }
    }

    const connect = () => {
      if (closed) return
      source = new EventSource(url)

      source.addEventListener('open', () => {
        retryRef.current = 0
        setStatus('live')
      })

      source.addEventListener('hello', () => {
        retryRef.current = 0
        setStatus('live')
      })

      source.addEventListener('resync', () => {
        // We missed frames: refetch everything rather than reconcile.
        client.invalidateQueries()
      })

      for (const type of BOARD_SCOPED_EVENTS) {
        source.addEventListener(type, (event) => {
          let boardId: string | undefined
          try {
            boardId = (JSON.parse((event as MessageEvent<string>).data) as { boardId?: string }).boardId
          } catch {
            boardId = undefined
          }
          schedule(boardId ?? undefined)
        })
      }

      source.addEventListener('error', () => {
        setStatus('offline')
        // EventSource reconnects on its own, but a server restart can leave it
        // closed; recreate with a small backoff to be safe.
        source?.close()
        source = null
        if (closed) return
        retryRef.current = Math.min(retryRef.current + 1, 6)
        const delay = Math.min(1000 * 2 ** (retryRef.current - 1), 15_000)
        window.setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      closed = true
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      source?.close()
    }
  }, [accessToken, client])

  return status
}
