/**
 * 静态 emoji 数据（截图 / story 用）。
 *
 * 真实生产：应从 `Service/EmojiService` / 服务端 `common/emojis` manifest 拉取，
 * 并支持 `[收到]` 这类自定义 token。此处只承担纯 UI 展示，Phase 2 再接数据源。
 */

export interface PickerEmoji {
  /** 稳定 React key；对于自定义 token，用 wire 侧的 `[xxx]` 原文 */
  key: string
  /** 展示字符（unicode），或自定义 token 原文（`[使命必达]`）；有 image 时可作降级 */
  char: string
  /** 若为图片型表情（项目专属 token），此字段承载 <img src>；缺省回退到 char 文本 */
  image?: string
  /** 无障碍 aria-label / tooltip */
  name?: string
  /** 搜索关键字（英中都可） */
  keywords?: string[]
}

/**
 * 常用 unicode emoji（企微风 quick-pick）
 * 数量 = 6 列 × 2 行 - 4 tokens - 1 more = 7，保证 grid 严格对齐。
 * key 用 unicode 字符本身（与 DEFAULT_TOKENS 的 key==char 一致）：reaction 的聚合
 * 身份 = reactionKey = 该 char，picker 选中态用 emoji.key 比对，需与之统一。
 */
export const DEFAULT_FREQUENT: PickerEmoji[] = [
  { key: "👍", char: "👍", name: "赞" },
  { key: "👌", char: "👌", name: "好的" },
  { key: "😁", char: "😁", name: "666" },
  { key: "🌹", char: "🌹", name: "花" },
  { key: "🎉", char: "🎉", name: "庆祝" },
  { key: "❤️", char: "❤️", name: "爱心" },
  { key: "🔥", char: "🔥", name: "火" },
]

/**
 * 项目专属表情（quick-pick 顶行首位）。
 *
 * key 与 `Service/EmojiService.BUILTIN_CUSTOM_EMOJIS` 完全对齐（wire 侧原文），
 * image 走 apps 下 public/emoji/custom_<name>.png 打包资源；生产上真实拉取
 * 请调 `EmojiService.getEmojiUrl(item)` 拿绝对地址（含 manifest 下发的 CDN url 优先）。
 */
export const DEFAULT_TOKENS: PickerEmoji[] = [
  { key: "[使命必达]", char: "[使命必达]", image: "/emoji/custom_mission.png", name: "使命必达" },
  { key: "[崇尚行动]", char: "[崇尚行动]", image: "/emoji/custom_action.png", name: "崇尚行动" },
  { key: "[有品位]", char: "[有品位]", image: "/emoji/custom_taste.png", name: "有品位" },
  { key: "[尚方宝剑]", char: "[尚方宝剑]", image: "/emoji/custom_shangfang.png", name: "尚方宝剑" },
]
