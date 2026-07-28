// HTML version diff backed by the server's bounded structural changes and source hunks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDiff, type DiffChange, type DiffCodeHunk, type DiffResult } from './htmlDocSourceApi.ts'
import { HtmlPreviewFrame } from './HtmlPreviewFrame.tsx'
import { t } from '../octoweb/index.ts'

type DiffTab = 'code' | 'page'
type PageLayout = 'both' | 'old' | 'new'

interface DiffRow {
  op: 'equal' | 'add' | 'remove'
  oldLine?: number
  newLine?: number
  oldText?: string
  newText?: string
}

export interface HtmlDiffModalProps {
  slug: string
  /** Older version (left / 旧版). */
  from: string
  /** Newer version (right / 新版). */
  to: string
  title: string
  onClose: () => void
}

function CodeRow({ row }: { row: DiffRow }) {
  const cls =
    row.op === 'add'
      ? 'octo-diff-row is-add'
      : row.op === 'remove'
      ? 'octo-diff-row is-remove'
      : 'octo-diff-row'
  const text = row.op === 'add' ? row.newText : row.op === 'remove' ? row.oldText : row.newText
  const mark = row.op === 'add' ? '+' : row.op === 'remove' ? '-' : ' '
  return (
    <div className={cls} data-testid="diff-row">
      <span className="octo-diff-ln octo-diff-ln-old" aria-hidden="true">
        {row.oldLine ?? ''}
      </span>
      <span className="octo-diff-ln octo-diff-ln-new" aria-hidden="true">
        {row.newLine ?? ''}
      </span>
      <span className="octo-diff-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="octo-diff-text">{text}</span>
    </div>
  )
}

// This inline style targets isolated third-party iframe content, where product CSS tokens cannot apply.
const HIGHLIGHT_STYLE = 'outline:2px solid #FC8800;outline-offset:2px;'

function domPathSelector(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (!parts.length) return null
  const selectors = parts.map((part) => {
    const match = /^([a-zA-Z][\w:-]*)(?:\[(\d+)\])?$/.exec(part)
    if (!match) return null
    return match[2] ? `${match[1]}:nth-of-type(${match[2]})` : match[1]
  })
  return selectors.every(Boolean) ? selectors.join(' > ') : null
}

function aidSelector(aid: string): string {
  const cssApi = typeof CSS !== 'undefined' ? CSS : undefined
  const escaped = cssApi?.escape ? cssApi.escape(aid) : aid.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `[data-odoc-aid="${escaped}"]`
}

export function highlightChanges(
  doc: Document | null,
  changes: DiffChange[],
  side: 'old' | 'new',
): Array<Element | null> {
  if (!doc) return changes.map(() => null)
  const hits: Array<Element | null> = []
  for (const c of changes) {
    if (side === 'old' && c.kind === 'added') {
      hits.push(null)
      continue
    }
    if (side === 'new' && c.kind === 'removed') {
      hits.push(null)
      continue
    }
    const aid = side === 'old' ? c.before_aid : c.after_aid
    const path = side === 'old' ? c.before_path ?? c.dom_path : c.after_path ?? c.dom_path
    let el: Element | null = null
    if (aid) {
      try {
        el = doc.querySelector(aidSelector(aid))
      } catch {
        el = null
      }
    }
    const pathSelector = domPathSelector(path)
    if (!el && pathSelector) {
      try {
        el = doc.querySelector(pathSelector)
      } catch {
        el = null
      }
    }
    if (el) {
      el.setAttribute('style', `${el.getAttribute('style') ?? ''};${HIGHLIGHT_STYLE}`)
      el.setAttribute('data-odoc-changed', c.kind)
    }
    hits.push(el)
  }
  return hits
}

export function codeHunksToRows(hunks: DiffCodeHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    let oldLine = hunk.old_start
    let newLine = hunk.new_start
    for (const line of hunk.lines) {
      const prefix = line[0]
      const text = line.slice(1)
      if (prefix === ' ') {
        rows.push({
          op: 'equal',
          oldLine,
          newLine,
          oldText: text,
          newText: text,
        })
        oldLine++
        newLine++
      } else if (prefix === '-') {
        rows.push({ op: 'remove', oldLine, oldText: text })
        oldLine++
      } else if (prefix === '+') {
        rows.push({ op: 'add', newLine, newText: text })
        newLine++
      } else {
        throw new Error('octo-doc diff hunk line has an invalid prefix')
      }
    }
  }
  return rows
}

