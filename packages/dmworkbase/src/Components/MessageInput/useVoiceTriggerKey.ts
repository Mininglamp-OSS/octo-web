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

export interface UseVoiceTriggerKeyReturn {
    /** 当前激活的语音触发键，"ShiftLeft" 或 "ShiftRight" */
    voiceTriggerKey: VoiceTriggerKey
}

/**
 * 管理语音输入触发键（ShiftLeft ↔ ShiftRight）。
 *
 * 切换手势：连续快速按目标键 7 次（相邻两次 keydown 间隔 < 500ms）。
 * - 当前为 ShiftLeft  → 连按左 Shift 7 次 → 切换为 ShiftRight
 * - 当前为 ShiftRight → 连按右 Shift 7 次 → 切换为 ShiftLeft
 *
 * 状态持久化到 localStorage（key: octo_voice_trigger_key）。
 * 切换后通过回调通知调用方以便显示 Toast。
 */
export default function useVoiceTriggerKey(
    onToggled: (newKey: VoiceTriggerKey) => void
): UseVoiceTriggerKeyReturn {
    const [voiceTriggerKey, setVoiceTriggerKey] = useState<VoiceTriggerKey>(readStoredKey)

    const voiceTriggerKeyRef = useRef(voiceTriggerKey)
    voiceTriggerKeyRef.current = voiceTriggerKey

    const onToggledRef = useRef(onToggled)
    onToggledRef.current = onToggled

    // Rapid-press counter state
    const pressCountRef = useRef(0)
    const lastPressTimeRef = useRef(0)

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const currentKey = voiceTriggerKeyRef.current
        // Only track the current trigger key (no modifiers)
        if (
            e.code !== currentKey ||
            e.repeat ||
            e.metaKey ||
            e.ctrlKey ||
            e.altKey
        ) {
            // Any other key resets the counter
            if (e.code !== currentKey) {
                pressCountRef.current = 0
            }
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
            const newKey: VoiceTriggerKey =
                currentKey === "ShiftLeft" ? "ShiftRight" : "ShiftLeft"
            writeStoredKey(newKey)
            setVoiceTriggerKey(newKey)
            onToggledRef.current(newKey)
        }
    }, [])

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [handleKeyDown])

    return { voiceTriggerKey }
}
