// DiffView — the unified-diff MARKUP (grouping/numbering itself is covered by diffHunks.test.ts).
//
// What is pinned here is what a reader actually sees, plus the two compatibility guarantees the
// rewrite had to preserve: the `.octo-version-diff` / `.octo-diff-added` / `.octo-diff-removed` /
// `.octo-diff-unchanged` selectors the version-panel tests and the Playwright driver depend on, and
// `renderEntryAction`'s contract (real changes only, correct ORIGINAL index, zero DOM when omitted).
//
// `t` is the identity mock (src/__mocks__/octoBase.ts), so assertions use literal i18n keys.

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { DiffEntry } from './diff.ts'
import { DiffView } from './DiffView.tsx'

const un = (text: string): DiffEntry => ({ type: 'unchanged', text })
const add = (text: string): DiffEntry => ({ type: 'added', text })
const rem = (text: string): DiffEntry => ({ type: 'removed', text })
const chg = (before: string, after: string): DiffEntry => ({ type: 'changed', before, after })

afterEach(() => cleanup())

describe('DiffView — empty / sentinel states', () => {
  it('renders the too-large notice, never a diff box', () => {
    render(<DiffView diff={[{ type: 'too-large' }]} />)
    expect(document.querySelector('.octo-version-empty')?.textContent).toBe('docs.version.tooLarge')
    expect(document.querySelector('.octo-version-diff')).toBeNull()
  })

  it('renders the no-changes notice when every entry is unchanged', () => {
    render(<DiffView diff={[un('a'), un('b')]} />)
    expect(document.querySelector('.octo-version-empty')?.textContent).toBe('docs.version.noChanges')
    expect(document.querySelector('.octo-version-diff')).toBeNull()
  })
})

describe('DiffView — unified layout', () => {
  it('keeps the legacy container + row selectors so existing consumers still match', () => {
    render(<DiffView diff={[un('ctx'), chg('before text', 'after text')]} />)
    // The version panel's test and run-botdiff.mjs both select these.
    expect(document.querySelector('.octo-version-diff')).toBeTruthy()
    expect(document.querySelector('.octo-diff-removed')?.textContent).toContain('before text')
    expect(document.querySelector('.octo-diff-added')?.textContent).toContain('after text')
    expect(document.querySelector('.octo-diff-unchanged')?.textContent).toContain('ctx')
  })

  it('renders one hunk card per changed region, each with a @@ header and a status badge', () => {
    render(<DiffView diff={[chg('a', 'A'), un('x'), un('y'), un('z'), chg('b', 'B')]} />)
    expect(document.querySelectorAll('.octo-diff-hunk').length).toBe(2)
    const locs = [...document.querySelectorAll('.octo-diff-hunk-loc')].map((e) => e.textContent)
    expect(locs[0]).toContain('@@')
    expect(locs[0]).toContain('docs.botDiff.hunkLabel')
    expect(document.querySelectorAll('.octo-diff-hunk-status').length).toBe(2)
  })

  it('gives every row four cells: old №, new №, marker, text', () => {
    render(<DiffView diff={[un('ctx'), rem('gone')]} />)
    const removed = document.querySelector('.octo-diff-removed') as HTMLElement
    expect(removed.querySelectorAll('.octo-diff-num').length).toBe(2)
    expect(removed.querySelector('.octo-diff-marker')?.textContent).toBe('−')
    expect(removed.querySelector('.octo-diff-text')?.textContent).toBe('gone')
    // A deletion has no AFTER line number: the second cell is blank, not a repeat of the first.
    const nums = [...removed.querySelectorAll('.octo-diff-num')].map((n) => n.textContent)
    expect(nums).toEqual(['2', ''])
  })

  it('marks an insertion with + and leaves the BEFORE number blank', () => {
    render(<DiffView diff={[un('ctx'), add('fresh')]} />)
    const added = document.querySelector('.octo-diff-added') as HTMLElement
    expect(added.querySelector('.octo-diff-marker')?.textContent).toBe('+')
    expect([...added.querySelectorAll('.octo-diff-num')].map((n) => n.textContent)).toEqual(['', '2'])
  })

  it('names a pure insertion / pure deletion in the hunk status', () => {
    render(<DiffView diff={[un('c'), add('one')]} />)
    expect(document.querySelector('.octo-diff-hunk-status')?.textContent).toBe(
      'docs.botDiff.statusAdded',
    )
    cleanup()
    render(<DiffView diff={[un('c'), rem('one')]} />)
    expect(document.querySelector('.octo-diff-hunk-status')?.textContent).toBe(
      'docs.botDiff.statusRemoved',
    )
  })

  it('summarises the change count once, above the hunks', () => {
    render(<DiffView diff={[rem('a'), add('b'), un('x'), un('y'), un('z'), chg('c', 'C')]} />)
    expect(document.querySelectorAll('.octo-diff-count').length).toBe(1)
    expect(document.querySelector('.octo-diff-count')?.textContent).toBe('docs.botDiff.changeCount')
  })
})

describe('DiffView — renderEntryAction contract', () => {
  it('emits ZERO extra DOM when the hook is omitted', () => {
    render(<DiffView diff={[chg('a', 'A')]} />)
    expect(document.querySelector('.octo-diff-hunk-actions')).toBeNull()
  })

  it('is never called for context rows or for the too-large sentinel', () => {
    const seen: DiffEntry[] = []
    render(<DiffView diff={[un('ctx'), chg('a', 'A'), un('tail')]} renderEntryAction={(e) => { seen.push(e); return null }} />)
    expect(seen.map((e) => e.type)).toEqual(['changed'])

    cleanup()
    seen.length = 0
    render(<DiffView diff={[{ type: 'too-large' }]} renderEntryAction={(e) => { seen.push(e); return null }} />)
    expect(seen).toEqual([])
  })

  it('passes the index into the ORIGINAL diff array, not the row or hunk position', () => {
    const calls: Array<[string, number]> = []
    const diff = [un('a'), un('b'), chg('c', 'C'), un('d'), un('e'), un('f'), add('g')]
    render(
      <DiffView
        diff={diff}
        renderEntryAction={(e, i) => {
          calls.push([e.type, i])
          return <span className="mock-action" />
        }}
      />,
    )
    // chg sits at index 2 and add at index 6 of `diff` — the hook must report those, not 0 and 1.
    expect(calls).toEqual([
      ['changed', 2],
      ['added', 6],
    ])
    // One action rendered per changed ENTRY (the changed pair counts once), inside its own hunk.
    expect(document.querySelectorAll('.mock-action').length).toBe(2)
    expect(document.querySelectorAll('.octo-diff-hunk-actions').length).toBe(2)
  })

  it('attaches one action per changed entry when several share a hunk', () => {
    const calls: number[] = []
    render(
      <DiffView
        diff={[rem('a'), add('b'), chg('c', 'C')]}
        renderEntryAction={(_e, i) => {
          calls.push(i)
          return <span className="mock-action" />
        }}
      />,
    )
    expect(calls).toEqual([0, 1, 2])
    expect(document.querySelectorAll('.octo-diff-hunk').length).toBe(1)
    expect(document.querySelectorAll('.mock-action').length).toBe(3)
  })
})
