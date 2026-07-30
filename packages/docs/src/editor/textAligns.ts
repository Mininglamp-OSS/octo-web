/**
 * Text-alignment presets shared by the docs toolbar and the whiteboard text toolbar
 * so both surfaces expose the same alignment options.
 *
 * All four values are exposed to the UI; the whiteboard side is responsible for the
 * Excalidraw storage detail — its 0.18 native `textAlign` type is `'left'|'center'|'right'`
 * only, so `'justify'` is stored under `customData.textAlign` at write time and rendered
 * as `'left'` on the canvas (a follow-up PR wires the render hook). Docs (TipTap) accepts
 * all four natively.
 */
export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const

export type TextAlign = (typeof TEXT_ALIGNS)[number]

/** Excalidraw 0.18 native `textAlign` values (subset of TEXT_ALIGNS). */
export const EXCALIDRAW_NATIVE_TEXT_ALIGNS = ['left', 'center', 'right'] as const

export type ExcalidrawNativeTextAlign = (typeof EXCALIDRAW_NATIVE_TEXT_ALIGNS)[number]

/** True when the value is one Excalidraw's element type accepts directly. */
export function isExcalidrawNativeAlign(value: TextAlign): value is ExcalidrawNativeTextAlign {
  return value !== 'justify'
}
