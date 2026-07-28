// Two-version diff modal for HTML docs. Tabs: [代码 Diff][页面 Diff], both backed by ONE shared
// DiffResult (getDiff). Semantic dialog (role="dialog" aria-modal), focus/Esc/backdrop close.
//
// Code Diff: dual line numbers, red删/绿增, char-level emphasis on replaced lines, 仅看变更/上下文.
// Page Diff: two HtmlPreviewFrame side-by-side; changes highlighted by AID (preferred) or DOM path
// (fallback); 上一/下一 change navigation; 双栏/旧版/新版 layout; closeable proportional sync scroll.
//
// Adapter, NOT the Yjs VersionHistoryPanel: this shell is HTML-specific; it only reuses the shared
// modal chrome (.octo-modal-overlay / .octo-modal) and preview frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDiff, getVersionSource, type DiffChange, type DiffResult } from './htmlDocSourceApi.ts'
import { diffChars, diffLines, type DiffRow } from './htmlSourceDiff.ts'
import { HtmlPreviewFrame } from './HtmlPreviewFrame.tsx'
import { t } from '../octoweb/index.ts'

type DiffTab = 'code' | 'page'
type PageLayout = 'both' | 'old' | 'new'

export interface HtmlDiffModalProps {
  slug: string
  /** Older version (left / 旧版). */
  from: string
  /** Newer version (right / 新版). */
  to: string
  title: string
  onClose: () => void
}

// ---- code-diff helpers -----------------------------------------------------------------------

/** One code-diff row: aligned old|new gutters + content, char-emphasis on replace rows. */
function CodeRow({ row }: { row: DiffRow }) {
  const cls =
    row.op === 'add'
      ? 'octo-diff-row is-add'
      : row.op === 'remove'
        ? 'octo-diff-row is-remove'
        : row.op === 'replace'
          ? 'octo-diff-row is-replace'
          : 'octo-diff-row'
  if (row.op === 'replace') {
    const chars = diffChars(row.oldText ?? '', row.newText ?? '')
    return (
      <div className={cls} data-testid="diff-row">
        <span className="octo-diff-ln octo-diff-ln-old" aria-hidden="true">
          {row.oldLine ?? ''}
        </span>
        <span className="octo-diff-mark" aria-hidden="true">
          -
        </span>
        <span className="octo-diff-text octo-diff-text-old">
          {chars.old.map((s, i) => (
            <span key={i} className={s.same ? undefined : 'octo-diff-char'}>
              {s.text}
            </span>
          ))}
        </span>
        <span className="octo-diff-ln octo-diff-ln-new" aria-hidden="true">
          {row.newLine ?? ''}
        </span>
        <span className="octo-diff-mark" aria-hidden="true">
          +
        </span>
        <span className="octo-diff-text octo-diff-text-new">
          {chars.new.map((s, i) => (
            <span key={i} className={s.same ? undefined : 'octo-diff-char'}>
              {s.text}
            </span>
          ))}
        </span>
      </div>
    )
  }
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

/** Collapse long runs of equal rows to ±context lines when "仅看变更" is on. */
function withContext(rows: DiffRow[], changesOnly: boolean, context = 3): DiffRow[] {
  if (!changesOnly) return rows
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, i) => {
    if (r.op !== 'equal') {
      for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true
    }
  })
  return rows.filter((_, i) => keep[i])
}

// ---- page-diff highlighting ------------------------------------------------------------------

const HIGHLIGHT_STYLE = 'outline:2px solid #FC8800;outline-offset:2px;'

/** Highlight changed elements in one loaded iframe document, preferring AID then DOM path. */
function highlightChanges(doc: Document | null, changes: DiffChange[], side: 'old' | 'new'): Element[] {
  if (!doc) return []
  const hits: Element[] = []
  for (const c of changes) {
    // A remove only exists in the old doc, an add only in the new; replace in both.
    if (side === 'old' && c.op === 'add') continue
    if (side === 'new' && c.op === 'remove') continue
    let el: Element | null = null
    if (c.aid) {
      try {
        el = doc.querySelector(`[data-odoc-aid="${CSS?.escape ? CSS.escape(c.aid) : c.aid}"]`)
      } catch {
        el = null
      }
    }
    if (!el && c.path) {
      try {
        el = doc.querySelector(c.path)
      } catch {
        el = null
      }
    }
    if (el) {
      el.setAttribute('style', `${el.getAttribute('style') ?? ''};${HIGHLIGHT_STYLE}`)
      el.setAttribute('data-odoc-changed', c.op)
      hits.push(el)
    }
  }
  return hits
}

