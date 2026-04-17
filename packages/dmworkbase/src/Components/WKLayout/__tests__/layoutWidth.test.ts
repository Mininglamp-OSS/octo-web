/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    SPLITTER_MIN_WIDTH,
    SPLITTER_MAX_WIDTH,
    SPLITTER_DEFAULT_WIDTH,
    SPLITTER_STORAGE_KEY,
    THREAD_MIN_WIDTH,
    THREAD_MAX_WIDTH,
    THREAD_DEFAULT_WIDTH,
    THREAD_STORAGE_KEY,
    getMaxLeftWidth,
    clampWidth,
    restoreWidth,
    persistWidth,
    clampThreadWidth,
    restoreThreadWidth,
    persistThreadWidth,
} from '../layoutWidth'

describe('layoutWidth', () => {
    describe('getMaxLeftWidth', () => {
        it('returns 45% of container when that is below SPLITTER_MAX_WIDTH', () => {
            // 700 * 0.45 = 315
            expect(getMaxLeftWidth(700)).toBe(315)
        })

        it('caps at SPLITTER_MAX_WIDTH for wide containers', () => {
            // 1400 * 0.45 = 630 > 360
            expect(getMaxLeftWidth(1400)).toBe(SPLITTER_MAX_WIDTH)
        })

        it('never goes below SPLITTER_MIN_WIDTH', () => {
            // 300 * 0.45 = 135 < 190
            expect(getMaxLeftWidth(300)).toBe(SPLITTER_MIN_WIDTH)
        })
    })

    describe('clampWidth', () => {
        it('clamps below minimum', () => {
            expect(clampWidth(100, 1200)).toBe(SPLITTER_MIN_WIDTH)
        })

        it('clamps above dynamic maximum', () => {
            // container=700 → max = 315
            expect(clampWidth(500, 700)).toBe(315)
        })

        it('passes through valid values', () => {
            expect(clampWidth(300, 1200)).toBe(300)
        })
    })

    describe('restoreWidth / persistWidth', () => {
        beforeEach(() => {
            localStorage.clear()
        })

        it('returns default when nothing stored', () => {
            expect(restoreWidth()).toBe(SPLITTER_DEFAULT_WIDTH)
        })

        it('restores a previously persisted value', () => {
            persistWidth(300)
            expect(restoreWidth()).toBe(300)
        })

        it('returns default for out-of-range stored values', () => {
            localStorage.setItem(SPLITTER_STORAGE_KEY, '9999')
            expect(restoreWidth()).toBe(SPLITTER_DEFAULT_WIDTH)
        })

        it('returns default for non-numeric stored values', () => {
            localStorage.setItem(SPLITTER_STORAGE_KEY, 'abc')
            expect(restoreWidth()).toBe(SPLITTER_DEFAULT_WIDTH)
        })
    })

    describe('thread panel', () => {
        describe('clampThreadWidth', () => {
            it('clamps below minimum', () => {
                expect(clampThreadWidth(100, 1200)).toBe(THREAD_MIN_WIDTH)
            })

            it('clamps above dynamic maximum', () => {
                // container=900 → 900*0.45=405 < 600
                expect(clampThreadWidth(500, 900)).toBe(405)
            })

            it('caps at THREAD_MAX_WIDTH for wide containers', () => {
                // 1500*0.45=675 > 600
                expect(clampThreadWidth(650, 1500)).toBe(THREAD_MAX_WIDTH)
            })

            it('passes through valid values', () => {
                expect(clampThreadWidth(380, 1200)).toBe(380)
            })
        })

        describe('restoreThreadWidth / persistThreadWidth', () => {
            beforeEach(() => {
                localStorage.clear()
            })

            it('returns default when nothing stored', () => {
                expect(restoreThreadWidth()).toBe(THREAD_DEFAULT_WIDTH)
            })

            it('restores a previously persisted value', () => {
                persistThreadWidth(350)
                expect(restoreThreadWidth()).toBe(350)
            })

            it('returns default for out-of-range stored values', () => {
                localStorage.setItem(THREAD_STORAGE_KEY, '9999')
                expect(restoreThreadWidth()).toBe(THREAD_DEFAULT_WIDTH)
            })
        })
    })
})
