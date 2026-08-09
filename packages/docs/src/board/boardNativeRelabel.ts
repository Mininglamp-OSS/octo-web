/**
 * Locale relabel for the Excalidraw 0.18.1 UI strings whose bundled `zh-CN` locale is incomplete, so
 * they render in English under a Chinese app locale (XIN board i18n regression):
 *
 *   - the right-side properties panel "Arrow type" heading (`labels.arrowtypes`), and
 *   - the three arrow-type options — "Sharp arrow" / "Curved arrow" / "Elbow arrow"
 *     (`labels.arrowtype_sharp` / `_round` / `_elbowed`), and
 *   - the three crow's-foot arrowheads — "Crow's foot (one)" / "(many)" / "(one or many)"
 *     (`labels.arrowhead_crowfoot_one` / `_many` / `_one_or_many`), and
 *   - the "More options" control (`labels.more_options`).
 *
 * All eight keys are missing from Excalidraw's shipped `zh-CN` pack (verified against
 * dist/dev/locales/zh-CN-*.js), so they fall back to English in the arrow-tool submenu.
 *
 * Why a DOM pass and not an i18n override: 0.18.1 exposes no per-string translation seam — `t()`
 * reads a module-private `currentLangData`, and there is no `langData` prop or setter on the public
 * API (the same constraint documented at length in excalidrawDebrand.ts). Excalidraw is already told
 * `langCode="zh-CN"`; it simply lacks these keys and falls back to English for them. So we relabel
 * the rendered DOM in place, sourcing the replacement from the product's OWN i18n via `t()`.
 *
 * The pass is locale-safe by construction: it swaps the English source text ONLY for `t(key)`, and
 * under an English locale `t(key)` returns the identical English string, so nothing changes there
 * (`relabelValue` early-returns when translation === source). The match is exact and idempotent —
 * once a node reads the Chinese string it no longer equals the English source, so re-processing it,
 * or observing the mutation this makes, never compounds.
 *
 * Both label sites render the string as element text AND as `title` / `aria-label` attributes across
 * Excalidraw versions, so every occurrence of the exact English string is covered in both places. The
 * crow's-foot arrowheads render inside an IconPicker whose `title` carries a keyboard-shortcut suffix
 * (`"Crow's foot (many) — X"`, from ``${text} — ${key}``); relabelNode handles that ` — <key>` form
 * so the tooltip is localized too, not just the exact-match `aria-label`.
 */
import { t } from '../octoweb/index.ts'

/** A native Excalidraw label: the English source Excalidraw renders (its `en` fallback) and the
 *  product i18n key whose value replaces it. */
interface NativeLabel {
  /** The exact English string Excalidraw renders when its zh-CN locale lacks the key. */
  source: string
  /** Product i18n key; `t(key)` supplies the replacement (and equals `source` under en-US). */
  key: string
}

const NATIVE_LABELS: readonly NativeLabel[] = [
  { source: 'Arrow type', key: 'docs.board.nativeExcalidraw.arrowType' },
  { source: 'More options', key: 'docs.board.nativeExcalidraw.moreOptions' },
  { source: 'Frame', key: 'docs.board.nativeExcalidraw.frameTool' },
  { source: 'Find on canvas', key: 'docs.board.nativeExcalidraw.find' },
  { source: 'Find text on canvas...', key: 'docs.board.nativeExcalidraw.findPlaceholder' },
  { source: 'Generate', key: 'docs.board.nativeExcalidraw.generate' },
  { source: 'Sharp arrow', key: 'docs.board.nativeExcalidraw.sharpArrow' },
  { source: 'Curved arrow', key: 'docs.board.nativeExcalidraw.curvedArrow' },
  { source: 'Elbow arrow', key: 'docs.board.nativeExcalidraw.elbowArrow' },
  { source: "Crow's foot (one)", key: 'docs.board.nativeExcalidraw.crowfootOne' },
  { source: "Crow's foot (many)", key: 'docs.board.nativeExcalidraw.crowfootMany' },
  { source: "Crow's foot (one or many)", key: 'docs.board.nativeExcalidraw.crowfootOneOrMany' },
]

/** Attributes that can carry a user-visible label; relabelled alongside text content. */
const LABEL_ATTRS = ['title', 'aria-label', 'placeholder'] as const

/** Excalidraw's IconPicker builds an option `title` as ``${label} — ${shortcutKey}`` (e.g.
 *  "Crow's foot (many) — X"). This is the exact separator it uses. */
const SHORTCUT_SEPARATOR = ' — '

/** Relabel one attribute value: exact match → translation; the IconPicker's ``label — key`` tooltip
 *  form → swap only the label prefix, keeping the shortcut suffix. Returns the new value, or null
 *  when nothing matched (so the caller can skip the write and stay idempotent). */
function relabelAttrValue(value: string, source: string, translation: string): string | null {
  if (value === source) return translation
  const prefix = source + SHORTCUT_SEPARATOR
  if (value.startsWith(prefix)) return translation + SHORTCUT_SEPARATOR + value.slice(prefix.length)
  return null
}

/** Replace exact-match direct text nodes of `el` (leaving child elements untouched) and the
 *  label-bearing attributes of `el`. Idempotent: a node already showing the translation no longer
 *  equals `source`, so it is skipped. */
function relabelNode(el: Element, source: string, translation: string): void {
  for (const attr of LABEL_ATTRS) {
    const current = el.getAttribute(attr)
    if (current === null) continue
    const next = relabelAttrValue(current, source, translation)
    if (next !== null && next !== current) el.setAttribute(attr, next)
  }
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim() === source) {
      node.nodeValue = node.nodeValue.replace(source, translation)
    }
  })
}

/** Apply every locale relabel to `el` and its descendants. A no-op under en-US (translation === source). */
function relabelWithin(el: Element): void {
  for (const { source, key } of NATIVE_LABELS) {
    const translation = t(key)
    if (!translation || translation === source) continue
    relabelNode(el, source, translation)
    el.querySelectorAll('*').forEach((node) => relabelNode(node, source, translation))
  }
}

/**
 * Start relabelling the Excalidraw native labels under `root` and return a disposer. Excalidraw
 * renders the properties panel inside the canvas and re-renders it on every selection change, so a
 * subtree observer is the seam that survives re-mounts (the same rationale as nativePanelInject).
 * Runs once immediately for anything already mounted, then on every subtree insertion.
 */
export function installBoardNativeRelabel(host: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}

  relabelWithin(host)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) relabelWithin(node as Element)
      })
    }
  })
  observer.observe(host, { childList: true, subtree: true })

  return () => observer.disconnect()
}