export function HtmlDiffModal({ slug, from, to, title, onClose }: HtmlDiffModalProps) {
  const [tab, setTab] = useState<DiffTab>('code')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [layout, setLayout] = useState<PageLayout>('both')
  const [syncScroll, setSyncScroll] = useState(true)
  const [changeIdx, setChangeIdx] = useState(0)

  const dialogRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<DiffTab, HTMLButtonElement | null>>({ code: null, page: null })
  const oldDocRef = useRef<Document | null>(null)
  const newDocRef = useRef<Document | null>(null)
  const oldHits = useRef<Array<Element | null>>([])
  const newHits = useRef<Array<Element | null>>([])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setStatus('loading')
    setDiff(null)
    getDiff(slug, from, to, controller.signal)
      .then((d) => {
        if (cancelled) return
        setDiff(d)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return
        setStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [slug, from, to])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hidden && !element.closest('[hidden]') && element.getAttribute('aria-hidden') !== 'true',
      )
      if (!focusable.length) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [onClose])

  const rows = useMemo<DiffRow[]>(() => {
    return diff ? codeHunksToRows(diff.code_hunks) : []
  }, [diff])

  const changes = diff?.changes ?? []

  // Sync-scroll: mirror the driving frame's scroll ratio onto the other (closeable / proportional).
  const wireSyncScroll = useCallback(() => {
    const od = oldDocRef.current
    const nd = newDocRef.current
    if (!od || !nd) return () => {}
    let lock = false
    const mirror = (src: Document, dst: Document) => () => {
      if (!syncScroll || lock) return
      lock = true
      const se = src.scrollingElement ?? src.documentElement
      const de = dst.scrollingElement ?? dst.documentElement
      const max = se.scrollHeight - se.clientHeight
      const ratio = max > 0 ? se.scrollTop / max : 0
      const dmax = de.scrollHeight - de.clientHeight
      de.scrollTop = ratio * dmax
      lock = false
    }
    const a = mirror(od, nd)
    const b = mirror(nd, od)
    od.addEventListener('scroll', a, { passive: true })
    nd.addEventListener('scroll', b, { passive: true })
    return () => {
      od.removeEventListener('scroll', a)
      nd.removeEventListener('scroll', b)
    }
  }, [syncScroll])

  const cleanupSync = useRef<() => void>(() => {})
  const onFrameLoad = useCallback(
    (side: 'old' | 'new') => (doc: Document | null) => {
      if (side === 'old') oldDocRef.current = doc
      else newDocRef.current = doc
      if (side === 'old') oldHits.current = highlightChanges(doc, changes, 'old')
      else newHits.current = highlightChanges(doc, changes, 'new')
      cleanupSync.current?.()
      cleanupSync.current = wireSyncScroll()
    },
    [changes, wireSyncScroll],
  )

  useEffect(() => {
    cleanupSync.current?.()
    cleanupSync.current = wireSyncScroll()
    return () => cleanupSync.current?.()
  }, [wireSyncScroll])

  const gotoChange = useCallback(
    (delta: number) => {
      const total = changes.length
      if (!total) return
      const next = (changeIdx + delta + total) % total
      setChangeIdx(next)
      const c = changes[next]
      const scrollTo = (el: Element | null | undefined) => el?.scrollIntoView({ block: 'center' })
      scrollTo(c.kind === 'removed' ? oldHits.current[next] : newHits.current[next] ?? oldHits.current[next])
    },
    [changeIdx, changes],
  )

  const selectTab = useCallback((nextTab: DiffTab) => {
    setTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }, [])

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: DiffTab) => {
      let nextTab: DiffTab | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') nextTab = currentTab === 'code' ? 'page' : 'code'
      else if (event.key === 'Home') nextTab = 'code'
      else if (event.key === 'End') nextTab = 'page'
      if (!nextTab) return
      event.preventDefault()
      selectTab(nextTab)
    },
    [selectTab],
  )

  const tabButton = (id: DiffTab, label: string) => (
    <button
      ref={(node) => { tabRefs.current[id] = node }}
      type="button"
      role="tab"
      id={`html-diff-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`html-diff-panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      className={tab === id ? 'octo-diff-tab is-active' : 'octo-diff-tab'}
      onClick={() => setTab(id)}
      onKeyDown={(event) => handleTabKeyDown(event, id)}
    >
      {label}
    </button>
  )

  return (
    <div className="octo-modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="octo-modal octo-html-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('docs.diff.title')}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="html-diff-modal"
      >
        <div className="octo-html-diff-head">
          <h3 className="octo-html-diff-title" title={title}>
            {t('docs.diff.heading', { values: { from, to } })}
          </h3>
          <button type="button" className="octo-tb-btn" onClick={onClose} aria-label={t('docs.member.close')}>
            {t('docs.member.close')}
          </button>
        </div>

        <div className="octo-diff-tabs" role="tablist" aria-label={t('docs.diff.title')}>
          {tabButton('code', t('docs.diff.tabCode'))}
          {tabButton('page', t('docs.diff.tabPage'))}
        </div>

        {status === 'loading' && (
          <div className="octo-html-doc-state" role="status">
            {t('docs.state.loading')}
          </div>
        )}
        {status === 'error' && (
          <div className="octo-html-doc-state octo-html-doc-state--error" role="alert">
            {t('docs.diff.error')}
          </div>
        )}

        <div
          id="html-diff-panel-code"
          role="tabpanel"
          aria-labelledby="html-diff-tab-code"
          className="octo-diff-code-panel"
          data-testid="html-diff-code"
          hidden={status !== 'ready' || tab !== 'code'}
        >
          {status === 'ready' &&
            (rows.every((r) => r.op === 'equal') ? (
              <p className="octo-member-empty">{t('docs.diff.noChanges')}</p>
            ) : (
              <pre className="octo-diff-code" data-testid="html-diff-code-pre">
                <code>
                  {rows.map((row, i) => (
                    <CodeRow key={i} row={row} />
                  ))}
                </code>
              </pre>
            ))}
        </div>

        <div
          id="html-diff-panel-page"
          role="tabpanel"
          aria-labelledby="html-diff-tab-page"
          className="octo-diff-page-panel"
          data-testid="html-diff-page"
          hidden={status !== 'ready' || tab !== 'page'}
        >
          {status === 'ready' && tab === 'page' && (
            <>
            <div className="octo-diff-toolbar">
              <div className="octo-diff-layout" role="group" aria-label={t('docs.diff.layout')}>
                <button
                  type="button"
                  className={layout === 'both' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
                  aria-pressed={layout === 'both'}
                  onClick={() => setLayout('both')}
                >
                  {t('docs.diff.layoutBoth')}
                </button>
                <button
                  type="button"
                  className={layout === 'old' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
                  aria-pressed={layout === 'old'}
                  onClick={() => setLayout('old')}
                >
                  {t('docs.diff.layoutOld')}
                </button>
                <button
                  type="button"
                  className={layout === 'new' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
                  aria-pressed={layout === 'new'}
                  onClick={() => setLayout('new')}
                >
                  {t('docs.diff.layoutNew')}
                </button>
              </div>
              <label className="octo-diff-sync">
                <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} />
                {t('docs.diff.syncScroll')}
              </label>
              {changes.length > 0 && (
                <div className="octo-diff-nav" role="group" aria-label={t('docs.diff.navChanges')}>
                  <button type="button" className="octo-tb-btn" onClick={() => gotoChange(-1)}>
                    {t('docs.diff.prevChange')}
                  </button>
                  <span className="octo-diff-nav-count">
                    {changeIdx + 1}/{changes.length}
                  </span>
                  <button type="button" className="octo-tb-btn" onClick={() => gotoChange(1)}>
                    {t('docs.diff.nextChange')}
                  </button>
                </div>
              )}
            </div>
            <div className={`octo-diff-frames layout-${layout}`}>
              {layout !== 'new' && (
                <div className="octo-diff-frame-col" data-testid="html-diff-old">
                  <div className="octo-diff-frame-label">{t('docs.diff.oldVersion', { values: { v: from } })}</div>
                  <HtmlPreviewFrame
                    slug={slug}
                    version={from}
                    title={`${title} · v${from}`}
                    className="octo-html-doc-frame octo-diff-frame"
                    onFrameLoad={onFrameLoad('old')}
                  />
                </div>
              )}
              {layout !== 'old' && (
                <div className="octo-diff-frame-col" data-testid="html-diff-new">
                  <div className="octo-diff-frame-label">{t('docs.diff.newVersion', { values: { v: to } })}</div>
                  <HtmlPreviewFrame
                    slug={slug}
                    version={to}
                    title={`${title} · v${to}`}
                    className="octo-html-doc-frame octo-diff-frame"
                    onFrameLoad={onFrameLoad('new')}
                  />
                </div>
              )}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
