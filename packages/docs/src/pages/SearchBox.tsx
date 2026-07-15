import { useEffect, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'

/** Debounce window before a keystroke triggers a server query (frontend-design §5.1). */
const DEBOUNCE_MS = 300

/**
 * Filename search input, shared by both tabs (frontend-design §5.1). Holds the raw input locally and
 * emits the (debounced) term to the owning view ~300ms after typing stops, so we don't fire a query
 * per keystroke. A `×` clears the term (and emits immediately). `value` is the view's committed term
 * so switching tabs restores the remembered search text.
 *
 * Server-side, a blank/whitespace term means "no search" (it does NOT trigger the search-empty
 * state) — matched here by trimming before compare so re-typing the same term is a no-op.
 */
export function SearchBox({
  value,
  onSearch,
  onClear,
}: {
  value: string
  onSearch: (term: string) => void
  onClear: () => void
}): React.ReactElement {
  const [text, setText] = useState(value)
  // Track the last committed value so an external change (tab switch restoring a term) re-syncs the
  // input without the debounce echoing it straight back as a new query.
  const committedRef = useRef(value)

  useEffect(() => {
    if (value !== committedRef.current) {
      committedRef.current = value
      setText(value)
    }
  }, [value])

  useEffect(() => {
    if (text.trim() === committedRef.current.trim()) return
    const id = window.setTimeout(() => {
      committedRef.current = text
      onSearch(text)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [text, onSearch])

  const clear = () => {
    setText('')
    committedRef.current = ''
    onClear()
  }

  return (
    <div className="octo-docs-search">
      <span className="octo-docs-search-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="text"
        className="octo-docs-search-input"
        placeholder={t('docs.search.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.length > 0 && (
        <button
          type="button"
          className="octo-docs-search-clear"
          aria-label={t('docs.empty.searchNoneCta')}
          onClick={clear}
        >
          ×
        </button>
      )}
    </div>
  )
}
