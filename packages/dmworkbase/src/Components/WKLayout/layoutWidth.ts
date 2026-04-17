/**
 * Layout width utilities for the draggable splitter.
 *
 * Extracted so the clamping / persist logic can be unit-tested
 * without mounting the full WKLayout component.
 */

// ── Shared constants ──
export const SMALL_SCREEN_WIDTH = 640

// ── Left panel (conversation list) ──
export const SPLITTER_MIN_WIDTH = 190
export const SPLITTER_MAX_WIDTH = 360
export const SPLITTER_DEFAULT_WIDTH = 300
export const SPLITTER_STORAGE_KEY = 'wk-layout-left-width'

// ── Right panel (thread panel) ──
export const THREAD_MIN_WIDTH = 432
export const THREAD_MAX_WIDTH = 811
export const THREAD_DEFAULT_WIDTH = 432
export const THREAD_STORAGE_KEY = 'wk-thread-panel-width'

/**
 * Generic clamp utility: min(maxWidth, containerWidth * ratio), floored to minWidth.
 */
export function getMaxWidth(containerWidth: number, minWidth: number, maxWidth: number, ratio = 0.45): number {
    const dynamicMax = Math.floor(containerWidth * ratio)
    return Math.max(minWidth, Math.min(maxWidth, dynamicMax))
}

export function clampWidth(width: number, containerWidth: number, minWidth = SPLITTER_MIN_WIDTH, maxWidth = SPLITTER_MAX_WIDTH, ratio = 0.45): number {
    const max = getMaxWidth(containerWidth, minWidth, maxWidth, ratio)
    return Math.max(minWidth, Math.min(max, width))
}

// ── Left panel helpers (backward compat) ──

export function getMaxLeftWidth(containerWidth: number): number {
    return getMaxWidth(containerWidth, SPLITTER_MIN_WIDTH, SPLITTER_MAX_WIDTH)
}

export function restoreWidth(): number {
    return restoreStoredWidth(SPLITTER_STORAGE_KEY, SPLITTER_MIN_WIDTH, SPLITTER_MAX_WIDTH, SPLITTER_DEFAULT_WIDTH)
}

export function persistWidth(width: number): void {
    persistStoredWidth(SPLITTER_STORAGE_KEY, width)
}

// ── Right (thread) panel helpers ──

export function getMaxThreadWidth(containerWidth: number): number {
    return getMaxWidth(containerWidth, THREAD_MIN_WIDTH, THREAD_MAX_WIDTH, 0.65)
}

export function clampThreadWidth(width: number, containerWidth: number): number {
    return clampWidth(width, containerWidth, THREAD_MIN_WIDTH, THREAD_MAX_WIDTH, 0.65)
}

export function restoreThreadWidth(): number {
    return restoreStoredWidth(THREAD_STORAGE_KEY, THREAD_MIN_WIDTH, THREAD_MAX_WIDTH, THREAD_DEFAULT_WIDTH)
}

export function persistThreadWidth(width: number): void {
    persistStoredWidth(THREAD_STORAGE_KEY, width)
}

// ── Shared localStorage helpers ──

function restoreStoredWidth(key: string, min: number, max: number, defaultVal: number): number {
    try {
        const stored = localStorage.getItem(key)
        if (stored) {
            const parsed = parseInt(stored, 10)
            if (!isNaN(parsed) && parsed >= min && parsed <= max) {
                return parsed
            }
        }
    } catch (_) {}
    return defaultVal
}

function persistStoredWidth(key: string, width: number): void {
    try {
        localStorage.setItem(key, String(width))
    } catch (_) {}
}
