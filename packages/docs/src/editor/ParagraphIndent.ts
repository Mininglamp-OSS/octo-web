// Paragraph / heading indent (SCHEMA-SPEC §16, SCHEMA_VERSION 18).
//
// No official Tiptap extension covers plain-paragraph indentation (the built-in list
// sink/lift only nests listItem nodes), so this is a self-built Extension modelled on
// @tiptap/extension-text-align (SCHEMA_VERSION 5): it adds a global `indent` ATTRIBUTE to
// the `paragraph` + `heading` nodes — not a new node/mark — that rides in the Y.Doc node
// attrs and re-parses faithfully in the read-only preview.
//
// The value is an integer indent LEVEL (0 = no indent). It round-trips via a `data-indent`
// attribute (like Callout's `data-variant`); the visual step is rendered as an inline
// `margin-left` so the live editor and the static preview render identically without a
// dedicated stylesheet rule. A missing/0 attr renders no style at all, so old documents
// (no `indent` attr) are unchanged — backward-compatible by construction, no migration.
//
// LOCKSTEP: the attr name (`indent`), the `data-indent` round-trip, the null default and the
// clamp bounds MUST stay byte-aligned with the backend stub + SCHEMA-SPEC.md at v18, or the
// collab boundary can strip the unknown attr.

import { Extension } from '@tiptap/core'

/** Em per indent level applied as margin-left (presentational only; not persisted). */
export const INDENT_STEP_EM = 2
/** Maximum indent level; increaseIndent clamps here, decreaseIndent clamps at 0. */
export const INDENT_MAX_LEVEL = 8

/** Coerce any stored value to a valid integer indent level in [0, INDENT_MAX_LEVEL] (0 = none). */
export function clampIndent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(INDENT_MAX_LEVEL, Math.max(0, Math.round(n)))
}

/** Storage form of a level: a positive level 1..MAX, or `null` for "no indent" (the default).
 * Using `null` (not 0) as the empty sentinel keeps a plain paragraph attr-free through the Y.Doc
 * (y-prosemirror stores every non-null attr), so old docs stay byte-identical and no migration is
 * needed — exactly how textAlign / lineHeight default to null. */
export function normalizeIndent(value: unknown): number | null {
  const level = clampIndent(value)
  return level > 0 ? level : null
}

export interface ParagraphIndentOptions {
  /** Node types the `indent` attr is added to (paragraph + heading). */
  types: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphIndent: {
      /** Set the indent level of the selected block(s) to an explicit clamped level. */
      setIndent: (level: number) => ReturnType
      /** Increase the indent level of the selected block(s) by one (clamped at max). */
      increaseIndent: () => ReturnType
      /** Decrease the indent level of the selected block(s) by one (no-op at 0). */
      decreaseIndent: () => ReturnType
      /** Reset the indent level of the selected block(s) to 0. */
      unsetIndent: () => ReturnType
    }
  }
}

export const ParagraphIndent = Extension.create<ParagraphIndentOptions>({
  name: 'paragraphIndent',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            // null = no indent (default). y-prosemirror stores every non-null attr, so the null
            // default keeps plain paragraphs attr-free through the Y.Doc (backward-compatible).
            default: null,
            // data-indent <-> indent round-trip (byte-aligned with the backend stub).
            parseHTML: (element) => normalizeIndent(element.getAttribute('data-indent')),
            renderHTML: (attributes) => {
              const level = clampIndent(attributes.indent)
              if (level <= 0) return {}
              return {
                'data-indent': String(level),
                style: `margin-left: ${level * INDENT_STEP_EM}em`,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    // Walk every block of a configured type in the selection and rewrite its indent level.
    // Returns false when nothing changed (e.g. decreaseIndent at 0), so the boundary is a
    // clean no-op and the toolbar button reflects it.
    const applyIndent =
      (compute: (current: number) => number) =>
      ({ state, dispatch }: { state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
        const { from, to } = state.selection
        const tr = state.tr
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return
          const current = clampIndent(node.attrs.indent)
          const next = clampIndent(compute(current))
          if (next !== current) {
            // Store null (not 0) for "no indent" so the attr is stripped from the Y.Doc.
            tr.setNodeAttribute(pos, 'indent', next > 0 ? next : null)
            changed = true
          }
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }

    return {
      setIndent: (level) => applyIndent(() => level),
      increaseIndent: () => applyIndent((c) => c + 1),
      decreaseIndent: () => applyIndent((c) => c - 1),
      unsetIndent: () => applyIndent(() => 0),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Tab/Shift-Tab keep their list sink/lift behavior — those keys are owned by the list
      // extensions and only fire inside a listItem. We bind Mod-] / Mod-[ for paragraph indent
      // so we never shadow the list keymap.
      'Mod-]': () => this.editor.commands.increaseIndent(),
      'Mod-[': () => this.editor.commands.decreaseIndent(),
    }
  },
})
