/**
 * Univer 0.25's real sheet image picker and ImageIoService share this mutable
 * allow-list. SVG renders correctly through the browser-backed BASE64 path, but
 * the upstream default omits it. Extend it once before the drawing preset is
 * created so both the picker (`.svg`) and runtime MIME validation agree.
 */
export function enableSheetSvgImages(allowList: string[]): void {
  // Univer derives the native picker accept string with
  // `.${mime.replace('image/', '')}`. `image/svg+xml` is the browser File MIME,
  // while `image/svg` is also needed so that derivation includes the real .svg
  // extension (rather than only the invalid-looking .svg+xml suffix).
  for (const mime of ['image/svg', 'image/svg+xml']) {
    if (!allowList.includes(mime)) allowList.push(mime)
  }
}
