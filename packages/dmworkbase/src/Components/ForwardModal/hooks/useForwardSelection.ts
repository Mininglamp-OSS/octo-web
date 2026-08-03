import { useCallback, useRef, useState } from "react"
import type { Channel } from "wukongimjssdk"
import type { ForwardItem } from "../ForwardModal"

/**
 * 选择态管理：selectedIDs / toggleSelect / selectedChannels。
 *
 * `channelMapRef` 由 candidates hook 持有（跨来源共享），此处只读拿 Channel 引用
 * 用于导出 selectedChannels + confirm 的通道；不复制、不重复登记 Channel。
 *
 * `readSelectedChannels()` 用一个 ref 兜住最新的 selectedIDs，让上层的 confirm()
 * 回调保持稳定引用（不因每次 toggleSelect 都重造函数）。
 */
export interface UseForwardSelectionResult {
  selectedIDs: string[]
  selectedChannels: Channel[]
  toggleSelect: (item: ForwardItem) => void
  /** 从最新 selectedIDs 计算 Channel 数组，供稳定的 confirm() 回调调用。 */
  readSelectedChannels: () => Channel[]
  reset: () => void
}

export function useForwardSelection(
  channelMapRef: React.MutableRefObject<Map<string, Channel>>,
): UseForwardSelectionResult {
  const [selectedIDs, setSelectedIDs] = useState<string[]>([])
  const selectedIDsRef = useRef<string[]>(selectedIDs)
  selectedIDsRef.current = selectedIDs

  const toggleSelect = useCallback((item: ForwardItem) => {
    setSelectedIDs((prev: string[]) =>
      prev.includes(item.channelID)
        ? prev.filter((id: string) => id !== item.channelID)
        : [...prev, item.channelID]
    )
  }, [])

  const selectedChannels = selectedIDs
    .map((id: string) => channelMapRef.current.get(id))
    .filter(Boolean) as Channel[]

  const readSelectedChannels = useCallback((): Channel[] => {
    return selectedIDsRef.current
      .map((id: string) => channelMapRef.current.get(id))
      .filter(Boolean) as Channel[]
  }, [channelMapRef])

  const reset = useCallback(() => {
    setSelectedIDs([])
  }, [])

  return {
    selectedIDs,
    selectedChannels,
    toggleSelect,
    readSelectedChannels,
    reset,
  }
}
