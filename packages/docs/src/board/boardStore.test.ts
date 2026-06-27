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
})
