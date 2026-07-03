import { describe, it, expect } from 'vitest'
import { isBitmapStickerFormat } from '../format'
import { isStickerMessageCollectable } from '../collect'
import { MessageContentTypeConst } from '../../../Service/Const'

// 贴纸的 format 字段是在历史发送之后才引入的：早期贴纸消息没有 format，解码默认空串，
// 本质是 Lottie(.tgs)。位图分流只能识别已知位图格式，其余(空/未知/tgs)必须 fall back
// 到 tgs-player，否则历史聊天里的 .tgs 贴纸会被喂进 <img> 而全部裂图(PR#496 review)。
describe('isBitmapStickerFormat', () => {
  it('treats known bitmap formats as bitmap (case-insensitive)', () => {
    for (const fmt of ['png', 'PNG', 'gif', 'GIF', 'jpg', 'jpeg', 'JPEG', 'webp', 'WebP']) {
      expect(isBitmapStickerFormat(fmt)).toBe(true)
    }
  })

  it('treats tgs as non-bitmap (Lottie → tgs-player)', () => {
    expect(isBitmapStickerFormat('tgs')).toBe(false)
    expect(isBitmapStickerFormat('TGS')).toBe(false)
  })

  it('fails safe to non-bitmap for empty/undefined/null (historical stickers had no format)', () => {
    expect(isBitmapStickerFormat('')).toBe(false)
    expect(isBitmapStickerFormat(undefined)).toBe(false)
    expect(isBitmapStickerFormat(null)).toBe(false)
  })

  it('fails safe to non-bitmap for unknown formats', () => {
    expect(isBitmapStickerFormat('svg')).toBe(false)
    expect(isBitmapStickerFormat('mp4')).toBe(false)
    expect(isBitmapStickerFormat('json')).toBe(false)
  })
})

// 「添加到我的贴纸」菜单只对位图贴纸消息显示。后端 collect 接口只接受位图格式，
// 提前在菜单侧收敛，避免用户点了以后被 request_invalid 打回。
describe('isStickerMessageCollectable', () => {
  const stickerPath = 'file/preview/sticker/uid-1/abc.png'

  it('accepts bitmap sticker messages with a non-empty url', () => {
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'png', stickerPath),
    ).toBe(true)
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'GIF', stickerPath),
    ).toBe(true)
  })

  it('also accepts the lottieEmojiSticker variant (contentType=13)', () => {
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieEmojiSticker, 'webp', stickerPath),
    ).toBe(true)
  })

  it('rejects tgs / empty / unknown formats (Lottie / historical stickers)', () => {
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'tgs', stickerPath),
    ).toBe(false)
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, '', stickerPath),
    ).toBe(false)
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, undefined, stickerPath),
    ).toBe(false)
  })

  it('rejects when url is empty (nothing to collect)', () => {
    expect(isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'png', '')).toBe(false)
    expect(
      isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'png', undefined),
    ).toBe(false)
    expect(isStickerMessageCollectable(MessageContentTypeConst.lottieSticker, 'png', null)).toBe(
      false,
    )
  })

  it('rejects non-sticker message types', () => {
    // text=1, image=2 — 菜单必须对非贴纸类型隐身，否则会污染文本/图片消息的右键菜单
    expect(isStickerMessageCollectable(1, 'png', stickerPath)).toBe(false)
    expect(isStickerMessageCollectable(MessageContentTypeConst.image, 'png', stickerPath)).toBe(
      false,
    )
  })
})
