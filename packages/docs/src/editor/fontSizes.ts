/**
 * Font-size presets shared by the docs toolbar and the whiteboard text toolbar
 * so both surfaces expose the same size options.
 *
 * Kept as strings to match the TipTap `textStyle.fontSize` mark attribute, which
 * stores a CSS length as text ("16"/"16px"); the whiteboard side converts to a
 * number when writing to Excalidraw's numeric `fontSize` element field.
 */
export const FONT_SIZES = [
  '8', '9', '10', '11', '12', '14', '16', '18', '20',
  '22', '24', '26', '28', '32', '36', '48', '72', '96',
] as const

export type FontSize = (typeof FONT_SIZES)[number]

/** Default numeric font size (px) for the whiteboard, since Excalidraw's `fontSize` is a number. */
export const DEFAULT_FONT_SIZE_PX = 16
