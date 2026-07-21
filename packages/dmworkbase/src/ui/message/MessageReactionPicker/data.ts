import { BUILTIN_CUSTOM_EMOJI_KEYS } from "../../../Service/EmojiService";

/**
 * 静态 emoji 数据（截图 / story 用）。
 *
 * 真实生产：应从 `Service/EmojiService` / 服务端 `common/emojis` manifest 拉取，
 * 并支持 `[收到]` 这类自定义 token。此处只承担纯 UI 展示，Phase 2 再接数据源。
 */

export interface PickerEmoji {
  /** 稳定 React key；对于自定义 token，用 wire 侧的 `[xxx]` 原文 */
  key: string;
  /** 展示字符（unicode），或自定义 token 原文（`[使命必达]`）；有 image 时可作降级 */
  char: string;
  /** 若为图片型表情（项目专属 token），此字段承载 <img src>；缺省回退到 char 文本 */
  image?: string;
  /** 无障碍 aria-label / tooltip */
  name?: string;
  /** 由业务层通过 i18n 解析为 name，静态数据中不保存用户可见文案 */
  nameKey?: string;
  /** 搜索关键字（英中都可） */
  keywords?: string[];
}

/**
 * 常用 unicode emoji（企微风 quick-pick）
 * 数量 = 6 列 × 2 行 - 4 tokens - 1 more = 7，保证 grid 严格对齐。
 * key 用 unicode 字符本身（与 DEFAULT_TOKENS 的 key==char 一致）：reaction 的聚合
 * 身份 = reactionKey = 该 char，picker 选中态用 emoji.key 比对，需与之统一。
 */
export const DEFAULT_FREQUENT: PickerEmoji[] = [
  { key: "👍", char: "👍", nameKey: "base.reaction.emoji.thumbsUp" },
  { key: "👌", char: "👌", nameKey: "base.reaction.emoji.ok" },
  { key: "😁", char: "😁", nameKey: "base.reaction.emoji.grin" },
  { key: "🌹", char: "🌹", nameKey: "base.reaction.emoji.rose" },
  { key: "🎉", char: "🎉", nameKey: "base.reaction.emoji.celebrate" },
  { key: "❤️", char: "❤️", nameKey: "base.reaction.emoji.heart" },
  { key: "🔥", char: "🔥", nameKey: "base.reaction.emoji.fire" },
];

/**
 * 项目专属表情（quick-pick 顶行首位）。
 *
 * key 与 `Service/EmojiService.BUILTIN_CUSTOM_EMOJIS` 完全对齐（wire 侧原文），
 * image 走 apps 下 public/emoji/custom_<name>.png 打包资源；生产上真实拉取
 * 请调 `EmojiService.getEmojiUrl(item)` 拿绝对地址（含 manifest 下发的 CDN url 优先）。
 */
export const DEFAULT_TOKENS: PickerEmoji[] = [
  {
    key: BUILTIN_CUSTOM_EMOJI_KEYS.mission,
    char: BUILTIN_CUSTOM_EMOJI_KEYS.mission,
    image: "/emoji/custom_mission.png",
    nameKey: "base.reaction.emoji.mission",
  },
  {
    key: BUILTIN_CUSTOM_EMOJI_KEYS.action,
    char: BUILTIN_CUSTOM_EMOJI_KEYS.action,
    image: "/emoji/custom_action.png",
    nameKey: "base.reaction.emoji.action",
  },
  {
    key: BUILTIN_CUSTOM_EMOJI_KEYS.taste,
    char: BUILTIN_CUSTOM_EMOJI_KEYS.taste,
    image: "/emoji/custom_taste.png",
    nameKey: "base.reaction.emoji.taste",
  },
  {
    key: BUILTIN_CUSTOM_EMOJI_KEYS.shangfang,
    char: BUILTIN_CUSTOM_EMOJI_KEYS.shangfang,
    image: "/emoji/custom_shangfang.png",
    nameKey: "base.reaction.emoji.shangfang",
  },
];

export function localizePickerEmojis(
  emojis: readonly PickerEmoji[],
  translate: (key: string) => string
): PickerEmoji[] {
  return emojis.map((emoji) => ({
    ...emoji,
    name: emoji.nameKey ? translate(emoji.nameKey) : emoji.name,
  }));
}
