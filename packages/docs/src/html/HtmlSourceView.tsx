// Read-only raw-HTML SOURCE view (code mode of HtmlDocView).
//
// Renders the published source EXACTLY as stored — never executed, never editable. Dependency-free:
// line numbers, a tiny hand-rolled HTML tokenizer for light coloring (tags / attrs / strings /
// comments / doctype), a wrap toggle and copy-all. No Monaco, no highlighter lib, no new deps.
//
// Browser search (Cmd/Ctrl-F) works because the source is laid out as real, selectable text nodes
// (not canvas / virtualised rows). Loads lazily per slug:version and revalidates with octo-doc on
// every mount so current authorization is always enforced by the backend.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getVersionSource } from './htmlDocSourceApi.ts'
import { t } from '../octoweb/index.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; text: string }

// ---- tiny HTML tokenizer (pure, escaping-safe) -----------------------------------------------
// Split one line into colored spans. Operates on already-escaped text is NOT possible (we need the
// raw < > to classify), so we classify the RAW characters and emit React nodes (React escapes the
// text content for us — no dangerouslySetInnerHTML, no injection surface).

interface Tok {
  cls: string
  text: string
}

// Classify a single line of raw HTML source into tokens. Stateful across lines for multi-line
// comments is handled by the caller via `inComment`.
function tokenizeLine(line: string, inComment: boolean): { toks: Tok[]; inComment: boolean } {
  const toks: Tok[] = []
  let i = 0
  let comment = inComment
  const push = (cls: string, text: string) => {
    if (text) toks.push({ cls, text })
  }
  while (i < line.length) {
    if (comment) {
      const end = line.indexOf('-->', i)
      if (end === -1) {
        push('src-comment', line.slice(i))
        i = line.length
      } else {
        push('src-comment', line.slice(i, end + 3))
        i = end + 3
        comment = false
      }
      continue
    }
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4)
      if (end === -1) {
        push('src-comment', line.slice(i))
        i = line.length
        comment = true
      } else {
        push('src-comment', line.slice(i, end + 3))
        i = end + 3
      }
      continue
    }
    if (line[i] === '<') {
      // A tag runs until the matching '>' (or end-of-line). Color the tag name + attrs inside.
      const end = line.indexOf('>', i)
      const tagEnd = end === -1 ? line.length : end + 1
      pushTag(line.slice(i, tagEnd), push)
      i = tagEnd
      continue
    }
    // Plain text run until the next '<'.
    const next = line.indexOf('<', i)
    const to = next === -1 ? line.length : next
    push('src-text', line.slice(i, to))
    i = to
  }
  return { toks, inComment: comment }
}

// Break a `<...>` slice into punctuation / tag-name / attribute-name / string tokens.
function pushTag(tag: string, push: (cls: string, text: string) => void) {
  // Leading punctuation: '<', '</', '<!doctype', etc.
  const m = /^<\/?[a-zA-Z][\w:-]*/.exec(tag)
  if (!m) {
    push('src-punct', tag)
    return
  }
  push('src-tag', m[0])
  let rest = tag.slice(m[0].length)
  // attr="value" / attr='value' / attr / punctuation
  const attrRe = /([a-zA-Z_:][\w:.-]*)(\s*=\s*)("(?:[^"]*)"|'(?:[^']*)')?|("(?:[^"]*)"|'(?:[^']*)')|(\s+)|(.)/g
  let mm: RegExpExecArray | null
  while ((mm = attrRe.exec(rest))) {
    if (mm[1] != null) {
      push('src-attr', mm[1])
      if (mm[2]) push('src-punct', mm[2])
      if (mm[3]) push('src-string', mm[3])
    } else if (mm[4] != null) {
      push('src-string', mm[4])
    } else if (mm[5] != null) {
      push('src-text', mm[5])
    } else if (mm[6] != null) {
      push('src-punct', mm[6])
    }
    if (attrRe.lastIndex >= rest.length) break
  }
}

/** Render one source line as colored spans (keyed for React). */
function LineSpans({ toks }: { toks: Tok[] }): ReactNode {
  return toks.map((tk, idx) => (
    <span key={idx} className={tk.cls}>
      {tk.text}
    </span>
  ))
}

export interface HtmlSourceViewProps {
  slug: string
  version: string
}

/**
 * Lazy-loaded, read-only source panel. Owns its own abortable, race-guarded fetch.
 * The version toggle above it drives `version`; every mount or version change revalidates access.
 */
export function HtmlSourceView({ slug, version }: HtmlSourceViewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setState({ status: 'loading' })
    getVersionSource(slug, version, controller.signal)
      .then((text) => {
        if (cancelled) return
        setState({ status: 'ready', text })
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return
        setState({ status: 'error' })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [slug, version])

  // Tokenize once per source text (carrying multi-line comment state between lines).
  const lines = useMemo(() => {
    if (state.status !== 'ready') return []
    const raw = state.text.replace(/\r\n?/g, '\n').split('\n')
    let inComment = false
    return raw.map((line) => {
      const r = tokenizeLine(line, inComment)
      inComment = r.inComment
      return r.toks
    })
  }, [state])

  const copyAll = () => {
    if (state.status !== 'ready') return
    const write =
      typeof navigator !== 'undefined' && navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(state.text)
        : Promise.reject(new Error('no clipboard'))
    Promise.resolve(write)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard blocked — silent, the source is still selectable/copyable by hand */
      })
  }

  return (
    <div className="octo-html-doc-source" data-testid="html-doc-source">
      <div className="octo-html-doc-source-bar">
        <button
          type="button"
          className={wrap ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
          aria-pressed={wrap}
          onClick={() => setWrap((v) => !v)}
        >
          {t('docs.source.wrap')}
        </button>
        <button
          type="button"
          className="octo-tb-btn"
          onClick={copyAll}
          disabled={state.status !== 'ready'}
        >
          {copied ? t('docs.source.copied') : t('docs.source.copyAll')}
        </button>
      </div>
      {state.status === 'loading' && (
        <div className="octo-html-doc-state" role="status">
          {t('docs.state.loading')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="octo-html-doc-state octo-html-doc-state--error" role="alert">
          {t('docs.source.error')}
        </div>
      )}
      {state.status === 'ready' && (
        <pre
          className={wrap ? 'octo-html-doc-source-code is-wrap' : 'octo-html-doc-source-code'}
          data-testid="html-doc-source-code"
        >
          <code>
            {lines.map((toks, idx) => (
              <div className="octo-src-line" key={idx}>
                <span className="octo-src-ln" aria-hidden="true">
                  {idx + 1}
                </span>
                <span className="octo-src-content">
                  <LineSpans toks={toks} />
                </span>
              </div>
            ))}
          </code>
        </pre>
      )}
    </div>
  )
}
