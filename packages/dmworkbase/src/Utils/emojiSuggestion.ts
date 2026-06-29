import { DefaultEmojiService } from "../Service/EmojiService"

/**
 * 输入框「表情前缀联想」的核心纯逻辑。
 *
 * 匹配规则（词边界 + 整段前缀）：取光标前最长的连续中文片段 W（遇到非中文
 * 字符——字母/数字/标点/空格/已插入的 `[表情]` 的方括号——即为词边界），
 * 当 W 长度 >= MIN_QUERY_LEN 且某表情名以 W 开头时触发。
 *
 *   「使命」          → W=使命           → 命中 [使命必达]
 *   「公司的使命是」   → W=公司的使命是    → 非任何表情名前缀 → 不触发
 *   「使命是xxx」      → 光标前是字母      → W 为空/非前缀     → 不触发
 *   「[使命必达]崇尚」  → W=崇尚（] 为边界）→ 命中 [崇尚行动]
 *
 * 即：只有「从词边界开始、整段连续中文恰好是表情名前缀」才联想；句子中间
 * 出现表情名二字（如「我要完成使命」）不会误触发。仅对中文 key 的自定义表情
 * 生效；Unicode emoji（key 为表情符号本身）不参与文字联想。
 *
 * 这些函数不依赖 React / Tiptap，便于单测；运行时副作用仅来自 DefaultEmojiService
 * 单例（emojiMap 运行期不变，因此对自定义表情列表做模块级缓存）。
 */

export interface EmojiSuggestItem {
  /** 完整 key，插入输入框的纯文本，如 "[使命必达]" */
  key: string
  /** 去掉方括号的显示名，用于匹配与展示，如 "使命必达" */
  label: string
  /** 表情图片路径，如 "./emoji/custom_mission.png" */
  image: string
}

/** 仅匹配形如 `[中文]` 的自定义表情 key；Unicode emoji 的 key 不会命中 */
const CUSTOM_KEY_RE = /^\[.+\]$/

/** 触发联想的最小 query 长度（汉字数），单字不触发以压制误弹 */
export const MIN_QUERY_LEN = 2
/** 判定「连续中文词」边界用的 CJK 统一汉字区间 */
const CJK_CHAR = /[一-鿿]/

/**
 * 取光标前最长的连续中文片段（词边界为任何非中文字符或文本起点）。
 * 例：「[使命必达]崇尚」→「崇尚」；「公司的使命是」→「公司的使命是」；
 * 光标前紧邻字母时返回空串。
 */
export function trailingChineseWord(text: string): string {
  let i = text.length
  while (i > 0 && CJK_CHAR.test(text[i - 1])) {
    i--
  }
  return text.slice(i)
}

let cachedItems: EmojiSuggestItem[] | null = null

/**
 * 从 EmojiService 取出所有自定义表情（中文 key），转为联想项。
 * emojiMap 运行期不变，结果做模块级缓存。
 */
export function getCustomEmojiItems(): EmojiSuggestItem[] {
  if (cachedItems) {
    return cachedItems
  }
  cachedItems = DefaultEmojiService.shared
    .getAllEmoji()
    .filter((e) => CUSTOM_KEY_RE.test(e.key))
    .map((e) => ({
      key: e.key,
      label: e.key.slice(1, -1),
      image: e.image,
    }))
  return cachedItems
}

/** 测试辅助：清除缓存，使下一次 getCustomEmojiItems 重新构建 */
export function resetEmojiSuggestCache(): void {
  cachedItems = null
}

/**
 * 按 query 做前缀匹配，返回命中的自定义表情列表。
 * query 为空或长度不足时返回空数组。
 */
export function buildEmojiSuggestItems(query: string): EmojiSuggestItem[] {
  if (!query || query.length < MIN_QUERY_LEN) {
    return []
  }
  return getCustomEmojiItems().filter((e) => e.label.startsWith(query))
}

/**
 * 判断光标前文本是否应触发表情联想（词边界 + 整段前缀规则，见文件头注释）。
 *
 * @param textBeforeCursor 当前文本节点中、光标之前的文本
 * @returns 命中时返回 { query, items }，否则返回 null（不弹下拉）
 */
export function matchEmojiPrefix(
  textBeforeCursor: string,
): { query: string; items: EmojiSuggestItem[] } | null {
  if (!textBeforeCursor) {
    return null
  }
  const word = trailingChineseWord(textBeforeCursor)
  if (word.length < MIN_QUERY_LEN) {
    return null
  }
  const items = getCustomEmojiItems().filter((e) => e.label.startsWith(word))
  if (items.length === 0) {
    return null
  }
  return { query: word, items }
}
