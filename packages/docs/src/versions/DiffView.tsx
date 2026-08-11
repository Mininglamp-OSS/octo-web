// Block-level diff renderer — laid out as a UNIFIED CODE DIFF, following the executable-comment
// prototype's `.unified-diff-module` / `.change-hunk` / `.unified-diff` design.
//
// WHAT CHANGED AND WHY: this used to render one flat `- text` / `+ text` line per entry, with no line
// numbers, no grouping and no card, and every unchanged block of the document painted as another grey
// row. The product owner's complaint was that it is unreadable. The prototype answers that with the
// shape everybody already knows from code review:
//
//   ┌ unified-diff module (one bordered card) ────────────────────────────┐
//   │ @@ 第 1 处 @@                                    [已修改]          │  ← hunk header + status
//   │  5   5      context text                                           │  ← old№ new№ marker text
//   │  6         −  the text before                                      │
//   │      6     +  the text after                                       │
//   ├─────────────────────────────────────────────────────────────────────┤
//   │ @@ 第 2 处 @@                                          …           │
//   └─────────────────────────────────────────────────────────────────────┘
//
// The grouping + line numbering is a pure transform (versions/diffHunks.ts toHunks); this file is only
// the markup. The numbers here are REAL — the two sides advance independently — unlike the prototype,
// whose `newStart` is hard-coded to `oldStart` (see diffHunks.ts for the full note).
//
// CLASS-NAME COMPATIBILITY: `.octo-version-diff`, `.octo-diff-line`, `.octo-diff-added`,
// `.octo-diff-removed` and `.octo-diff-unchanged` are PRESERVED on the same elements as before —
// the version panel's tests and the Playwright driver select on them, and the "+ / - row" is still
// the thing they name. Only structure was added around them. The prototype's own class names are NOT
// copied, and neither are its colour literals: every colour resolves through this repo's `--wk-*`
// tokens in styles.css (see the DESIGN-TOKEN note there).
//
// `renderEntryAction` keeps its exact contract: called ONLY for real changes, never for context rows
// and never for the `too-large` sentinel; omitted ⇒ zero extra DOM.

import type { ReactNode } from 'react'
import { t } from '../octoweb/index.ts'
import type { BlockLocation, DiffEntry } from './diff.ts'
import { toHunks, type DiffHunk, type HunkLine } from './diffHunks.ts'

/** True for entries that represent a REAL change (the only ones an action may attach to). */
export function isChangedEntry(d: DiffEntry): boolean {
  return d.type === 'added' || d.type === 'removed' || d.type === 'changed'
}

/** Marker glyph in the gutter. U+2212 MINUS SIGN (not a hyphen) so it optically matches `+`. */
function marker(type: HunkLine['type']): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '−'
  return ' '
}

/** +/− 那一列的悬停说明。上下文行不给 title —— 空单元格挂个提示只会碍事。 */
function markerTitle(type: HunkLine['type']): string | undefined {
  if (type === 'added') return t('docs.botDiff.statusAdded')
  if (type === 'removed') return t('docs.botDiff.statusRemoved')
  return undefined
}

/** Row modifier class. Context rows keep `octo-diff-unchanged` so existing selectors still match. */
function lineClass(type: HunkLine['type']): string {
  const kind = type === 'context' ? 'unchanged' : type
  return `octo-diff-line octo-diff-${kind}${type === 'context' ? ' is-context' : ''}`
}

/**
 * Short "what happened here" badge for a hunk header. Pure insertions and pure deletions are worth
 * naming explicitly; a mixed hunk is simply "changed".
 */
function hunkStatus(added: number, removed: number): string {
  if (added > 0 && removed === 0) return t('docs.botDiff.statusAdded')
  if (removed > 0 && added === 0) return t('docs.botDiff.statusRemoved')
  return t('docs.botDiff.statusChanged')
}

export interface DiffViewProps {
  diff: DiffEntry[]
  /**
   * Optional per-entry trailing affordance. Called ONLY for entries with a real change
   * (`added` / `removed` / `changed`) — never for a context row, and never for the `too-large`
   * sentinel (which short-circuits before the hunk loop). Omit → zero extra DOM.
   */
  renderEntryAction?: (entry: DiffEntry, index: number) => ReactNode
  /**
   * 与 diff 行一一对应的块定位(docToBlockLocations)。给了就把 hunk 头写成
   * 「一、当前问题 · 第 3 段」;不给则退回「第 n 处」—— 表格那侧没有章节概念,不该硬套。
   */
  locations?: readonly BlockLocation[]
}

