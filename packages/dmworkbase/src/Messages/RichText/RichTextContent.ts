import { MessageContent } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../Service/Const"
import { t } from "../../i18n"

/** RichText(=14) 图文混排 block 类型常量（与 octo-lib common/richtext.go 对齐）。 */
export const RichTextBlockType = {
    text: "text",
    image: "image",
} as const

/** plain 生成时 image block 注入的占位符（与 octo-lib RichTextImagePlaceholder 对齐）。 */
export const RichTextImagePlaceholder = "[图片]"

/**
 * RichText(=14) content 数组中的单个 block。
 * 字段命名与 server payload（snake_case 兼容）保持一致：
 *   - text  块：type="text"，text 为纯文本（MVP 不渲染 markdown）；
 *   - image 块：type="image"，url 为图片引用地址，width/height 供占位排版。
 */
export interface RichTextBlock {
    type: string
    /** text block 文本内容。 */
    text?: string
    /** image block 图片地址（scheme allowlist 仅 http/https）。 */
    url?: string
    width?: number
    height?: number
    size?: number
    name?: string
}

/**
 * 遍历 content blocks 生成纯文本（与 octo-lib BuildRichTextPlain 对齐）：
 *   - text  block 取 text；
 *   - image block 注入占位符；
 *   - 未知 type 前向兼容：有 text 则取 text，否则跳过。
 */
export function buildRichTextPlain(content: RichTextBlock[]): string {
    let out = ""
    for (const blk of content) {
        if (blk.type === RichTextBlockType.image) {
            out += RichTextImagePlaceholder
        } else if (blk.type === RichTextBlockType.text) {
            out += blk.text || ""
        } else if (blk.text) {
            out += blk.text
        }
    }
    return out
}

/**
 * RichText(=14) 图文混排消息正文（Phase 1：仅接收渲染）。
 *
 * payload 结构（见 octo-lib common/richtext.go）：
 *   { type: 14, content: [ {type:"text",text} | {type:"image",url,width,height} ], plain }
 *   - content 为有序数组，顺序即图文穿插顺序；
 *   - plain 为冗余纯文本，server 权威生成，供复制 / 引用预览 / 搜索复用。
 *
 * 向后兼容：老 payload content 可能是纯字符串，归一为单个 text block。
 */
export class RichTextContent extends MessageContent {
    content: RichTextBlock[] = []
    plain = ""

    decodeJSON(content: any) {
        const raw = content?.content
        if (Array.isArray(raw)) {
            this.content = raw.map((blk: any) => ({
                type: blk?.type,
                text: blk?.text,
                url: blk?.url,
                width: blk?.width,
                height: blk?.height,
                size: blk?.size,
                name: blk?.name,
            }))
        } else if (typeof raw === "string") {
            // 兼容老版本 content 为纯字符串：归一为单个 text block。
            this.content = raw ? [{ type: RichTextBlockType.text, text: raw }] : []
        } else {
            this.content = []
        }
        this.plain = typeof content?.plain === "string" ? content.plain : ""
        // plain 缺失时（老 payload 或字符串 content）现场回填，保证复制/引用预览不丢字。
        if (this.plain.trim() === "") {
            this.plain = buildRichTextPlain(this.content)
        }
    }

    encodeJSON(): any {
        // Phase 1 仅接收渲染，发送端留后续单；此处保留可往返编码以防转发等路径复用。
        return { content: this.content, plain: this.plain }
    }

    get contentType() {
        return MessageContentTypeConst.richText
    }

    /**
     * 引用预览 / 会话摘要文本：优先 server 生成的 plain，回退现场遍历 blocks，
     * 都为空再回退到静态「富文本消息」（与旧端 UnknownContent 行为一致）。
     */
    get conversationDigest() {
        if (this.plain.trim() !== "") {
            return this.plain
        }
        const plain = buildRichTextPlain(this.content)
        if (plain !== "") {
            return plain
        }
        return t("base.message.digest.richText")
    }
}

export default RichTextContent
