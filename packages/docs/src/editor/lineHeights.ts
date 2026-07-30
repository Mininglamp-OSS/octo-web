/**
 * Line-height presets shared by the docs toolbar and the whiteboard text toolbar
 * so both surfaces expose the same line-spacing options.
 *
 * Kept as strings to match the TipTap `lineHeight` attribute (a CSS numeric length
 * stored as text: "1.5"). The whiteboard side converts to a number when writing to
 * Excalidraw's numeric `lineHeight` element field (branded `unitlessLineHeight`).
 */
export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'] as const

export type LineHeight = (typeof LINE_HEIGHTS)[number]

/** Default unitless line-height for the whiteboard; matches Excalidraw's own default (~1.25). */
export const DEFAULT_LINE_HEIGHT_PX = 1.25
