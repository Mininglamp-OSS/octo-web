import { useCallback, useEffect, useRef, useState } from 'react'
import { isUnavailableMarkerEndpoint, listAllCommentMarkers, type CommentMarker, type CommentThread } from '../comments/api.ts'

/** Keeps the complete unresolved marker set separate from the drawer's intentionally small page. */
export function useBoardCommentMarkers(docId: string, fallbackThreads: readonly CommentThread[] = []) {
  const [items, setItems] = useState<CommentMarker[]>([])
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await listAllCommentMarkers(docId)
      if (request !== requestRef.current) return
      setItems(next)
      setError(null)
    } catch (cause) {
      if (request !== requestRef.current) return
      if (isUnavailableMarkerEndpoint(cause)) {
        setItems(fallbackThreads.filter((thread) => !thread.resolved && !!thread.anchorStart).map((thread) => ({
          id: thread.id, anchorStart: thread.anchorStart!, anchorText: thread.anchorText, updatedAt: thread.updatedAt,
        })))
        setError(null)
        return
      }
      setError('Failed to load comment markers.')
    }
  }, [docId, fallbackThreads])

  useEffect(() => {
    void refresh()
    return () => {
      requestRef.current++
    }
  }, [refresh])

  return { items, error, refresh }
}
