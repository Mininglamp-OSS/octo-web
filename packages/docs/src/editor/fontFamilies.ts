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
