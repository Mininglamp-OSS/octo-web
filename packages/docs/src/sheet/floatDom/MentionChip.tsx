// Univer "float DOM" chip for a sheet cell @-mention — the spreadsheet counterpart of the doc
// editor's mention node / the comment MentionText. Because a cell is canvas-rendered, we can't
// style text in it; instead we overlay OUR OWN React component on the cell via float DOM (the same
// mechanism MathFormula uses). Full control means: a blue chip, NO hyperlink URL popup, and click
// behaviour that matches the doc — a @doc chip opens the doc, a @user chip is inert.
//
// The mention identity {id,label,type} lives in the float-DOM drawing `data`, which replicates via
// the drawing Yjs sync (binding.ts) — so the chip appears on every client, and the uid stays
// machine-resolvable for the notify-card binding (#584).

import { navigateToDoc } from '../../mentions/source.ts'

/** Component key registered with Univer's ComponentManager (must match on every collaborating client). */
export const OCTO_MENTION_CHIP_KEY = 'octo-mention-chip'

/** The persisted per-mention payload (Univer drawing `data`). */
export interface MentionChipData {
  id?: string
  label?: string
  type?: 'user' | 'doc'
}

export function MentionChip({ data }: { data?: MentionChipData }): JSX.Element {
  const type = data?.type === 'doc' ? 'doc' : 'user'
  const label = data?.label ?? data?.id ?? ''
  const id = data?.id ?? ''
  const clickable = type === 'doc' && !!id

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        // let clicks through to the grid except on the pill itself
        pointerEvents: 'none',
        // Match the doc editor / comment mention typography (app font, 14px) so the three surfaces
        // read identically — the float-DOM root has no useful inherited font, so set it explicitly.
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 14,
      }}
    >
      {/* Match the doc mention's RESOLVED appearance with explicit values — the .octo-mention class
          reads `var(--octo-active-fg, …)` which is undefined outside the .octo-theme scope (the
          float-DOM renders in Univer's DOM), so relying on it gives a washed-out blue. These are the
          doc mention's actual colors (#1664ff on a faint blue, weight 500). No ellipsis — the chip
          floats over the grid and shows the full label. */}
      <span
        className="octo-mention"
        data-mention-type={type}
        onClick={clickable ? () => navigateToDoc(id) : undefined}
        style={{
          pointerEvents: 'auto',
          color: '#1664ff',
          background: 'rgba(22, 100, 255, 0.08)',
          fontWeight: 500,
          borderRadius: 4,
          padding: '0 3px',
          whiteSpace: 'nowrap',
          cursor: clickable ? 'pointer' : 'default',
        }}
        title={label}
      >
        @{label}
      </span>
    </div>
  )
}
