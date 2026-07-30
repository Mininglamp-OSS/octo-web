/**
 * Font-family presets for the toolbar dropdown (SCHEMA_VERSION 16).
 *
 * `value` is written verbatim into the textStyle `fontFamily` attr → `style="font-family:…"`.
 * Each value carries a generic fallback so glyphs still render if the primary face is absent, and
 * the CJK faces keep their localized family-name alias (e.g. `"宋体"`) so browsers that only know
 * the font by its Chinese name still match it. On macOS the Windows-named CJK faces (SimSun/SimHei/…)
 * resolve through the cross-platform `@font-face local()` aliases in editor/styles.css — the SAME
 * aliases the sheet uses — so the docs picker renders identically to the sheet's.
 *
 * This list is kept in sync with the sheet's font list (Univer's DEFAULT_FONT_LIST + the extras added
 * in CollabSheet.ts) so the two surfaces offer the same fonts. "微软雅黑" (Microsoft YaHei) is
 * intentionally omitted from both — Chromium reserves that family name and ignores any @font-face
 * alias for it, so it can only fall back to the default face on non-Windows clients. Arial is also
 * omitted from THIS list because it is the toolbar's DEFAULT option (value ''): an unset run inherits
 * Arial from the `.octo-doc` base font (editor/styles.css), matching the sheet's default cell face —
 * so picking "Arial" clears the mark rather than adding a redundant explicit Arial entry.
 *
 * These CSS values are font resource identifiers that MUST byte-match the native font names — they
 * are NOT translatable UI copy, so this module is listed in `.i18n/scan-config.json`.
 *
 * The user-facing display name is driven by `labelKey`, an i18n key resolved via `t()` at render
 * time (zh-CN shows the Chinese face name, en-US the romanized family name).
 */
export const FONT_FAMILIES = [
  { labelKey: 'docs.toolbar.font.calibri', value: 'Calibri, Carlito, sans-serif' },
  { labelKey: 'docs.toolbar.font.timesNewRoman', value: '"Times New Roman", Times, serif' },
  { labelKey: 'docs.toolbar.font.tahoma', value: 'Tahoma, sans-serif' },
  { labelKey: 'docs.toolbar.font.verdana', value: 'Verdana, sans-serif' },
  { labelKey: 'docs.toolbar.font.simsun', value: 'SimSun, "宋体", serif' },
  { labelKey: 'docs.toolbar.font.simhei', value: 'SimHei, "黑体", sans-serif' },
  { labelKey: 'docs.toolbar.font.kaiti', value: 'KaiTi, "楷体", serif' },
  { labelKey: 'docs.toolbar.font.fangsong', value: 'FangSong, "仿宋", serif' },
  { labelKey: 'docs.toolbar.font.nsimsun', value: 'NSimSun, "新宋体", serif' },
  { labelKey: 'docs.toolbar.font.stxinwei', value: 'STXinwei, "华文新魏", serif' },
  { labelKey: 'docs.toolbar.font.stxingkai', value: 'STXingkai, "华文行楷", cursive' },
  { labelKey: 'docs.toolbar.font.stliti', value: 'STLiti, "华文隶书", serif' },
  { labelKey: 'docs.toolbar.font.pingfang', value: '"PingFang SC", sans-serif' },
  { labelKey: 'docs.toolbar.font.hiraginoSansGB', value: '"Hiragino Sans GB", sans-serif' },
  { labelKey: 'docs.toolbar.font.stxihei', value: 'STXihei, sans-serif' },
  { labelKey: 'docs.toolbar.font.yuanti', value: '"Yuanti SC", sans-serif' },
  { labelKey: 'docs.toolbar.font.hannotate', value: '"Hannotate SC", cursive' },
  { labelKey: 'docs.toolbar.font.hanzipen', value: '"HanziPen SC", cursive' },
  { labelKey: 'docs.toolbar.font.wawati', value: '"Wawati SC", cursive' },
  { labelKey: 'docs.toolbar.font.georgia', value: 'Georgia, serif' },
  { labelKey: 'docs.toolbar.font.palatino', value: 'Palatino, "Palatino Linotype", serif' },
  { labelKey: 'docs.toolbar.font.courierNew', value: '"Courier New", Courier, monospace' },
  { labelKey: 'docs.toolbar.font.trebuchet', value: '"Trebuchet MS", sans-serif' },
  { labelKey: 'docs.toolbar.font.comicSans', value: '"Comic Sans MS", cursive' },
  { labelKey: 'docs.toolbar.font.impact', value: 'Impact, sans-serif' },
] as const

