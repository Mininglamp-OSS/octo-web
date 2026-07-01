import { useMemo } from 'react'
import WKApp from '../../App'
import { MessageWrap } from '../../Service/Model'
import { getMessageRow } from './useMessageRow'
import { isBitmapStickerFormat } from '../../Messages/LottieSticker/format'

export interface StickerMessageUI {
  row: ReturnType<typeof getMessageRow>
  url: string
  format: string
  category: string
  placeholder: string
  isBitmap: boolean
}

// 拉平 lottieSticker/lottieEmojiSticker 消息内容到 MessageRow 所需 UI 数据。
// - `row` 复用与 image/file/video 相同的 getMessageRow → head/头像/时间/徽章
//   全走同一份 MessageRow 布局，避免旧 MessageBase 路径样式漂移。
// - `isBitmap` 沿用 fail-safe 判定：未知/空/tgs 走 tgs-player，
//   png/gif/jpg/jpeg/webp 走 <img>（PR#496 review）。
export function getStickerMessageUI(message: MessageWrap): StickerMessageUI {
  const rowProps = getMessageRow(message)
  const content = message.content as any
  const rawUrl: string = content?.url || ''
  const format: string = content?.format || ''
  const category: string = content?.category || ''
  const placeholder: string = content?.placeholder || ''
  const resolvedUrl = rawUrl
    ? WKApp.dataSource.commonDataSource.getImageURL(rawUrl)
    : ''
  return {
    row: rowProps,
    url: resolvedUrl,
    format,
    category,
    placeholder,
    isBitmap: isBitmapStickerFormat(format),
  }
}

export function useStickerMessageUI(message: MessageWrap): StickerMessageUI {
  return useMemo(() => getStickerMessageUI(message), [message])
}
