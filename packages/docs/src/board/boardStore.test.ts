import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadBoardScene,
  persistBoardScene,
  clearBoardScene,
  rememberBoard,
  forgetBoard,
  isBoardIdLocally,
  isBoardDoc,
} from './boardStore.ts'

describe('boardStore — scene persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips elements and files', () => {
    const elements = [{ id: 'a', type: 'rectangle' }]
    const files = { f1: { mimeType: 'image/png' } }
    expect(persistBoardScene('b1', { elements, files })).toBe(true)
    const loaded = loadBoardScene('b1')
    expect(loaded?.elements).toEqual(elements)
    expect(loaded?.files).toEqual(files)
  })

  it('persists only the whitelisted appState keys (drops transient/non-JSON state)', () => {
    persistBoardScene('b1', {
      elements: [],
      appState: {
        viewBackgroundColor: '#ffffff',
        // transient fields that must NOT be fed back via initialData:
        collaborators: new Map(),
        selectedElementIds: { a: true },
        cursorButton: 'up',
      } as unknown as Record<string, unknown>,
    })
    const loaded = loadBoardScene('b1')
    expect(loaded?.appState).toEqual({ viewBackgroundColor: '#ffffff' })
    expect(loaded?.appState).not.toHaveProperty('collaborators')
    expect(loaded?.appState).not.toHaveProperty('selectedElementIds')
  })

  it('returns null for an absent or malformed scene', () => {
    expect(loadBoardScene('missing')).toBeNull()
    window.localStorage.setItem('octo.board.scene.bad', '{not json')
    expect(loadBoardScene('bad')).toBeNull()
    // present but without an elements array → treated as malformed
    window.localStorage.setItem('octo.board.scene.x', JSON.stringify({ foo: 1 }))
    expect(loadBoardScene('x')).toBeNull()
  })

  it('clearBoardScene removes a persisted scene', () => {
    persistBoardScene('b1', { elements: [{ id: 'a' }] })
    expect(loadBoardScene('b1')).not.toBeNull()
    clearBoardScene('b1')
    expect(loadBoardScene('b1')).toBeNull()
  })

  // P1-1: the mirror is uid-scoped so a shared browser never exposes one user's board to the next.
  it('isolates scenes by uid — one user never reads another user\'s board', () => {
    persistBoardScene('b1', { elements: [{ id: 'alice' }] }, 'u_alice')
    persistBoardScene('b1', { elements: [{ id: 'bob' }] }, 'u_bob')
    // Same docId, different uid → independent stores.
    expect(loadBoardScene('b1', 'u_alice')?.elements).toEqual([{ id: 'alice' }])
    expect(loadBoardScene('b1', 'u_bob')?.elements).toEqual([{ id: 'bob' }])
    // A different (or absent) uid must NOT see Alice's board.
    expect(loadBoardScene('b1', 'u_carol')).toBeNull()
    expect(loadBoardScene('b1')).toBeNull()
  })

  it('clearBoardScene for one uid does not drop another uid\'s scene', () => {
    persistBoardScene('b1', { elements: [{ id: 'alice' }] }, 'u_alice')
    persistBoardScene('b1', { elements: [{ id: 'bob' }] }, 'u_bob')
    clearBoardScene('b1', 'u_alice')
    expect(loadBoardScene('b1', 'u_alice')).toBeNull()
    expect(loadBoardScene('b1', 'u_bob')?.elements).toEqual([{ id: 'bob' }])
  })

  it('the anonymous (no-uid) namespace is distinct from a real uid', () => {
    persistBoardScene('b1', { elements: [{ id: 'anon' }] })
    expect(loadBoardScene('b1')?.elements).toEqual([{ id: 'anon' }])
    expect(loadBoardScene('b1', 'u_alice')).toBeNull()
  })
})

describe('boardStore — board-kind registry', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('remembers and forgets board ids', () => {
    expect(isBoardIdLocally('b1')).toBe(false)
    rememberBoard('b1')
    expect(isBoardIdLocally('b1')).toBe(true)
    // idempotent
    rememberBoard('b1')
    expect(isBoardIdLocally('b1')).toBe(true)
    forgetBoard('b1')
    expect(isBoardIdLocally('b1')).toBe(false)
  })

  it('isBoardDoc trusts explicit docType, then falls back to the registry', () => {
    // explicit wins, regardless of the registry
    expect(isBoardDoc({ docId: 'x', docType: 'board' })).toBe(true)
    rememberBoard('x')
    expect(isBoardDoc({ docId: 'x', docType: 'doc' })).toBe(false)
    // no docType → registry decides
    expect(isBoardDoc({ docId: 'x' })).toBe(true)
    expect(isBoardDoc({ docId: 'y' })).toBe(false)
  })

  // P2: the registry is uid-scoped so a shared browser never leaks which docIds are boards across
  // users (mirrors the uid-scoped scene mirror). Alice remembering a board must not surface it for
  // Bob or for the anonymous namespace.
  it('isolates the board-kind registry by uid', () => {
    rememberBoard('b1', 'alice')
    expect(isBoardIdLocally('b1', 'alice')).toBe(true)
    // A different user — and the anonymous namespace — must NOT see Alice's board.
    expect(isBoardIdLocally('b1', 'bob')).toBe(false)
    expect(isBoardIdLocally('b1')).toBe(false)
    expect(isBoardDoc({ docId: 'b1' }, 'bob')).toBe(false)
    expect(isBoardDoc({ docId: 'b1' }, 'alice')).toBe(true)
    // Forgetting under one uid does not touch another uid's registry.
    rememberBoard('b1', 'bob')
    forgetBoard('b1', 'alice')
    expect(isBoardIdLocally('b1', 'alice')).toBe(false)
    expect(isBoardIdLocally('b1', 'bob')).toBe(true)
  })
})
