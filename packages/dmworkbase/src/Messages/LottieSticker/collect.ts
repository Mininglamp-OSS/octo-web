import { MessageContentTypeConst } from "../../Service/Const"
import { isBitmapStickerFormat } from "./format"

// 判断一条贴纸消息是否允许「添加到我的贴纸」。
//
// 仅当满足以下全部条件才可入库：
//   1) contentType ∈ {lottieSticker, lottieEmojiSticker}
//   2) url 非空（历史或坏消息可能没有 path，收藏没有意义）
//   3) format 为已知位图（gif/png/jpg/jpeg/webp）
//
// tgs/Lottie 与未知格式一律 false —— 后端「我的贴纸」入库链路只支持位图格式，
// 塞进去也无法在 EmojiToolbar 里回放（会走 tgs-player 兜底）；提前在菜单侧过滤，
// 用户就看不到「添加到我的贴纸」，避免点击后被后端拒后再报错的糟糕交互。
export function isStickerMessageCollectable(
    contentType: number,
    format: string | undefined | null,
    url: string | undefined | null,
): boolean {
    const isStickerMessage =
        contentType === MessageContentTypeConst.lottieSticker ||
        contentType === MessageContentTypeConst.lottieEmojiSticker
    if (!isStickerMessage) return false
    if (!url) return false
    return isBitmapStickerFormat(format)
}
