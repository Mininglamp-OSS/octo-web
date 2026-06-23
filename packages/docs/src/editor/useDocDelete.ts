// Document delete flow (Problem 4) — the delete entry moved from the list row to the editor
// detail page, but the CONTRACT (200/404/403/409) is unchanged, just relocated here behind a
// reusable hook so both the UI and its tests share one source of truth.

import { useState } from 'react'
import { deleteDoc, classifyDeleteStatus, deleteErrorKey } from '../pages/docsApi.ts'
import { t, type ApiError } from '../octoweb/index.ts'

export interface UseDocDelete {
  /** True while the confirm dialog is open. */
  confirming: boolean
  /** True while the DELETE request is in flight. */
  deleting: boolean
  /** Localized error message for a 403/409/other failure (null when none). */
  error: string | null
  /** Open the second-step confirm. */
  requestDelete: () => void
  /** Dismiss the confirm without deleting (no-op while a delete is in flight). */
  cancel: () => void
  /** Perform the delete; on success (200) or already-gone (404) calls onDeleted(docId). */
  confirm: () => Promise<void>
}

/**
 * Stateful delete flow for a single document. `onDeleted` fires on a successful delete (200) and
 * on a 404 (already gone → treat as deleted), so the caller can return to the list. A 403/409/other
 * surfaces a localized error and keeps the document.
 */
export function useDocDelete(docId: string, onDeleted?: (docId: string) => void): UseDocDelete {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function requestDelete() {
    setError(null)
    setConfirming(true)
  }

  function cancel() {
    if (deleting) return
    setConfirming(false)
  }

  async function confirm() {
    setDeleting(true)
    setError(null)
    try {
      await deleteDoc(docId)
      onDeleted?.(docId)
    } catch (e) {
      const outcome = classifyDeleteStatus((e as ApiError).response?.status)
      if (outcome === 'gone') {
        onDeleted?.(docId) // 404 → already removed; treat as a successful delete.
        return
      }
      setError(t(deleteErrorKey(outcome)))
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return { confirming, deleting, error, requestDelete, cancel, confirm }
}
