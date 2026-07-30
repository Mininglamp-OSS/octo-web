import { FONT_FAMILIES } from '../editor/fontFamilies.ts'

/**
 * Stable Excalidraw ids for the Doc/Sheet font catalogue.
 *
 * Excalidraw persists `fontFamily` as a number and uses the same id for canvas rendering,
 * measurement, wrapping and its WYSIWYG textarea. Values are explicit (not array indexes), so
 * reordering FONT_FAMILIES cannot reinterpret persisted board elements.
 */
const BOARD_FONT_IDS: Readonly<Record<string, number>> = {
  'Arial, Helvetica, sans-serif': 2001,
  '"Times New Roman", Times, serif': 2002,
  'Tahoma, sans-serif': 2003,
  'Verdana, sans-serif': 2004,
  'SimSun, "宋体", serif': 2005,
  'SimHei, "黑体", sans-serif': 2006,
  'KaiTi, "楷体", serif': 2007,
  'FangSong, "仿宋", serif': 2008,
  'NSimSun, "新宋体", serif': 2009,
  'STXinwei, "华文新魏", serif': 2010,
  'STXingkai, "华文行楷", cursive': 2011,
  'STLiti, "华文隶书", serif': 2012,
  '"PingFang SC", sans-serif': 2013,
  '"Hiragino Sans GB", sans-serif': 2014,
  'STXihei, sans-serif': 2015,
  '"Yuanti SC", sans-serif': 2016,
  '"Hannotate SC", cursive': 2017,
  '"HanziPen SC", cursive': 2018,
  '"Wawati SC", cursive': 2019,
  'Georgia, serif': 2020,
  'Palatino, "Palatino Linotype", serif': 2021,
  '"Courier New", Courier, monospace': 2022,
  '"Trebuchet MS", sans-serif': 2023,
  '"Comic Sans MS", cursive': 2024,
  'Impact, sans-serif': 2025,
  'Calibri, Carlito, sans-serif': 2026,
}

export const DEFAULT_BOARD_FONT_FAMILY = BOARD_FONT_IDS['Arial, Helvetica, sans-serif']

export const BOARD_FONT_FAMILIES = [
  {
    id: DEFAULT_BOARD_FONT_FAMILY,
    labelKey: 'docs.toolbar.font.arial',
    value: 'Arial, Helvetica, sans-serif',
  },
  ...FONT_FAMILIES.map((font) => {
    const id = BOARD_FONT_IDS[font.value]
    if (id == null) throw new Error(`Missing stable board font id for ${font.value}`)
    return { id, labelKey: font.labelKey, value: font.value }
  }),
] as const

const boardFontIds = new Set<number>(BOARD_FONT_FAMILIES.map((font) => font.id))

export function isBoardFontFamily(value: unknown): value is number {
  return typeof value === 'number' && boardFontIds.has(value)
}

export function normalizeBoardFontFamily(value: unknown): number {
  return isBoardFontFamily(value) ? value : DEFAULT_BOARD_FONT_FAMILY
}
