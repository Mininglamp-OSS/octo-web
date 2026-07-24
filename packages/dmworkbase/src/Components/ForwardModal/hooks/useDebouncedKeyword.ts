import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 输入框防抖：`inputValue` 即时更新驱动 UI，`keyword` 经 delayMs 静默后才生效
 * 触发下游过滤/搜索，避免每次按键都跑一遍关键字过滤 + 后端搜索接口。
 *
 * 默认 300ms，与既有 useForwardModal 行为一致。unmount 时清理定时器，
 * 防止在已卸载组件上触发 setKeyword。resetKeyword() 供外部同步清空 input
 * 与已生效 keyword（例如 confirm 后重置状态）。
 */
export interface UseDebouncedKeywordResult {
  inputValue: string
  keyword: string
  setInputValue: (val: string) => void
  reset: () => void
}

export function useDebouncedKeyword(delayMs = 300): UseDebouncedKeywordResult {
  const [inputValue, setInputValueState] = useState("")
  const [keyword, setKeyword] = useState("")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setInputValue = useCallback((val: string) => {
    setInputValueState(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setKeyword(val)
    }, delayMs)
  }, [delayMs])

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setInputValueState("")
    setKeyword("")
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { inputValue, keyword, setInputValue, reset }
}
