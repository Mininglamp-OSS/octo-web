// Block-spacing attrs for `paragraph` / `heading` (SCHEMA-SPEC §17, SCHEMA_VERSION 17).
//
// Frontend half of the docs line-height / paragraph-spacing feature (XIN-964),
// byte-aligned to docs-backend PR #67. Three global attrs are added to the
// heading + paragraph nodes, mirroring the existing v5 `textAlign` attr exactly
// (a global attribute on those two types, not a new node/mark — version bump
// only). All three default to null:
//
//   - `lineHeight`  → `line-height:…`  (unitless CSS multiplier, e.g. "1.5")
//   - `spaceBefore` → `margin-top:…`
//   - `spaceAfter`  → `margin-bottom:…`
//
// CANONICAL STYLE SERIALIZATION (MUST byte-align to the backend `setBlockAttrs`,
// or HTML import/export drifts and the Y.Doc round-trip can corrupt): all four
// block attrs ride the SAME inline `style` string. Tiptap merges each rendered
// attribute's `style` fragment with `"; "` (see `mergeAttributes`), and because
// TextAlign is registered before this extension, the declarations come out in
// the FIXED order [text-align, line-height, margin-top, margin-bottom] — each
// written `prop: value` (single space after the colon), joined by `"; "`
// (semicolon + single space), with NO trailing semicolon. Examples:
// `text-align: center`; `line-height: 1.5`;
// `text-align: right; line-height: 2; margin-top: 8px; margin-bottom: 12px`.
//
// Every value is whitelist-sanitized at BOTH parse and render (the same
// both-ends pattern the bookmark URL uses), so a hostile inline style can
// neither enter the Y.Doc nor serialize back out. The attrs survive the Y.Doc
// <-> ProseMirror round-trip as node attrs regardless of DOM serialization; the
// style mapping only governs HTML import/export.

import { Extension } from '@tiptap/core'

/** Node types the block-spacing attrs apply to (matches the v5 textAlign types). */
const BLOCK_SPACING_TYPES = ['heading', 'paragraph'] as const

/**
 * Line-height presets offered by the toolbar dropdown. Unitless CSS multipliers;
 * the free-form "custom" entry lets the user type any value the sanitizer accepts.
 */
export const LINE_HEIGHTS = ['1.0', '1.15', '1.5', '2.0'] as const

/**
 * Unitless CSS line-height multiplier: a bare non-negative number in (0, 10].
 * Byte-aligned to the backend `sanitizeLineHeight` (`^\d+(\.\d+)?$`, 0 < n ≤ 10).
 * Returns the trimmed source string on success, or null so the attr falls back
 * to its default.
 */
export function sanitizeLineHeight(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 && n <= 10 ? s : null
}

/**
 * Block spacing: a non-negative length in px or em, capped at 1000. Byte-aligned
 * to the backend `sanitizeSpacing` (`^\d+(\.\d+)?(px|em)$`, 0 ≤ n ≤ 1000). Used
 * for both spaceBefore (margin-top) and spaceAfter (margin-bottom). Returns the
 * canonicalized `${number}${unit}` string on success, or null otherwise.
 */
export function sanitizeSpacing(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+(?:\.\d+)?)(px|em)$/.exec(v.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? `${m[1]}${m[2]}` : null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    // NOTE: setLineHeight / unsetLineHeight are already declared on the built-in
    // `lineHeight` command namespace by @tiptap/extension-text-style (pulled in via
    // TextStyle/FontSize); this extension supplies the byte-aligned runtime for them,
    // so we must NOT redeclare that namespace. The spacing commands are new.
    blockSpacing: {
      /** Set the margin-top (spaceBefore) length on the current paragraph/heading. */
      setSpaceBefore: (value: string) => ReturnType
      /** Clear the spaceBefore back to the (null) default. */
      unsetSpaceBefore: () => ReturnType
      /** Set the margin-bottom (spaceAfter) length on the current paragraph/heading. */
      setSpaceAfter: (value: string) => ReturnType
      /** Clear the spaceAfter back to the (null) default. */
      unsetSpaceAfter: () => ReturnType
    }
  }
}

/**
 * LineHeight extension — adds the v17 `lineHeight` / `spaceBefore` / `spaceAfter`
 * global attrs to heading + paragraph. MUST be registered AFTER TextAlign so the
 * merged `style` string keeps the canonical [text-align, line-height, margin-top,
 * margin-bottom] order (see file header).
 */
export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_SPACING_TYPES],
        attributes: {
          // Order here is the canonical render order within this extension:
          // line-height → margin-top → margin-bottom (text-align comes from the
          // earlier-registered TextAlign extension).
          lineHeight: {
            default: null,
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
    return {
      setLineHeight:
        (value) =>
        ({ commands }) => {
          const v = sanitizeLineHeight(value)
          if (!v) return false
          return BLOCK_SPACING_TYPES.map((type) =>
            commands.updateAttributes(type, { lineHeight: v }),
          ).some((response) => response)
        },
      unsetLineHeight:
        () =>
        ({ commands }) =>
          BLOCK_SPACING_TYPES.map((type) => commands.resetAttributes(type, 'lineHeight')).some(
            (response) => response,
          ),
      setSpaceBefore:
        (value) =>
        ({ commands }) => {
          const v = sanitizeSpacing(value)
          if (!v) return false
          return BLOCK_SPACING_TYPES.map((type) =>
            commands.updateAttributes(type, { spaceBefore: v }),
          ).some((response) => response)
        },
      unsetSpaceBefore:
        () =>
        ({ commands }) =>
          BLOCK_SPACING_TYPES.map((type) => commands.resetAttributes(type, 'spaceBefore')).some(
            (response) => response,
          ),
      setSpaceAfter:
        (value) =>
        ({ commands }) => {
          const v = sanitizeSpacing(value)
          if (!v) return false
          return BLOCK_SPACING_TYPES.map((type) =>
            commands.updateAttributes(type, { spaceAfter: v }),
          ).some((response) => response)
        },
      unsetSpaceAfter:
        () =>
        ({ commands }) =>
          BLOCK_SPACING_TYPES.map((type) => commands.resetAttributes(type, 'spaceAfter')).some(
            (response) => response,
          ),
    }
  },
})
