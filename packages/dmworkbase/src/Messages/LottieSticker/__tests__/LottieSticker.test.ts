import { describe, it, expect, vi } from 'vitest'

vi.mock('wukongimjssdk', () => ({
  MessageContent: class {},
}))

vi.mock('react', async () => await vi.importActual('react'))
vi.mock('@lottiefiles/lottie-player/dist/tgs-player', () => ({}))
vi.mock('../../../App', () => ({ default: { dataSource: { commonDataSource: { getImageURL: (u: string) => u } } } }))
vi.mock('../../../Service/Const', () => ({ MessageContentTypeConst: { lottieSticker: 12 } }))
vi.mock('../../Base', () => ({ default: () => null }))
vi.mock('../../MessageCell', () => ({ MessageCell: class {} }))
vi.mock('../../../i18n', () => ({ t: (k: string) => k }))

import { isBitmapStickerFormat } from '../index'

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
