// LottieSticker/lottieEmojiSticker 的位图 vs Lottie 分流判定。
// 历史贴纸消息在 `format` 字段引入前就已发送，decodeJSON 默认 ""；
// 因此空/未知/tgs 全部 fail-safe 到 tgs-player，只有已知位图格式才走 <img>。
// PR#496 review 血泪：把 .tgs 喂进 <img> 会导致历史聊天中所有贴纸裂图。
const BITMAP_STICKER_FORMATS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp'])

export function isBitmapStickerFormat(format: string | undefined | null): boolean {
  return BITMAP_STICKER_FORMATS.has((format || '').toLowerCase())
}