/**
 * Extract the primary (first) family name from a CSS font-family stack, stripping any surrounding
 * quotes — e.g. `'SimSun, "宋体", serif'` → `SimSun`, `'"PingFang SC", sans-serif'` → `PingFang SC`.
 * This is the bare family name that Univer's Sheet stores in a cell and that the availability probe
 * measures, so it MUST match how the native face is named.
 */
export function primaryFontName(value: string): string {
  const first = value.split(',')[0]?.trim() ?? ''
  return first.replace(/^['"]|['"]$/g, '')
}

/**
 * Whether the browser can render the given font family from a locally-installed face.
 *
 * This is the shared availability probe for the two surfaces that render text through this package:
 * the Doc toolbar and the Board text controls (which re-export it as `isBoardFontSupported`). It is
 * modelled on Univer's `IFontService.isFontSupported` — canvas glyph-width measurement, never a
 * download — but it is NOT the probe the Sheet uses: this refactor only changes which fonts the Sheet
 * *registers* (see `SHEET_FONT_ADDITIONS`); the Sheet still decides availability through Univer's own
 * `FontService`. The two implementations also differ in their degenerate branch — Univer returns
 * `false` when no 2D context is available, whereas we return `true` (below) to avoid a false
 * "unavailable" warning — so their verdicts are not guaranteed identical in that edge case.
 *
 * It compares the glyph width of a probe string rendered in the requested face against each generic
 * fallback: if the face is missing, the browser substitutes the fallback and the widths match. Only
 * the primary family of the stack is probed (`primaryFontName`, mirroring Univer's primary-only
 * semantics), so a stack whose primary face is absent but a later family IS installed is still
 * reported unavailable — the warning means "the primary face isn't installed", not "nothing in the
 * stack can render". It ONLY inspects already-installed local faces — it never downloads or
 * `@font-face`-loads a font.
 *
 * Returns `true` when detection is impossible (SSR, or a canvas 2D context is unavailable) so callers
 * never surface a false "unavailable" warning.
 */
export function isFontFamilySupported(value: string): boolean {
  if (typeof document === 'undefined') return true
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return true
  const font = primaryFontName(value)
  if (!font) return true
  const text = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const size = '72px'
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    context.font = `${size} ${base}`
    const fallbackWidth = context.measureText(text).width
    context.font = `${size} "${font}", ${base}`
    return context.measureText(text).width !== fallbackWidth
  })
}

export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'handwriting' | 'display'

/**
 * Univer's picker category for the fonts the Sheet adds on top of its built-in DEFAULT_FONT_LIST.
 * Keyed by the SHARED catalogue `labelKey`, so the Sheet's extra fonts, their display labels and the
 * Doc/Board catalogue can never drift apart. Entries absent here are the Windows-named faces Univer
 * already ships (Arial/Times New Roman/Tahoma/Verdana + the SimSun/SimHei/… CJK set), so re-adding
 * them would only produce duplicate picker rows.
 */
const SHEET_ADDITION_CATEGORIES: Partial<
  Record<(typeof FONT_FAMILIES)[number]['labelKey'], FontCategory>
> = {
  'docs.toolbar.font.calibri': 'sans-serif',
  'docs.toolbar.font.pingfang': 'sans-serif',
  'docs.toolbar.font.hiraginoSansGB': 'sans-serif',
  'docs.toolbar.font.stxihei': 'sans-serif',
  'docs.toolbar.font.yuanti': 'sans-serif',
  'docs.toolbar.font.hannotate': 'handwriting',
  'docs.toolbar.font.hanzipen': 'handwriting',
  'docs.toolbar.font.wawati': 'handwriting',
  'docs.toolbar.font.georgia': 'serif',
  'docs.toolbar.font.palatino': 'serif',
  'docs.toolbar.font.courierNew': 'monospace',
  'docs.toolbar.font.trebuchet': 'sans-serif',
  'docs.toolbar.font.comicSans': 'handwriting',
  'docs.toolbar.font.impact': 'display',
}

/**
 * The fonts the Sheet picker registers beyond Univer's DEFAULT_FONT_LIST, derived from the shared
 * catalogue so Doc/Board/Sheet expose the same faces under the same localized names. `value` is the
 * bare family name a cell stores/exports; `labelKey` is the SHARED i18n key (there is no separate
 * sheet label set); `category` groups the option in Univer's native picker.
 */
export const SHEET_FONT_ADDITIONS: ReadonlyArray<{
  value: string
  labelKey: string
  category: FontCategory
}> = FONT_FAMILIES.filter((f) => f.labelKey in SHEET_ADDITION_CATEGORIES).map((f) => ({
  value: primaryFontName(f.value),
  labelKey: f.labelKey,
  // The `filter` above guarantees the key is present, so the `Partial` lookup is non-null here.
  category: SHEET_ADDITION_CATEGORIES[f.labelKey]!,
}))
