// Read-only version list panel for html docs (header ≡ → 历史版本).
//
// Lightweight on purpose: it does NOT reuse the rich-text VersionHistoryPanel (that panel
// carries restore/rename/delete/diff for the Yjs backend). HTML docs are read-only, so this
// only lists version numbers + times; each row opens that published version in a new tab.

import { formatCommentTime } from './htmlDocComments.ts'
import { buildOctoDocUrl } from './HtmlDocView.tsx'
import type { HtmlDocVersion } from './htmlDocVersions.ts'
import { t } from '../octoweb/index.ts'

export function HtmlVersionPanel({
  slug,
  versions,
  loading,
  error,
  onClose,
}: {
  slug: string
  versions: HtmlDocVersion[]
  loading?: boolean
  error?: string | null
  onClose?: () => void
}) {
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
        {versions.map((v) => {
          const time = formatCommentTime(v.created_at)
          return (
            <li key={v.n} className="octo-html-doc-version-row">
              <button
                type="button"
                className="octo-tb-btn octo-html-doc-version-open"
                onClick={() => window.open(buildOctoDocUrl(slug, String(v.n)), '_blank')}
              >
                v{v.n}
                {time && <span className="octo-html-doc-version-time"> · {time}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
