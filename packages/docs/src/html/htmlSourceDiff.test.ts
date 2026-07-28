import { describe, it, expect } from 'vitest'
import { diffLines, diffChars, toLines } from './htmlSourceDiff.ts'

describe('diffLines', () => {
  it('marks unchanged lines equal with aligned old/new line numbers', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc')
    expect(rows.every((r) => r.op === 'equal')).toBe(true)
    expect(rows[0]).toMatchObject({ oldLine: 1, newLine: 1 })
    expect(rows[2]).toMatchObject({ oldLine: 3, newLine: 3 })
  })

  it('emits add rows for inserted lines', () => {
    const rows = diffLines('a\nc', 'a\nb\nc')
    const add = rows.find((r) => r.op === 'add')
    expect(add).toMatchObject({ op: 'add', newText: 'b', newLine: 2 })
    expect(add?.oldLine).toBeUndefined()
  })

  it('emits remove rows for deleted lines', () => {
    const rows = diffLines('a\nb\nc', 'a\nc')
    const rem = rows.find((r) => r.op === 'remove')
    expect(rem).toMatchObject({ op: 'remove', oldText: 'b' })
    expect(rem?.newLine).toBeUndefined()
  })

  it('pairs a remove+add into a single replace row for the side-by-side view', () => {
    const rows = diffLines('hello world', 'hello there')
    const rep = rows.find((r) => r.op === 'replace')
    expect(rep).toBeTruthy()
    expect(rep).toMatchObject({ oldText: 'hello world', newText: 'hello there', oldLine: 1, newLine: 1 })
  })

  it('normalises CRLF', () => {
    expect(toLines('a\r\nb')).toEqual(['a', 'b'])
  })
})

describe('diffChars', () => {
  it('emphasizes only the differing characters on each side', () => {
    const r = diffChars('abc', 'axc')
    // old: a(=) b(≠) c(=)
    expect(r.old.map((s) => [s.same, s.text])).toEqual([
      [true, 'a'],
      [false, 'b'],
      [true, 'c'],
    ])
    expect(r.new.map((s) => [s.same, s.text])).toEqual([
      [true, 'a'],
      [false, 'x'],
      [true, 'c'],
    ])
  })

  it('handles pure insertion (all new chars are changed)', () => {
    const r = diffChars('ab', 'abc')
    expect(r.new.some((s) => !s.same && s.text === 'c')).toBe(true)
    expect(r.old.every((s) => s.same)).toBe(true)
  })
})
