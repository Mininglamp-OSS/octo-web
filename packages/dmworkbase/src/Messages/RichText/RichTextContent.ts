import { MessageContent } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { t } from "../../i18n";

/** RichText(=14) 图文混排 block 类型常量（与 octo-lib common/richtext.go 对齐）。 */
export const RichTextBlockType = {
  text: "text",
  image: "image",
  file: "file",
} as const;

/** plain 生成时 image block 注入的占位符（与 octo-lib RichTextImagePlaceholder 对齐）。 */
export const RichTextImagePlaceholder = "[图片]";
/** plain 生成时 file block 注入的占位符。仅用于前端前向兼容展示，发送侧暂不构造 file block。 */
export const RichTextFilePlaceholder = "[文件]";

/**
 * RichText(=14) content 数组中的单个 block。
 * 字段命名与 server payload（snake_case 兼容）保持一致：
 *   - text  块：type="text"，text 为纯文本（MVP 不渲染 markdown）；
 *   - image 块：type="image"，url 为图片引用地址，width/height 供占位排版。
 *   - file  块：type="file"，当前仅做前向兼容接收渲染，发送侧待 octo-lib/backend 契约支持后打开。
 */
export interface RichTextBlock {
  type: string;
  /** text block 文本内容。 */
  text?: string;
  /** image block 图片地址（scheme allowlist 仅 http/https）。 */
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  name?: string;
  extension?: string;
  mime?: string;
  caption?: string;
}

/**
 * 遍历 content blocks 生成纯文本（与 octo-lib BuildRichTextPlain 对齐）：
 *   - text  block 取 text；
 *   - image block 注入占位符；
 *   - file  block 注入占位符 + 文件名；
 *   - 未知 type 前向兼容：有 text 则取 text，否则跳过。
 */
export function buildRichTextPlain(content: RichTextBlock[]): string {
  let out = "";
  for (const blk of content) {
    if (blk.type === RichTextBlockType.image) {
      out += RichTextImagePlaceholder;
    } else if (blk.type === RichTextBlockType.file) {
      out += blk.name
        ? `${RichTextFilePlaceholder} ${blk.name}`
        : RichTextFilePlaceholder;
    } else if (blk.type === RichTextBlockType.text) {
      out += blk.text || "";
    } else if (blk.text) {
      out += blk.text;
    }
  }
  return out;
}

/** 构造一个 text block（发送侧，与接收侧 schema 对齐）。 */
export function makeTextBlock(text: string): RichTextBlock {
  return { type: RichTextBlockType.text, text };
}

/**
 * 构造一个 image block（发送侧，与接收侧 schema + octo-lib 权威 schema 对齐）。
 * url/width/height 必填（contract §image 必填 >0，供端上占位排版）；size/name 仅在有值时带上，
 * 避免往 wire 注入 0/空 字段污染 byte-match。
 */
export function makeImageBlock(opts: {
  url: string;
  width: number;
  height: number;
  size?: number;
  name?: string;
}): RichTextBlock {
  const blk: RichTextBlock = {
    type: RichTextBlockType.image,
    url: opts.url,
    width: opts.width,
    height: opts.height,
  };
  if (opts.size && opts.size > 0) blk.size = opts.size;
  if (opts.name) blk.name = opts.name;
  return blk;
}

/**
 * 构造一个可发送的 RichText(=14) 正文（发送侧入口，与接收侧 decodeJSON 共用同一份 schema）。
 *
 * plain 字段：本地按 buildRichTextPlain 填一份占位（image→RichTextImagePlaceholder），
 * 仅用于本地回显 / 离线兜底；**server #232 Finalize 会重算覆盖**，web 不是 plain 权威源。
 * 占位符 token 复用 RichTextImagePlaceholder（wire-format 不可本地化），与接收侧严格对称。
 */
export function createRichTextContent(
  content: RichTextBlock[]
): RichTextContent {
  const c = new RichTextContent();
  c.content = content;
  c.plain = buildRichTextPlain(content);
  return c;
}

/**
 * RichText(=14) 图文混排消息正文（接收渲染 + 发送构造共用同一份 schema）。
 *
 * payload 结构（见 octo-lib common/richtext.go）：
 *   { type: 14, content: [ {type:"text",text} | {type:"image",url,width,height} ], plain }
 *   - content 为有序数组，顺序即图文穿插顺序；
 *   - plain 为冗余纯文本，server 权威生成，供复制 / 引用预览 / 搜索复用。
 *   - file block 字段仅用于前端前向兼容展示；当前发送侧不会构造 file block。
 *
 * 向后兼容：老 payload content 可能是纯字符串，归一为单个 text block。
 */
export class RichTextContent extends MessageContent {
  content: RichTextBlock[] = [];
  plain = "";

  decodeJSON(content: any) {
    const raw = content?.content;
    if (Array.isArray(raw)) {
      this.content = raw.map((blk: any) => ({
        type: blk?.type,
        text: blk?.text,
        url: blk?.url,
        width: blk?.width,
        height: blk?.height,
        size: blk?.size,
        name: blk?.name,
        extension: blk?.extension,
        mime: blk?.mime,
        caption: blk?.caption,
      }));
    } else if (typeof raw === "string") {
      // 兼容老版本 content 为纯字符串：归一为单个 text block。
      this.content = raw ? [{ type: RichTextBlockType.text, text: raw }] : [];
    } else {
      this.content = [];
    }
    this.plain = typeof content?.plain === "string" ? content.plain : "";
    // plain 缺失时（老 payload 或字符串 content）现场回填，保证复制/引用预览不丢字。
    if (this.plain.trim() === "") {
      this.plain = buildRichTextPlain(this.content);
    }
  }

  encodeJSON(): any {
    // 发送侧序列化 content blocks + 本地 plain 占位（server #232 Finalize 重算覆盖）。
    // SDK MessageContent.encode() 会注入 type=14；JSON.stringify 自动丢弃 undefined 字段，
    // 保证 wire-format 与 octo-lib 权威 schema byte-match。
    return { content: this.content, plain: this.plain };
  }

  get contentType() {
    return MessageContentTypeConst.richText;
  }

  /**
   * 引用预览 / 会话摘要文本：优先 server 生成的 plain，回退现场遍历 blocks，
   * 都为空再回退到静态「富文本消息」（与旧端 UnknownContent 行为一致）。
   */
  get conversationDigest() {
    if (this.plain.trim() !== "") {
      return this.plain;
    }
    const plain = buildRichTextPlain(this.content);
    if (plain !== "") {
      return plain;
    }
    return t("base.message.digest.richText");
  }
}

export default RichTextContent;
