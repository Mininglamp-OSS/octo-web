import { t } from '../octoweb/index.ts'
import type { DocsViewKind } from './useDocsView.ts'

/**
 * Two-tab switcher for the docs list: 最近查看 (recent, default) / 我的文档 (mine). Purely
 * presentational — the active view and its per-tab state live in the container's `useDocsView`
 * instances (frontend-design §2.1). Reuses the hand-written `octo-docs-*` visual language; no
 * control library.
 */
export function DocsTabs({
  active,
  onChange,
}: {
  active: DocsViewKind
  onChange: (view: DocsViewKind) => void
}): React.ReactElement {
  return (
    <div className="octo-docs-tabs" role="tablist" aria-label={t('docs.menu.title')}>
      {(['recent', 'mine'] as const).map((view) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={active === view}
          className={
            active === view ? 'octo-docs-tab octo-docs-tab-active' : 'octo-docs-tab'
          }
          onClick={() => onChange(view)}
        >
          {view === 'recent' ? t('docs.tab.recent') : t('docs.tab.mine')}
        </button>
      ))}
    </div>
  )
}
