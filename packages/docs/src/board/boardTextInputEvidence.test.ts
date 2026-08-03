import { describe, expect, it, vi } from 'vitest'
import { installBoardTextInputEvidence } from './boardTextInputEvidence.ts'

describe('board text input evidence', () => {
  it('captures beforeinput/input details without changing trailing whitespace or the caret', () => {
    const root = document.createElement('div')
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = 'text '
    textarea.setSelectionRange(5, 5)
    root.appendChild(textarea)
    const report = vi.fn()
    const dispose = installBoardTextInputEvidence(root, report)

    textarea.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      inputType: 'insertText',
      data: ' ',
      isComposing: false,
    }))
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: ' ',
      isComposing: false,
    }))

    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[0][0]).toMatchObject({
      phase: 'beforeinput', inputType: 'insertText', data: ' ', selectionStart: 5,
      selectionEnd: 5, isComposing: false, trailingCodePoints: [116, 101, 120, 116, 32],
    })
    expect(textarea.value).toBe('text ')
    expect(textarea.selectionStart).toBe(5)
    dispose()
  })

  it('ignores unrelated inputs', () => {
    const root = document.createElement('div')
    const input = document.createElement('input')
    root.appendChild(input)
    const report = vi.fn()
    const dispose = installBoardTextInputEvidence(root, report)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }))
    expect(report).not.toHaveBeenCalled()
    dispose()
  })
})
