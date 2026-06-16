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
    SUMMARY_MIN_WIDTH,
    SUMMARY_MAX_WIDTH,
    SUMMARY_DEFAULT_WIDTH,
    SUMMARY_STORAGE_KEY,
    getMaxLeftWidth,
    clampWidth,
    restoreWidth,
    persistWidth,
    clampThreadWidth,
    restoreThreadWidth,
    persistThreadWidth,
    clampSummaryWidth,
    restoreSummaryWidth,
    persistSummaryWidth,
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
                expect(clampThreadWidth(100, 1200, 300)).toBe(THREAD_MIN_WIDTH)
            })

            it('limits to 50% of available space (window - left panel)', () => {
                // window=1920, left=300 → available=1620 → max=810
                expect(clampThreadWidth(1000, 1920, 300)).toBe(810)
            })

            it('ensures chat area gets at least 50% of available space', () => {
                // window=1600, left=280 → available=1320 → max=660
                expect(clampThreadWidth(900, 1600, 280)).toBe(660)
            })

            it('caps at THREAD_MAX_WIDTH even if 50% would be higher', () => {
                // window=4000, left=300 → available=3700 → 50%=1850 > 1600
                expect(clampThreadWidth(1700, 4000, 300)).toBe(THREAD_MAX_WIDTH)
            })

            it('passes through valid values', () => {
                expect(clampThreadWidth(500, 1600, 300)).toBe(500)
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
                persistThreadWidth(500)
                expect(restoreThreadWidth()).toBe(500)
            })

            it('returns default for out-of-range stored values', () => {
                localStorage.setItem(THREAD_STORAGE_KEY, '9999')
                expect(restoreThreadWidth()).toBe(THREAD_DEFAULT_WIDTH)
            })
        })
    })

    describe('summary panel', () => {
        describe('clampSummaryWidth', () => {
            it('clamps below minimum', () => {
                expect(clampSummaryWidth(100, 1200, 300)).toBe(SUMMARY_MIN_WIDTH)
            })

            it('passes through valid values', () => {
                expect(clampSummaryWidth(500, 1600, 300)).toBe(500)
            })

            it('caps at SUMMARY_MAX_WIDTH even if 50% would be higher', () => {
                // window=4000, left=300 → available=3700 → 50%=1850 > 720
                expect(clampSummaryWidth(1000, 4000, 300)).toBe(SUMMARY_MAX_WIDTH)
            })

            it('limits to 50% of available space (window - left panel)', () => {
                // window=1200, left=300 → available=900 → max=450
                expect(clampSummaryWidth(700, 1200, 300)).toBe(450)
            })

            it('never goes below SUMMARY_MIN_WIDTH even on tiny screens', () => {
                // window=600, left=300 → available=300 → 50%=150 < 320
                expect(clampSummaryWidth(400, 600, 300)).toBe(SUMMARY_MIN_WIDTH)
            })
        })

        describe('restoreSummaryWidth / persistSummaryWidth', () => {
            beforeEach(() => {
                localStorage.clear()
            })

            it('returns default when nothing stored', () => {
                expect(restoreSummaryWidth()).toBe(SUMMARY_DEFAULT_WIDTH)
            })

            it('restores a previously persisted value', () => {
                persistSummaryWidth(500)
                expect(restoreSummaryWidth()).toBe(500)
            })

            it('returns default for out-of-range stored values', () => {
                localStorage.setItem(SUMMARY_STORAGE_KEY, '9999')
                expect(restoreSummaryWidth()).toBe(SUMMARY_DEFAULT_WIDTH)
            })

            it('does not collide with the thread panel storage key', () => {
                persistSummaryWidth(500)
                persistThreadWidth(700)
                expect(restoreSummaryWidth()).toBe(500)
                expect(restoreThreadWidth()).toBe(700)
            })
        })
    })
})
