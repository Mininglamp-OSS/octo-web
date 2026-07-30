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

  it('never stamps an existing or remotely observed text element', () => {
    const existing = text('old')
    setPendingTextMark(boardA, 'italic', true, [existing])
    const elements = [existing, text('remote'), text('local')]
    const result = applyPendingTextMarksToNewElements(boardA, elements, new Set(['local']))
    expect(result[0].customData).toBeNull()
    expect(result[1].customData).toBeNull()
    expect(result[2].customData).toEqual({ italic: true })
  })
})
