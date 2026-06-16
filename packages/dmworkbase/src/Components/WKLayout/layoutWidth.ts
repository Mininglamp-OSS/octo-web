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
export const THREAD_MAX_WIDTH = 1600  // effective max is clamped by screen ratio
export const THREAD_DEFAULT_WIDTH = 432
export const THREAD_STORAGE_KEY = 'wk-thread-panel-width'

// ── Right panel (smart summary panel) ──
// Independent constants + storage key so the summary panel width never
// collides with the thread panel's (THREAD_MIN_WIDTH=432 > summary default 360).
export const SUMMARY_MIN_WIDTH = 320
export const SUMMARY_MAX_WIDTH = 720
export const SUMMARY_DEFAULT_WIDTH = 360
export const SUMMARY_STORAGE_KEY = 'wk-summary-panel-width'

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

/**
 * Thread panel max width based on available space (window - left panel).
 * Ensures chat area has at least 50% of available space.
 * 
 * @param windowWidth - Total window width
 * @param leftPanelWidth - Left conversation list width (default 300px)
 * @returns Maximum allowed thread panel width
 */
export function getMaxThreadWidth(windowWidth: number, leftPanelWidth = SPLITTER_DEFAULT_WIDTH): number {
    const availableSpace = windowWidth - leftPanelWidth
    // Thread can take at most 50% of available space, ensuring chat area gets at least 50%
    const dynamicMax = Math.floor(availableSpace * 0.5)
    return Math.max(THREAD_MIN_WIDTH, Math.min(THREAD_MAX_WIDTH, dynamicMax))
}

export function clampThreadWidth(width: number, windowWidth: number, leftPanelWidth = SPLITTER_DEFAULT_WIDTH): number {
    const max = getMaxThreadWidth(windowWidth, leftPanelWidth)
    return Math.max(THREAD_MIN_WIDTH, Math.min(max, width))
}

export function restoreThreadWidth(): number {
    return restoreStoredWidth(THREAD_STORAGE_KEY, THREAD_MIN_WIDTH, THREAD_MAX_WIDTH, THREAD_DEFAULT_WIDTH)
}

export function persistThreadWidth(width: number): void {
    persistStoredWidth(THREAD_STORAGE_KEY, width)
}

// ── Right (summary) panel helpers ──

/**
 * Summary panel max width based on available space (window - left panel).
 * Like the thread panel, the chat area keeps at least 50% of available space.
 *
 * @param windowWidth - Total window width
 * @param leftPanelWidth - Left conversation list width (default 300px)
 * @returns Maximum allowed summary panel width
 */
export function getMaxSummaryWidth(windowWidth: number, leftPanelWidth = SPLITTER_DEFAULT_WIDTH): number {
    const availableSpace = windowWidth - leftPanelWidth
    const dynamicMax = Math.floor(availableSpace * 0.5)
    return Math.max(SUMMARY_MIN_WIDTH, Math.min(SUMMARY_MAX_WIDTH, dynamicMax))
}

export function clampSummaryWidth(width: number, windowWidth: number, leftPanelWidth = SPLITTER_DEFAULT_WIDTH): number {
    const max = getMaxSummaryWidth(windowWidth, leftPanelWidth)
    return Math.max(SUMMARY_MIN_WIDTH, Math.min(max, width))
}

export function restoreSummaryWidth(): number {
    return restoreStoredWidth(SUMMARY_STORAGE_KEY, SUMMARY_MIN_WIDTH, SUMMARY_MAX_WIDTH, SUMMARY_DEFAULT_WIDTH)
}

export function persistSummaryWidth(width: number): void {
    persistStoredWidth(SUMMARY_STORAGE_KEY, width)
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
