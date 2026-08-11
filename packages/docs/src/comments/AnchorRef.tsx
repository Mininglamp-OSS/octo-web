// The quoted-anchor line at the top of a thread card, plus its status pills (spec 视觉目标 §4/§7).
//
// Visual contract (all values come from the repo's `--wk-*` semantic tokens in styles.css):
//   • quote  — italic, 12px, tertiary grey, single line with ellipsis, 32px of right padding kept
//              clear so the thread's ⋯ affordance never collides with the text.
//   • pills  — 10px, `padding: 1px 6px`, full radius. 已解决 = GREEN OUTLINE; 引用已更新 = GREEN
//              FILL; 引用已变化/失效 = ORANGE FILL. The tone split is what lets a user tell "this is
//              finished" from "this needs your attention" at a glance.
//   • Bot    — a purple micro-pill, the only place besides the card border where purple appears.

import { t } from '../octoweb/index.ts'
import { anchorStateLabelKey, anchorStateTone, type AnchorState } from './threadMeta.ts'

export function AnchorRef({
  anchorText,
  anchorState,
  resolved,
  isBot,
  onActivate,
}: {
  anchorText: string
  anchorState: AnchorState
  resolved: boolean
  isBot: boolean
  /** Scroll to + select the highlight in the live document. */
  onActivate: () => void
}) {
  const labelKey = anchorStateLabelKey(anchorState)
  const tone = anchorStateTone(anchorState)
  return (
    <button
      type="button"
      className={`octo-comment-anchor is-anchor-${anchorState}`}
      onClick={onActivate}
    >
      {/* The quote is kept even when the anchor died: it is the ONLY surviving record of what was
          commented on, and the orange 「原引用已失效」pill already says it no longer resolves. The
          old behaviour (replace the text with "（已失效）") threw that context away. */}
      <span className="octo-comment-quote">“{anchorText || '…'}”</span>
      {isBot && <em className="octo-comment-badge is-bot">{t('docs.comment.botBadge')}</em>}
      {labelKey && tone && (
        <em className={`octo-comment-badge is-${tone}`}>{t(labelKey)}</em>
      )}
      {resolved && (
        <em className="octo-comment-badge is-resolved">{t('docs.comment.resolvedBadge')}</em>
      )}
    </button>
  )
}
