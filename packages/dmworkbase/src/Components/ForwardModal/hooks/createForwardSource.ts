import { useCallback, useEffect, useRef, useState } from "react"
import { canCacheForwardSources, readForwardScope } from "./useForwardScope"

export const FORWARD_SOURCE_TTL_MS = 30_000

export interface ForwardSource<T> {
  data: T | undefined
  loading: boolean
  error: boolean
  retry: () => void
}

interface Entry<T> {
  scope: string
  data?: T
  updatedAt?: number
  pending?: Promise<T>
}

/** One bounded, short-lived snapshot per source; requests coalesce across picker remounts. */
export function createForwardSource<T>() {
  let cached: Entry<T> | undefined

  function freshData(entry: Entry<T>): T | undefined {
    return entry.updatedAt !== undefined && Date.now() - entry.updatedAt < FORWARD_SOURCE_TTL_MS
      ? entry.data
      : undefined
  }

  return function useForwardSource(scope: string, fetchData: () => Promise<T>): ForwardSource<T> {
    const local = useRef<Entry<T>>({ scope })
    if (local.current.scope !== scope) local.current = { scope }
    if (cached?.scope !== scope) cached = undefined
    if (canCacheForwardSources() && !cached) cached = { scope }
    const entry = cached ?? local.current
    const [attempt, setAttempt] = useState(0)
    const [state, setState] = useState(() => ({
      entry,
      data: freshData(entry),
      loading: freshData(entry) === undefined,
      error: false,
    }))
    const retry = useCallback(() => setAttempt((value) => value + 1), [])

    useEffect(() => {
      let active = true
      const data = freshData(entry)
      if (data !== undefined && attempt === 0) {
        setState({ entry, data, loading: false, error: false })
        return
      }
      setState({ entry, data, loading: true, error: false })
      if (!entry.pending) {
        entry.pending = Promise.resolve().then(() => {
          if (readForwardScope() !== scope) throw new Error("forward_scope_changed")
          return fetchData()
        }).then((result) => {
          if (readForwardScope() === scope) {
            entry.data = result
            entry.updatedAt = Date.now()
          }
          return result
        }).finally(() => { entry.pending = undefined })
      }
      entry.pending.then(
        (result) => {
          if (active && readForwardScope() === scope) {
            setState({ entry, data: result, loading: false, error: false })
          }
        },
        () => {
          if (active && readForwardScope() === scope) {
            setState({ entry, data, loading: false, error: true })
          }
        },
      )
      return () => { active = false }
    }, [entry, scope, fetchData, attempt])

    if (state.entry !== entry) {
      const data = freshData(entry)
      return { data, loading: data === undefined, error: false, retry }
    }
    return { data: state.data, loading: state.loading, error: state.error, retry }
  }
}
