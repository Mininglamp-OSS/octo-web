// Line-height + block-spacing global attributes (SCHEMA-SPEC §1, SCHEMA_VERSION 17).
//
// Tiptap ships no official line-height extension (deps only carry
// @tiptap/extension-text-align 3.22.2), so this is a self-built Extension modelled
// byte-for-byte on TextAlign: three GLOBAL ATTRIBUTES (lineHeight, spaceBefore,
// spaceAfter) added to the `heading` + `paragraph` nodes — NOT new nodes/marks, so
// they only bump SCHEMA_VERSION and never enter SCHEMA_NODES/SCHEMA_MARKS (same
// class as the v5 `textAlign` and v7 `fontSize` attrs). Each defaults to `null`,
// so old documents round-trip losslessly (no attr → no style emitted).
//
// Each attribute rides on an inline style declaration, sanitised at BOTH parse and
// render time (the same defence-in-depth as the sanitised Link / bookmark URL): a
// value that fails its whitelist falls back to `null` so nothing arbitrary can be
// injected into the style string.
//   lineHeight  -> style="line-height: <unitless multiplier>"   (e.g. 1.5)
//   spaceBefore -> style="margin-top: <length>"                 (px | em)
//   spaceAfter  -> style="margin-bottom: <length>"              (px | em)
//
// CANONICAL STYLE SERIALIZATION (byte-aligned with the backend toDOM — the one hard
// contract point of this feature). Tiptap's `mergeAttributes` folds every renderHTML
// `style` fragment into a single declaration string as `<prop>: <val>` joined by
// "; " (colon+space, semicolon+space, no trailing ";"), which matches the fragment
// the official TextAlign emits (`text-align: <v>`). Property order follows
// extension-load order (TextAlign is registered before this extension), so a block
// carrying all four attrs serialises to exactly:
//   text-align: <a>; line-height: <lh>; margin-top: <mt>; margin-bottom: <mb>
// The backend `getBlockAttrs`/`setBlockAttrs` toDOM MUST emit byte-identical
// fragments (same order, "; " separator, colon+space, unitless line-height) or HTML
// import/export drifts. Round-trip through the Y.Doc itself is order-independent
// (parseHTML reads each property individually), so only the serialised HTML needs
// the exact ordering above.

import { Extension } from '@tiptap/core'

/** The two block types line spacing applies to (mirrors TextAlign's configured types). */
export const LINE_HEIGHT_TYPES = ['heading', 'paragraph'] as const

/** Unitless line-height multiplier: a bare positive number such as "1", "1.15", "1.5", "2". */
const LINE_HEIGHT_RE = /^\d+(\.\d+)?$/
/** Block spacing length: a non-negative number followed by px or em (no other units). */
const SPACING_RE = /^\d+(\.\d+)?(px|em)$/

/**
 * Sanitise a line-height value to a bare unitless multiplier string, or null.
 * Guards the style string against CSS injection and keeps the multiplier in a sane
 * range (0 < lh <= 10) so a pathological value can't blow out layout.
 */
export function sanitizeLineHeight(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!LINE_HEIGHT_RE.test(v)) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return v
}

/**
 * Sanitise a block-spacing value (spaceBefore/spaceAfter) to a "<number>px|em"
 * string, or null. Same two-sided sanitise pattern as the link/bookmark URLs.
 */
export function sanitizeSpacing(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  return SPACING_RE.test(v) ? v : null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    // Distinct group key: @tiptap/extension-text-style ships a `lineHeight` command group (its
    // LineHeight rides on the textStyle MARK, wrong semantics for block spacing). Grouping our
    // block-level commands under `blockSpacing` avoids merging into that interface; the
    // setLineHeight/unsetLineHeight signatures stay compatible with theirs regardless.
    blockSpacing: {
      /** Set the line-height multiplier on the current heading/paragraph block(s). */
      setLineHeight: (value: string) => ReturnType
      /** Clear the line-height attr (falls back to the CSS default). */
      unsetLineHeight: () => ReturnType
      /** Set the space above the current block(s) (margin-top, px|em). */
      setSpaceBefore: (value: string) => ReturnType
      /** Clear the space-above attr. */
      unsetSpaceBefore: () => ReturnType
      /** Set the space below the current block(s) (margin-bottom, px|em). */
      setSpaceAfter: (value: string) => ReturnType
      /** Clear the space-below attr. */
      unsetSpaceAfter: () => ReturnType
    }
  }
}

/**
 * Self-built global-attribute extension replicating TextAlign's shape. Registered
 * AFTER TextAlign in the extension list so the canonical style ordering above holds.
 */
export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [
      {
        types: [...LINE_HEIGHT_TYPES],
        attributes: {
          lineHeight: {
            default: null,
            // Parse + sanitise: an invalid/absent value degrades to null (no style).
            parseHTML: (element) => sanitizeLineHeight(element.style.lineHeight),
            renderHTML: (attributes) => {
              const v = sanitizeLineHeight(attributes.lineHeight)
              return v ? { style: `line-height: ${v}` } : {}
            },
          },
          spaceBefore: {
            default: null,
            parseHTML: (element) => sanitizeSpacing(element.style.marginTop),
            renderHTML: (attributes) => {
              const v = sanitizeSpacing(attributes.spaceBefore)
              return v ? { style: `margin-top: ${v}` } : {}
            },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element) => sanitizeSpacing(element.style.marginBottom),
            renderHTML: (attributes) => {
              const v = sanitizeSpacing(attributes.spaceAfter)
              return v ? { style: `margin-bottom: ${v}` } : {}
            },
          },
        },
      },
    ]
  },

  addCommands() {
    const types = [...LINE_HEIGHT_TYPES]
    return {
      setLineHeight:
        (value) =>
        ({ commands }) => {
          const v = sanitizeLineHeight(value)
          if (!v) return false
          return types.map((type) => commands.updateAttributes(type, { lineHeight: v })).some(Boolean)
        },
      unsetLineHeight:
        () =>
        ({ commands }) =>
          types.map((type) => commands.resetAttributes(type, 'lineHeight')).some(Boolean),
      setSpaceBefore:
        (value) =>
        ({ commands }) => {
          const v = sanitizeSpacing(value)
          if (!v) return false
          return types.map((type) => commands.updateAttributes(type, { spaceBefore: v })).some(Boolean)
        },
      unsetSpaceBefore:
        () =>
        ({ commands }) =>
          types.map((type) => commands.resetAttributes(type, 'spaceBefore')).some(Boolean),
      setSpaceAfter:
        (value) =>
        ({ commands }) => {
          const v = sanitizeSpacing(value)
          if (!v) return false
          return types.map((type) => commands.updateAttributes(type, { spaceAfter: v })).some(Boolean)
        },
      unsetSpaceAfter:
        () =>
        ({ commands }) =>
          types.map((type) => commands.resetAttributes(type, 'spaceAfter')).some(Boolean),
    }
  },
})
