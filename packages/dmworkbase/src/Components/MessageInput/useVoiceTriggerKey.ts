import { useState, useEffect, useRef, useCallback } from "react"

export type VoiceTriggerKey = "ShiftLeft" | "ShiftRight"

const STORAGE_KEY = "octo_voice_trigger_key"
const TOGGLE_COUNT = 7
const TOGGLE_INTERVAL_MS = 500

function readStoredKey(): VoiceTriggerKey {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === "ShiftLeft" || stored === "ShiftRight") return stored
    } catch {
        // ignore
    }
    return "ShiftLeft"
}

function writeStoredKey(key: VoiceTriggerKey): void {
    try {
        localStorage.setItem(STORAGE_KEY, key)
    } catch {
        // ignore
    }
}

export interface UseVoiceTriggerKeyOptions {
    /**
     * If provided, the toggle gesture is only active when this returns true.
     * Should match the caller's own focus-gate (e.g. checkIsInputActive).
     * When omitted the gesture is active whenever isVoiceEnabled is true.
     */
    checkIsInputActive?: () => boolean
    /**
     * When false (voice feature disabled for this mount), the toggle listener
     * is not registered.  Defaults to true so callers that don't use the flag
     * are unaffected.
     */
    isVoiceEnabled?: boolean
}

export interface UseVoiceTriggerKeyReturn {
    /** 当前激活的语音触发键，"ShiftLeft" 或 "ShiftRight" */
    voiceTriggerKey: VoiceTriggerKey
}

/**
 * 管理语音输入触发键（ShiftLeft ↔ ShiftRight）。
 *
 * 切换手势：连续快速按目标键 7 次（相邻两次 keydown 间隔 < 500ms，
 * 不持有任何 modifier 键）。
 * - 当前为 ShiftLeft  → 连按左 Shift 7 次 → 切换为 ShiftRight
 * - 当前为 ShiftRight → 连按右 Shift 7 次 → 切换为 ShiftLeft
 *
 * 状态持久化到 localStorage（key: octo_voice_trigger_key）。
 * 切换后通过回调通知调用方以便显示 Toast。
 *
 * P1 fixes (yujiawei review):
 * 1. On the completing (7th) keydown the event is stopped via
 *    stopImmediatePropagation() so the long-press recording handler never
 *    arms shiftTimerRef — no phantom recording.
 * 2. Toggle listener respects the caller's focus gate (checkIsInputActive)
 *    and isVoiceEnabled flag, mirroring the recording handler's scope.
 */
export default function useVoiceTriggerKey(
    onToggled: (newKey: VoiceTriggerKey) => void,
    options: UseVoiceTriggerKeyOptions = {}
): UseVoiceTriggerKeyReturn {
    const { checkIsInputActive, isVoiceEnabled = true } = options

    const [voiceTriggerKey, setVoiceTriggerKey] = useState<VoiceTriggerKey>(readStoredKey)

    const voiceTriggerKeyRef = useRef(voiceTriggerKey)
    voiceTriggerKeyRef.current = voiceTriggerKey

    const onToggledRef = useRef(onToggled)
    onToggledRef.current = onToggled

    const checkIsInputActiveRef = useRef(checkIsInputActive)
    checkIsInputActiveRef.current = checkIsInputActive

    // Rapid-press counter state
    const pressCountRef = useRef(0)
    const lastPressTimeRef = useRef(0)

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const currentKey = voiceTriggerKeyRef.current

        // Only track the current trigger key (no modifiers, no autorepeat)
        if (
            e.code !== currentKey ||
            e.repeat ||
            e.metaKey ||
            e.ctrlKey ||
            e.altKey
        ) {
            // Any non-trigger key resets the toggle counter
            if (e.code !== currentKey) {
                pressCountRef.current = 0
            }
            return
        }

        // Focus gate — mirror the recording handler's scope
        const checkFn = checkIsInputActiveRef.current
        if (checkFn && !checkFn()) {
            pressCountRef.current = 0
            return
        }

        const now = Date.now()
        const gap = now - lastPressTimeRef.current

        if (gap <= TOGGLE_INTERVAL_MS) {
            pressCountRef.current += 1
        } else {
            // Too slow — restart the sequence
            pressCountRef.current = 1
        }
        lastPressTimeRef.current = now

        if (pressCountRef.current >= TOGGLE_COUNT) {
            pressCountRef.current = 0
            lastPressTimeRef.current = 0

            // ── P1 fix ──────────────────────────────────────────────────────
            // Stop the completing keydown from reaching the long-press handler.
            // Without this, shiftTimerRef is armed on the 7th press and then
            // the matching keyup is ignored (the key ref has already flipped),
            // causing a phantom recording ~500 ms later.
            e.stopImmediatePropagation()
            e.preventDefault()
            // ────────────────────────────────────────────────────────────────

            const newKey: VoiceTriggerKey =
                currentKey === "ShiftLeft" ? "ShiftRight" : "ShiftLeft"
            writeStoredKey(newKey)
            setVoiceTriggerKey(newKey)
            onToggledRef.current(newKey)
        }
    }, [])

    useEffect(() => {
        if (!isVoiceEnabled) return
        // Register with capture=true so we run before the recording handler
        // and stopImmediatePropagation() on the completing press is effective.
        window.addEventListener("keydown", handleKeyDown, true)
        return () => window.removeEventListener("keydown", handleKeyDown, true)
    }, [isVoiceEnabled, handleKeyDown])

    return { voiceTriggerKey }
}
