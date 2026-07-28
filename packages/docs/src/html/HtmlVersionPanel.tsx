// Read-only version list panel for html docs (header ≡ → 历史版本).
//
// Lightweight on purpose: it does NOT reuse the rich-text VersionHistoryPanel (that panel carries
// restore/rename/delete/diff for the Yjs backend). HTML docs are read-only, so this only lists
// version numbers + times; each row exposes 查看 / 与上一版比较 / 与当前版比较. "查看" switches the
// version IN PLACE (the parent re-points HtmlDocView), no longer a new-tab open. Compares open the
// two-version HtmlDiffModal via the parent.

import { formatCommentTime } from './htmlDocComments.ts'
import type { HtmlDocVersion } from './htmlDocVersions.ts'
import { t } from '../octoweb/index.ts'

export function HtmlVersionPanel({
  versions,
  currentVersion,
  loading,
  error,
  onView,
  onCompare,
  onClose,
}: {
  versions: HtmlDocVersion[]
  /** The version currently shown in the view; its row is marked + its "compare to current" is a no-op. */
  currentVersion?: number | null
  loading?: boolean
  error?: string | null
  /** Switch the in-page view to this published version (page/code mode is preserved by the parent). */
  onView: (version: number) => void
  /** Open the diff modal for (from → to). */
  onCompare: (from: number, to: number) => void
  onClose?: () => void
}) {
  // Newest-first per backend contract; the "current version" defaults to the newest published one.
  const latest = versions.length ? versions[0].n : null
  const current = currentVersion ?? latest

  return (
    <section className="octo-html-doc-versions" data-testid="html-doc-version-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.toolbar.history')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.member.close')}
          </button>
        )}
      </div>
      {loading && <p className="octo-loading">{t('docs.version.loadingList')}</p>}
      {error && <p className="octo-member-error">{error}</p>}
      {!loading && !error && versions.length === 0 && (
        <p className="octo-member-empty">{t('docs.version.empty')}</p>
      )}
      <ul className="octo-html-doc-versions-list">
        {versions.map((v, i) => {
          const time = formatCommentTime(v.created_at)
          // "与上一版比较": the numerically-previous published version (the next row down, older).
          const prev = versions[i + 1]?.n
          const isCurrent = current != null && v.n === current
          return (
            <li key={v.n} className="octo-html-doc-version-row" aria-current={isCurrent || undefined}>
              <span className="octo-html-doc-version-label">
                v{v.n}
                {time && <span className="octo-html-doc-version-time"> · {time}</span>}
                {isCurrent && <span className="octo-html-doc-version-badge"> · {t('docs.version.currentBadge')}</span>}
              </span>
              <span className="octo-html-doc-version-actions">
                <button
                  type="button"
                  className="octo-tb-btn"
                  onClick={() => onView(v.n)}
                  disabled={isCurrent}
                >
                  {t('docs.version.view')}
                </button>
                {prev != null && (
                  <button type="button" className="octo-tb-btn" onClick={() => onCompare(prev, v.n)}>
                    {t('docs.version.comparePrev')}
                  </button>
                )}
                {current != null && v.n !== current && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    onClick={() => onCompare(Math.min(v.n, current), Math.max(v.n, current))}
                  >
                    {t('docs.version.compareCurrent')}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
