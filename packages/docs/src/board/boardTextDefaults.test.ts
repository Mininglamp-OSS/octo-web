import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyPendingTextMarksToNewElements,
  readPendingTextMarks,
  resetPendingTextDefaults,
  setPendingTextMark,
} from './boardTextDefaults.ts'

const boardA = 'board-a'
const boardB = 'board-b'
const text = (id: string) => ({
  id,
  type: 'text',
  version: 1,
  versionNonce: 1,
  customData: null,
})

beforeEach(() => {
  resetPendingTextDefaults(boardA)
  resetPendingTextDefaults(boardB)
})

describe('board text defaults', () => {
  it('isolates pending marks per board and resets them on teardown', () => {
    setPendingTextMark(boardA, 'bold', true, [])
    expect(readPendingTextMarks(boardA)).toEqual({ bold: true })
    expect(readPendingTextMarks(boardB)).toEqual({})

    const created = applyPendingTextMarksToNewElements(boardA, [text('a1')], new Set(['a1']))
    expect(created[0].customData).toEqual({ bold: true })
    const otherBoard = applyPendingTextMarksToNewElements(boardB, [text('b1')], new Set(['b1']))
    expect(otherBoard[0].customData).toBeNull()

    resetPendingTextDefaults(boardA)
    expect(readPendingTextMarks(boardA)).toEqual({})
  })

  it('does not treat a first-observed selected paste or duplicate as fresh text', () => {
    setPendingTextMark(boardA, 'bold', true, [])
    const copied = { ...text('copy'), customData: { italic: true } }
    const pastedScene = [copied]

    const observed = applyPendingTextMarksToNewElements(boardA, pastedScene, new Set())
    expect(observed).toBe(pastedScene)
    expect(observed[0].customData).toEqual({ italic: true })
    expect(observed[0].version).toBe(copied.version)
  })

  it('never stamps an existing or remotely observed text element', () => {
    const existing = text('old')
    const remote = text('remote')
    const local = text('local')
    setPendingTextMark(boardA, 'italic', true, [existing])

    const firstObservation = applyPendingTextMarksToNewElements(
      boardA,
      [existing, remote, local],
      new Set(['local']),
    )
    expect(firstObservation[0].customData).toBeNull()
    expect(firstObservation[1].customData).toBeNull()
    expect(firstObservation[2].customData).toEqual({ italic: true })

    const remoteVersion = firstObservation[1].version
    const afterSelectAll = applyPendingTextMarksToNewElements(
      boardA,
      firstObservation,
      new Set(['old', 'remote', 'local']),
    )
    expect(afterSelectAll[1].customData).toBeNull()
    expect(afterSelectAll[1].version).toBe(remoteVersion)
  })
})