export function HtmlDiffModal({ slug, from, to, title, onClose }: HtmlDiffModalProps) {
  const [tab, setTab] = useState<DiffTab>('code')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [sources, setSources] = useState<{ from: string; to: string } | null>(null)
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [changesOnly, setChangesOnly] = useState(true)
  const [layout, setLayout] = useState<PageLayout>('both')
  const [syncScroll, setSyncScroll] = useState(true)
  const [changeIdx, setChangeIdx] = useState(0)

  const dialogRef = useRef<HTMLDivElement>(null)
  const oldDocRef = useRef<Document | null>(null)
  const newDocRef = useRef<Document | null>(null)
  const oldHits = useRef<Element[]>([])
  const newHits = useRef<Element[]>([])

  // Load the shared DiffResult + both raw sources (for the local code diff) with abort/race guard.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setStatus('loading')
    setDiff(null)
    setSources(null)
    Promise.all([
      getDiff(slug, from, to, controller.signal),
      getVersionSource(slug, from, controller.signal),
      getVersionSource(slug, to, controller.signal),
    ])
      .then(([d, fromSrc, toSrc]) => {
        if (cancelled) return
        setDiff(d)
        setSources({ from: fromSrc, to: toSrc })
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

  // Esc closes; focus the dialog on open (focus trap-lite parity with the member modal).
  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prefer the backend hunks; otherwise diff the two raw sources locally.
  const rows = useMemo<DiffRow[]>(() => {
    if (!sources) return []
    if (diff?.html_diff && diff.html_diff.length) {
      // Map backend hunks straight into rows (equal/add/remove); replace-pairing is a client nicety
      // only applied to the local diff.
      return diff.html_diff.map((h) => ({
        op: h.op,
        oldLine: h.old_ln,
        newLine: h.new_ln,
        oldText: h.op !== 'add' ? h.text : undefined,
        newText: h.op !== 'remove' ? h.text : undefined,
      }))
    }
    return diffLines(sources.from, sources.to)
  }, [diff, sources])

  const visibleRows = useMemo(() => withContext(rows, changesOnly), [rows, changesOnly])
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
      // Re-highlight this side.
      if (side === 'old') oldHits.current = highlightChanges(doc, changes, 'old')
      else newHits.current = highlightChanges(doc, changes, 'new')
      // (Re)wire sync scroll once both frames are present.
      cleanupSync.current?.()
      cleanupSync.current = wireSyncScroll()
    },
    [changes, wireSyncScroll],
  )

  useEffect(() => () => cleanupSync.current?.(), [])

  const gotoChange = useCallback(
    (delta: number) => {
      const total = changes.length
      if (!total) return
      const next = (changeIdx + delta + total) % total
      setChangeIdx(next)
      const c = changes[next]
      const scrollTo = (el: Element | undefined) => el?.scrollIntoView({ block: 'center' })
      // Prefer the side that hosts this change.
      const newEl = newHits.current.find((e) => e.getAttribute('data-odoc-aid') === c.aid) ?? newHits.current[next]
      const oldEl = oldHits.current.find((e) => e.getAttribute('data-odoc-aid') === c.aid) ?? oldHits.current[next]
      scrollTo(c.op === 'remove' ? oldEl : newEl)
    },
    [changeIdx, changes],
  )

  const tabButton = (id: DiffTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`html-diff-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`html-diff-panel-${id}`}
      className={tab === id ? 'octo-diff-tab is-active' : 'octo-diff-tab'}
      onClick={() => setTab(id)}
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

        {status === 'ready' && tab === 'code' && (
          <div
            id="html-diff-panel-code"
            role="tabpanel"
            aria-labelledby="html-diff-tab-code"
            className="octo-diff-code-panel"
            data-testid="html-diff-code"
          >
            <div className="octo-diff-toolbar">
              <button
                type="button"
                className={changesOnly ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
                aria-pressed={changesOnly}
                onClick={() => setChangesOnly((v) => !v)}
              >
                {changesOnly ? t('docs.diff.showContext') : t('docs.diff.changesOnly')}
              </button>
            </div>
            {rows.every((r) => r.op === 'equal') ? (
              <p className="octo-member-empty">{t('docs.diff.noChanges')}</p>
            ) : (
              <pre className="octo-diff-code" data-testid="html-diff-code-pre">
                <code>
                  {visibleRows.map((row, i) => (
                    <CodeRow key={i} row={row} />
                  ))}
                </code>
              </pre>
            )}
          </div>
        )}

        {status === 'ready' && tab === 'page' && (
          <div
            id="html-diff-panel-page"
            role="tabpanel"
            aria-labelledby="html-diff-tab-page"
            className="octo-diff-page-panel"
            data-testid="html-diff-page"
          >
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
          </div>
        )}
      </div>
    </div>
  )
}