/** Unified block-level diff: hunk cards, line numbers, `-`/`+` gutters (feature #4 §1.4). */
export function DiffView({ diff, renderEntryAction, locations }: DiffViewProps) {
  // Both short-circuits precede any hunk work, so `renderEntryAction` is never consulted for them.
  if (diff.length === 1 && diff[0].type === 'too-large') {
    return <p className="octo-version-empty">{t('docs.version.tooLarge')}</p>
  }
  if (diff.every((d) => d.type === 'unchanged')) {
    return <p className="octo-version-empty">{t('docs.version.noChanges')}</p>
  }

  const hunks = toHunks(diff)
  // Defensive: a diff that reaches here has at least one change, so toHunks cannot be empty. If it
  // somehow is, say so rather than render an empty bordered box.
  if (hunks.length === 0) {
    return <p className="octo-version-empty">{t('docs.version.noChanges')}</p>
  }

  // The action hook is indexed by position in the ORIGINAL `diff` array (its documented contract), so
  // walk a cursor over the changed entries in the same order the hunks present them.
  const changedIndexes = diff.map((d, i) => (isChangedEntry(d) ? i : -1)).filter((i) => i >= 0)
  let changedCursor = 0

  const totalChanges = changedIndexes.length

  return (
    <div className="octo-version-diff octo-diff-module">
      <div className="octo-diff-module-head">
        <span className="octo-diff-count">
          {t('docs.botDiff.changeCount', { values: { count: totalChanges } })}
        </span>
        <span className="octo-diff-legend">
          <span className="octo-diff-legend-before">
            {'−'} {t('docs.botDiff.legendBefore')}
          </span>
          <span className="octo-diff-legend-after">+ {t('docs.botDiff.legendAfter')}</span>
        </span>
      </div>

      <div className="octo-diff-module-body">
        {hunks.map((hunk) => {
          // One action per CHANGED ENTRY in this hunk; a `changed` entry contributes two rows but only
          // one action, so actions are attached from the entry list, not the row list.
          const actions: ReactNode[] = []
          if (renderEntryAction) {
            const changesHere = hunk.lines.filter((l) => l.type !== 'context')
            // A `changed` entry emitted a -/+ pair; count entries, not rows.
            let rowsSeen = 0
            while (rowsSeen < changesHere.length && changedCursor < changedIndexes.length) {
              const originalIndex = changedIndexes[changedCursor]
              const entry = diff[originalIndex]
              actions.push(renderEntryAction(entry, originalIndex))
              rowsSeen += entry.type === 'changed' ? 2 : 1
              changedCursor += 1
            }
          }
          return (
            <section className="octo-diff-hunk" key={hunk.index}>
              <header className="octo-diff-hunk-head">
                <span className="octo-diff-hunk-loc">
                  @@ {t('docs.botDiff.hunkLabel', { values: { n: hunk.index } })} @@
                </span>
                <span className="octo-diff-hunk-status">
                  {hunkStatus(hunk.addedCount, hunk.removedCount)}
                </span>
              </header>
              <div className="octo-unified-diff">
                {/* 列标题。原型没有这一行,是我们比原型多出来的 —— 加它是因为「改前行号 /
                    改后行号」这两列被连问了三次:删除行的改后号是空的(这行改完就不存在了),
                    新增行的改前号是空的(改前还没这行),空格子上带底色看着像没渲染完。光靠
                    悬停提示不够,得让它在页面上直接写着。 */}
                <div className="octo-diff-line octo-diff-colhead" aria-hidden="true">
                  <span className="octo-diff-num">{t('docs.botDiff.colBefore')}</span>
                  <span className="octo-diff-num">{t('docs.botDiff.colAfter')}</span>
                  <span className="octo-diff-marker" />
                  <span className="octo-diff-text">{t('docs.botDiff.colContent')}</span>
                </div>
                {hunk.lines.map((line, li) => (
                  <div className={lineClass(line.type)} key={li}>
                    {/* 两列行号:改前 / 改后。上下文行两边都有(而且常常相同),用户会问「第一个
                        数字是干什么的」—— 光看数字分不出哪列是哪列,所以带上 title + aria-label。
                        屏幕阅读器否则只会念出两个孤零零的数字。 */}
                    <span
                      className="octo-diff-num"
                      title={t('docs.botDiff.oldLineNumber')}
                      aria-label={
                        line.oldNumber == null
                          ? undefined
                          : `${t('docs.botDiff.oldLineNumber')} ${line.oldNumber}`
                      }
                    >
                      {line.oldNumber ?? ''}
                    </span>
                    <span
                      className="octo-diff-num"
                      title={t('docs.botDiff.newLineNumber')}
                      aria-label={
                        line.newNumber == null
                          ? undefined
                          : `${t('docs.botDiff.newLineNumber')} ${line.newNumber}`
                      }
                    >
                      {line.newNumber ?? ''}
                    </span>
                    <span className="octo-diff-marker" title={markerTitle(line.type)}>
                      {marker(line.type)}
                    </span>
                    <code className="octo-diff-text">{line.text || ' '}</code>
                  </div>
                ))}
              </div>
              {actions.length > 0 && <div className="octo-diff-hunk-actions">{actions}</div>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
