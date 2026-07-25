// Render a plain-text body that may contain `@[type:id:label]` mention tokens (comment bodies,
// sheet comments) as highlighted inline spans — the read-side counterpart of useTextareaMention.
// User mentions render as inert `@name` chips (label re-resolved from `names` when available so a
// renamed member shows their current name); doc mentions are clickable and deep-link to the doc,
// matching the tiptap editor's `octo-mention` styling and click behaviour.

import { Fragment } from 'react'
import { navigateToDoc, splitMentionText } from './source.ts'

export function MentionText({
  body,
  names,
}: {
  body: string
  /** uid → current display name, to keep user mentions fresh after a rename. */
  names?: Map<string, string>
}) {
  const segments = splitMentionText(body)
  return (
    <>
      {segments.map((seg, i) => {
        if ('text' in seg) return <Fragment key={i}>{seg.text}</Fragment>
        const m = seg.mention
        if (m.type === 'doc') {
          return (
            <span
              key={i}
              className="octo-mention"
              data-mention-type="doc"
              role="link"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => navigateToDoc(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigateToDoc(m.id)
              }}
            >
              @{m.label}
            </span>
          )
        }
        const label = names?.get(m.id) || m.label
        return (
          <span key={i} className="octo-mention" data-mention-type="user">
            @{label}
          </span>
        )
      })}
    </>
  )
}
