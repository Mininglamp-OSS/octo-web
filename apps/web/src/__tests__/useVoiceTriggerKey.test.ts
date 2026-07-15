import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

vi.mock("lottie-web", () => ({}))
vi.mock("@douyinfe/semi-ui", () => ({}))

import useVoiceTriggerKey from "@octo/base/src/Components/MessageInput/useVoiceTriggerKey"

// ── localStorage stub ──────────────────────────────────────────────────────
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
    removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
    clear: vi.fn(() => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]) }),
}
Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true })

// ── helpers ────────────────────────────────────────────────────────────────
function makeKeyEvent(code: string, extra: Partial<KeyboardEventInit> = {}) {
    const e = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...extra })
    vi.spyOn(e, "stopImmediatePropagation")
    vi.spyOn(e, "preventDefault")
    return e
}

function fireKeyDown(code: string, extra: Partial<KeyboardEventInit> = {}) {
    window.dispatchEvent(makeKeyEvent(code, extra))
}

function pressNTimes(code: string, n: number, gapMs = 100) {
    for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(gapMs)
        fireKeyDown(code)
    }
}

// Fires n presses and returns the event objects so callers can inspect spies
function pressNTimesTracked(code: string, n: number, gapMs = 100) {
    const events: KeyboardEvent[] = []
    for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(gapMs)
        const e = makeKeyEvent(code)
        window.dispatchEvent(e)
        events.push(e)
    }
    return events
}

