import { describe, it, expect } from 'vitest'
import { buildSheetDims, buildSheetMerges, excelSheetName } from './sheetExport.ts'

// P1-1 regression: a legacy V1 (#537) doc wrote dim/merge keys UNPREFIXED (bare `c1`/`r5`,
// bare `sr:sc:er:ec`) and never migrated them. The binding reads bare keys as the 'default' sheet
// on OPEN, so the export path must too — otherwise a V1 doc exported without re-editing loses all
// column widths / row heights / merges (round-trip regression vs V1's own export). These tests lock
// that: the export helpers surface bare keys on 'default', prefixed keys on any sheet, prefixed wins.

describe('buildSheetDims (P1-1 legacy bare-key export)', () => {
  it('emits bare V1 dim keys on the default sheet', () => {
    const dims: Array<[string, number]> = [['c0', 120], ['r3', 40]]
    const { cols, rows } = buildSheetDims('default', dims)
    expect(cols[0]).toEqual({ wpx: 120 })
    expect(rows[3]).toEqual({ hpx: 40 })
  })

  it('emits prefixed V2 dim keys on their own sheet', () => {
    const dims: Array<[string, number]> = [['default:c0', 200], ['s2:c1', 90]]
    expect(buildSheetDims('default', dims).cols[0]).toEqual({ wpx: 200 })
    expect(buildSheetDims('s2', dims).cols[1]).toEqual({ wpx: 90 })
  })

  it('prefixed (edited) value wins over its stale bare legacy twin on default', () => {
    // bare c0=120 (legacy) and prefixed default:c0=200 (edited) both present → edited wins.
    const dims: Array<[string, number]> = [['c0', 120], ['default:c0', 200]]
    expect(buildSheetDims('default', dims).cols[0]).toEqual({ wpx: 200 })
  })

  it('does NOT leak bare keys onto a non-default sheet', () => {
    const dims: Array<[string, number]> = [['c0', 120]]
    const { cols, rows } = buildSheetDims('s2', dims)
    expect(cols.filter(Boolean)).toHaveLength(0)
    expect(rows.filter(Boolean)).toHaveLength(0)
  })

  it('ignores non-positive / non-numeric sizes', () => {
    const dims: Array<[string, number]> = [['c0', 0], ['c1', -5], ['cx', 50]]
    const { cols } = buildSheetDims('default', dims)
    expect(cols.filter(Boolean)).toHaveLength(0)
  })
})

describe('buildSheetMerges (P1-1 legacy bare-key export)', () => {
  it('emits bare V1 merge keys on the default sheet', () => {
    const merges: Array<[string, boolean]> = [['0:0:1:1', true]]
    const out = buildSheetMerges('default', merges)
    expect(out).toEqual([{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }])
  })

  it('emits prefixed V2 merge keys on their own sheet', () => {
    const merges: Array<[string, boolean]> = [['default:0:0:1:1', true], ['s2:2:2:3:3', true]]
    expect(buildSheetMerges('s2', merges)).toEqual([{ s: { r: 2, c: 2 }, e: { r: 3, c: 3 } }])
  })

  it('does not double-emit when a prefixed twin covers the same bare range on default', () => {
    const merges: Array<[string, boolean]> = [['0:0:1:1', true], ['default:0:0:1:1', true]]
    expect(buildSheetMerges('default', merges)).toEqual([{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }])
  })

  it('skips merge keys toggled off', () => {
    const merges: Array<[string, boolean]> = [['0:0:1:1', false]]
    expect(buildSheetMerges('default', merges)).toEqual([])
  })

  it('does NOT leak bare merge keys onto a non-default sheet', () => {
    const merges: Array<[string, boolean]> = [['0:0:1:1', true]]
    expect(buildSheetMerges('s2', merges)).toEqual([])
  })
})

describe('excelSheetName (P2: unique/sanitized names must never exceed 31 chars)', () => {
  it('sanitizes illegal chars and defaults empty to "Sheet"', () => {
    const used = new Set<string>()
    expect(excelSheetName('a[b]c:d*e?f/g\\h', used)).toBe('a b c d e f g h')
    expect(excelSheetName('   ', used)).toBe('Sheet')
    expect(excelSheetName(undefined, used)).toBe('Sheet(2)') // 'Sheet' taken by the previous line
  })

  it('truncates a long name to 31 chars', () => {
    const used = new Set<string>()
    const out = excelSheetName('x'.repeat(50), used)
    expect(out.length).toBe(31)
  })

  it('keeps the collision suffix WITHIN 31 chars even past (10) — the P2 overflow', () => {
    const used = new Set<string>()
    const long = 'y'.repeat(40)
    // Force 11 collisions so the suffix grows to `(12)` (4 chars). The old fixed slice(0,28)
    // produced 28+4 = 32 chars and XLSX.book_append_sheet threw; every result must stay ≤31.
    const names: string[] = []
    for (let k = 0; k < 12; k++) names.push(excelSheetName(long, used))
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31)
    // All unique.
    expect(new Set(names).size).toBe(names.length)
    // The 12th collision carries the `(12)` suffix and is still ≤31.
    expect(names[11]!.endsWith('(12)')).toBe(true)
    expect(names[11]!.length).toBeLessThanOrEqual(31)
  })
})

