/**
 * Extended whiteboard font-size presets. The document toolbar intentionally retains its established
 * six-option list. Strings match the controlled input; Board converts them to Excalidraw's numeric
 * `fontSize` element field when committing a value.
 */
export const FONT_SIZES = [
  '8', '9', '10', '11', '12', '14', '16', '18', '20',
  '22', '24', '26', '28', '32', '36', '48', '72', '96',
] as const

export type FontSize = (typeof FONT_SIZES)[number]

/** Default numeric font size (px) for the whiteboard, since Excalidraw's `fontSize` is a number. */
export const DEFAULT_FONT_SIZE_PX = 16
