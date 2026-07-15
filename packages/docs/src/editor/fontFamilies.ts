/**
 * Font-family presets for the toolbar dropdown (SCHEMA_VERSION 16).
 *
 * `value` is written verbatim into the textStyle `fontFamily` attr → `style="font-family:…"`.
 * Each value carries a generic fallback so glyphs still render if the primary face is absent, and
 * the CJK faces keep their localized family-name alias (e.g. `"微软雅黑"`, `"宋体"`) so browsers
 * that only know the font by its Chinese name still match it. These CSS values are font resource
 * identifiers that MUST byte-match the native font names — they are NOT translatable UI copy, so
 * this module is listed in `.i18n/scan-config.json` (mirroring `export/docx/styles.ts`).
 *
 * The user-facing display name is driven by `labelKey`, an i18n key resolved via `t()` at render
 * time so the dropdown localizes correctly (zh-CN shows the Chinese face name, en-US the romanized
 * family name; Latin faces read the same in both locales).
 */
export const FONT_FAMILIES = [
  { labelKey: 'docs.toolbar.font.yahei', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
  { labelKey: 'docs.toolbar.font.simsun', value: 'SimSun, "宋体", serif' },
  { labelKey: 'docs.toolbar.font.simhei', value: 'SimHei, "黑体", sans-serif' },
  { labelKey: 'docs.toolbar.font.kaiti', value: 'KaiTi, "楷体", serif' },
  { labelKey: 'docs.toolbar.font.arial', value: 'Arial, Helvetica, sans-serif' },
  { labelKey: 'docs.toolbar.font.timesNewRoman', value: '"Times New Roman", Times, serif' },
  { labelKey: 'docs.toolbar.font.georgia', value: 'Georgia, serif' },
  { labelKey: 'docs.toolbar.font.courierNew', value: '"Courier New", Courier, monospace' },
] as const