// ── tests ──────────────────────────────────────────────────────────────────
describe("useVoiceTriggerKey", () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── basic state ──────────────────────────────────────────────────────
    it("defaults to ShiftLeft when localStorage is empty", () => {
        const { result } = renderHook(() => useVoiceTriggerKey(vi.fn()))
        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
    })

    it("reads initial value from localStorage", () => {
        localStorageStore["octo_voice_trigger_key"] = "ShiftRight"
        const { result } = renderHook(() => useVoiceTriggerKey(vi.fn()))
        expect(result.current.voiceTriggerKey).toBe("ShiftRight")
    })

    // ── toggle ───────────────────────────────────────────────────────────
    it("switches ShiftLeft → ShiftRight after 7 rapid presses", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => { pressNTimes("ShiftLeft", 7) })

        expect(result.current.voiceTriggerKey).toBe("ShiftRight")
        expect(onToggled).toHaveBeenCalledOnce()
        expect(onToggled).toHaveBeenCalledWith("ShiftRight")
        expect(localStorageMock.setItem).toHaveBeenCalledWith("octo_voice_trigger_key", "ShiftRight")
    })

    it("switches ShiftRight → ShiftLeft after 7 rapid presses", () => {
        localStorageStore["octo_voice_trigger_key"] = "ShiftRight"
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => { pressNTimes("ShiftRight", 7) })

        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).toHaveBeenCalledWith("ShiftLeft")
    })

    it("does not toggle after only 6 presses", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => { pressNTimes("ShiftLeft", 6) })

        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).not.toHaveBeenCalled()
    })

    // ── P1 fix: stopImmediatePropagation on completing press ─────────────
    it("calls stopImmediatePropagation() and preventDefault() on the 7th (completing) press", () => {
        renderHook(() => useVoiceTriggerKey(vi.fn()))

        let events: KeyboardEvent[]
        act(() => { events = pressNTimesTracked("ShiftLeft", 7) })

        const completing = events![6]
        expect(completing.stopImmediatePropagation).toHaveBeenCalled()
        expect(completing.preventDefault).toHaveBeenCalled()
    })

    it("does NOT call stopImmediatePropagation() on non-completing presses (1-6)", () => {
        renderHook(() => useVoiceTriggerKey(vi.fn()))

        let events: KeyboardEvent[]
        act(() => { events = pressNTimesTracked("ShiftLeft", 6) })

        events!.forEach((e) => {
            expect(e.stopImmediatePropagation).not.toHaveBeenCalled()
        })
    })

    // ── P1 fix: isVoiceEnabled gate ──────────────────────────────────────
    it("does not register a listener when isVoiceEnabled=false", () => {
        const onToggled = vi.fn()
        renderHook(() => useVoiceTriggerKey(onToggled, { isVoiceEnabled: false }))

        act(() => { pressNTimes("ShiftLeft", 7) })

        expect(onToggled).not.toHaveBeenCalled()
    })

    it("registers listener when isVoiceEnabled=true (default)", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled, { isVoiceEnabled: true }))

        act(() => { pressNTimes("ShiftLeft", 7) })

        expect(result.current.voiceTriggerKey).toBe("ShiftRight")
        expect(onToggled).toHaveBeenCalledOnce()
    })

    // ── P1 fix: focus gate (checkIsInputActive) ──────────────────────────
    it("does not toggle when checkIsInputActive returns false", () => {
        const onToggled = vi.fn()
        const checkIsInputActive = vi.fn(() => false)
        renderHook(() => useVoiceTriggerKey(onToggled, { checkIsInputActive }))

        act(() => { pressNTimes("ShiftLeft", 7) })

        expect(onToggled).not.toHaveBeenCalled()
    })

    it("toggles when checkIsInputActive returns true", () => {
        const onToggled = vi.fn()
        const checkIsInputActive = vi.fn(() => true)
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled, { checkIsInputActive }))

        act(() => { pressNTimes("ShiftLeft", 7) })

        expect(result.current.voiceTriggerKey).toBe("ShiftRight")
        expect(onToggled).toHaveBeenCalledWith("ShiftRight")
    })

    // ── counter reset conditions ─────────────────────────────────────────
    it("resets counter when gap between presses exceeds 500ms", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => {
            pressNTimes("ShiftLeft", 6, 100)
            vi.advanceTimersByTime(600)       // long pause — counter resets
            fireKeyDown("ShiftLeft")          // restart from 1
        })

        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).not.toHaveBeenCalled()
    })

    it("pressing a non-trigger key resets the counter", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => {
            pressNTimes("ShiftLeft", 5, 100)
            vi.advanceTimersByTime(100)
            fireKeyDown("KeyA")              // resets counter
            pressNTimes("ShiftLeft", 6, 100) // 6 more, not enough for toggle
        })

        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).not.toHaveBeenCalled()
    })

    it("does not toggle when modifier keys are held", () => {
        const onToggled = vi.fn()
        renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => {
            for (let i = 0; i < 7; i++) {
                vi.advanceTimersByTime(100)
                fireKeyDown("ShiftLeft", { metaKey: true })
            }
        })

        expect(onToggled).not.toHaveBeenCalled()
    })

    it("does not toggle on autorepeat (repeat=true) presses", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => {
            for (let i = 0; i < 7; i++) {
                vi.advanceTimersByTime(100)
                fireKeyDown("ShiftLeft", { repeat: true })
            }
        })

        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).not.toHaveBeenCalled()
    })

    it("does not respond to the non-active shift key", () => {
        const onToggled = vi.fn()
        // default is ShiftLeft; pressing ShiftRight 7x should not toggle
        renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => { pressNTimes("ShiftRight", 7) })

        expect(onToggled).not.toHaveBeenCalled()
    })

    // ── double-toggle ────────────────────────────────────────────────────
    it("toggles twice: ShiftLeft → ShiftRight → ShiftLeft", () => {
        const onToggled = vi.fn()
        const { result } = renderHook(() => useVoiceTriggerKey(onToggled))

        act(() => { pressNTimes("ShiftLeft", 7) })
        expect(result.current.voiceTriggerKey).toBe("ShiftRight")

        act(() => {
            vi.advanceTimersByTime(1000) // ensure counter resets between sequences
            pressNTimes("ShiftRight", 7)
        })
        expect(result.current.voiceTriggerKey).toBe("ShiftLeft")
        expect(onToggled).toHaveBeenCalledTimes(2)
    })
})
