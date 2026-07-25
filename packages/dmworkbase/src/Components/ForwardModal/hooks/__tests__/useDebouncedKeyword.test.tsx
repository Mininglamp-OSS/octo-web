// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

import { useDebouncedKeyword } from "../useDebouncedKeyword"

function Probe({
  delayMs,
  onValue,
}: {
  delayMs?: number
  onValue: (value: ReturnType<typeof useDebouncedKeyword>) => void
}) {
  const value = useDebouncedKeyword(delayMs)
  onValue(value)
  return null
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("useDebouncedKeyword", () => {
  let container: HTMLDivElement
  let latest: ReturnType<typeof useDebouncedKeyword>

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  it("updates inputValue immediately but keyword only after delay", async () => {
    act(() => {
      ReactDOM.render(
        <Probe onValue={(v) => (latest = v)} />,
        container,
      )
    })

    expect(latest.inputValue).toBe("")
    expect(latest.keyword).toBe("")

    act(() => {
      latest.setInputValue("hel")
    })
    // inputValue 立即更新驱动 UI；keyword 尚未越过 debounce。
    expect(latest.inputValue).toBe("hel")
    expect(latest.keyword).toBe("")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(latest.keyword).toBe("")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(latest.keyword).toBe("hel")
  })

  it("resets keyword AND clears the pending timer so a late setKeyword never fires", async () => {
    act(() => {
      ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
    })

    act(() => {
      latest.setInputValue("stale")
    })
    expect(latest.inputValue).toBe("stale")

    act(() => {
      latest.reset()
    })
    expect(latest.inputValue).toBe("")
    expect(latest.keyword).toBe("")

    // 关键：reset 已 clearTimeout；后续推进时间不得让 "stale" 回填 keyword。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(latest.keyword).toBe("")
    expect(latest.inputValue).toBe("")
  })

  it("honours a custom delayMs", async () => {
    act(() => {
      ReactDOM.render(
        <Probe delayMs={50} onValue={(v) => (latest = v)} />,
        container,
      )
    })

    act(() => {
      latest.setInputValue("fast")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(latest.keyword).toBe("fast")
  })

  it("cleans up the pending timer on unmount so no late setKeyword hits an unmounted component", async () => {
    let captured: ReturnType<typeof useDebouncedKeyword> | undefined
    act(() => {
      ReactDOM.render(
        <Probe onValue={(v) => (captured = v)} />,
        container,
      )
    })

    act(() => {
      captured!.setInputValue("in-flight")
    })

    // 卸载前推进不到 debounce 边界；卸载后再推过边界，若清理失败会触发 React 警告。
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
    // 已卸载：无需再触碰 latest；container 由 afterEach 兜底清理。
  })

  it("only fires the latest keystroke when multiple setInputValue calls stack within the debounce window", async () => {
    act(() => {
      ReactDOM.render(<Probe onValue={(v) => (latest = v)} />, container)
    })

    act(() => {
      latest.setInputValue("a")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    act(() => {
      latest.setInputValue("ab")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    act(() => {
      latest.setInputValue("abc")
    })

    // 300ms 从 "abc" 那次调用起计；此时距最新调用不到 300ms → keyword 仍空。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(latest.keyword).toBe("")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    // 只跳到最终值，中间的 "a" / "ab" 都被合并掉。
    expect(latest.keyword).toBe("abc")
  })

  // node ping – silence unused
  void flushMicrotasks
})
