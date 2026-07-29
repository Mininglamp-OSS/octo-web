import { describe, expect, it, vi } from 'vitest'

const bundles = await Promise.all([
  // @ts-expect-error vendored bundle has no standalone declaration file
  import('../../node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js').then((module) => ['dev', module] as const),
  // @ts-expect-error vendored bundle has no standalone declaration file
  import('../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js').then((module) => ['prod', module] as const),
])

const element = {
  text: '',
  originalText: '',
  width: 100,
  autoResize: false,
  fontFamily: 1,
  fontSize: 10,
  lineHeight: 1.2,
  strokeColor: '#111111',
  textAlign: 'left',
  customData: {},
}

describe.each(bundles)('Excalidraw rich text editing proxy (%s)', (_bundle, helpers) => {
  const {
    __octoApplyTextProxyGeometry,
    __octoBindTextProxyComposition,
    __octoDrawTextSelection,
    __octoPointToTextOffset,
    __octoTextLayout,
    setCustomTextMetricsProvider,
  } = helpers
  const installMetrics = () => setCustomTextMetricsProvider({
    getLineWidth(text: string) {
      return Array.from(text).length * 10
    },
    getMetrics(text: string, _font: string, fontSize: number) {
      return { width: Array.from(text).length * fontSize, ascent: fontSize * 0.75, descent: fontSize * 0.25 }
    },
  })

  const insertText = (textarea: HTMLTextAreaElement, text: string, inputType = 'insertText') => {
    const selectionStart = textarea.selectionStart
    const selectionEnd = textarea.selectionEnd
    textarea.value = `${textarea.value.slice(0, selectionStart)}${text}${textarea.value.slice(selectionEnd)}`
    const nextCaret = selectionStart + text.length
    textarea.setSelectionRange(nextCaret, nextCaret)
    textarea.dispatchEvent(new InputEvent('input', { data: text, inputType }))
  }

  const bindSceneUpdatingProxy = (textarea: HTMLTextAreaElement) => {
    const binding = __octoBindTextProxyComposition(textarea, {
      onInput: () => {
        const value = textarea.value
        textarea.value = value
      },
      onEnd: () => {
        const value = textarea.value
        textarea.value = value
      },
    })
    textarea.addEventListener('input', binding.handleInput)
    return {
      cleanup() {
        textarea.removeEventListener('input', binding.handleInput)
        binding.cleanup()
      },
    }
  }

  it('uses a transparent text proxy with one real DOM caret', () => {
    installMetrics()
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    document.body.append(textarea)
    const layout = __octoTextLayout(
      {
        ...element,
        originalText: 'ab',
        customData: { textRuns: [{ start: 1, end: 2, fontSize: 30 }] },
      },
      'ab',
      { maxWidth: 100 },
    )

    const bounds = __octoApplyTextProxyGeometry(textarea, layout, { x: 12, y: 34 }, 2, 0, '#111111')

    expect(bounds).toEqual({ x: 12, y: 34, width: 100, height: 36 })
    expect(textarea.style).toMatchObject({
      left: '12px',
      top: '34px',
      width: '100px',
      height: '36px',
      color: 'transparent',
      overflow: 'visible',
      whiteSpace: 'pre',
    })
    expect(textarea.style.caretColor).toBe('rgb(17, 17, 17)')
    expect(document.querySelector('.octo-text-runs-visual')).toBeNull()
    expect(textarea.textContent).toBe('')
    textarea.remove()
  })

  it('maps a click inside a local large-font grapheme to UTF-16 offset', () => {
    installMetrics()
    const source = 'A👨‍👩‍👧‍👦B'
    const emojiStart = 1
    const emojiEnd = emojiStart + '👨‍👩‍👧‍👦'.length
    const layout = __octoTextLayout(
      {
        ...element,
        originalText: source,
        customData: { textRuns: [{ start: emojiStart, end: emojiEnd, fontSize: 30 }] },
      },
      source,
      { maxWidth: 200 },
    )
    const emoji = layout.lines.flatMap((line: any) => line.clusters).find((cluster: any) => cluster.sourceStart === emojiStart)

    expect(__octoPointToTextOffset(layout, { x: emoji.x + emoji.width * 0.25, y: emoji.y + 1 })).toEqual({ start: emojiStart, end: emojiStart })
    expect(__octoPointToTextOffset(layout, { x: emoji.x + emoji.width * 0.75, y: emoji.y + 1 })).toEqual({ start: emojiEnd, end: emojiEnd })
  })

  it('keeps sequential input ordered from an empty textarea', () => {
    installMetrics()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(0, 0)
    const binding = bindSceneUpdatingProxy(textarea)

    insertText(textarea, '你')
    insertText(textarea, '好')

    expect(textarea.value).toBe('你好')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 2])
    binding.cleanup()
    textarea.remove()
  })

  it('keeps sequential input ordered at the end of existing text', () => {
    installMetrics()
    const textarea = document.createElement('textarea')
    textarea.value = '已有'
    document.body.append(textarea)
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    const binding = bindSceneUpdatingProxy(textarea)

    insertText(textarea, '你')
    insertText(textarea, '好')

    expect(textarea.value).toBe('已有你好')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 4])
    binding.cleanup()
    textarea.remove()
  })

  it('keeps the browser-computed UTF-16 caret after composition and continued input', () => {
    installMetrics()
    const textarea = document.createElement('textarea')
    textarea.value = 'A👨‍👩‍👧‍👦B'
    document.body.append(textarea)
    textarea.focus()
    const insertionPoint = 1 + '👨‍👩‍👧‍👦'.length
    textarea.setSelectionRange(insertionPoint, insertionPoint)
    const onEnd = vi.fn(() => {
      const value = textarea.value
      textarea.value = value
    })
    const binding = __octoBindTextProxyComposition(textarea, { onEnd })
    textarea.addEventListener('input', binding.handleInput)

    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '中' }))
    textarea.value = `${textarea.value.slice(0, insertionPoint)}中${textarea.value.slice(insertionPoint)}`
    textarea.setSelectionRange(insertionPoint + 1, insertionPoint + 1)
    textarea.dispatchEvent(new InputEvent('input', { data: '中', inputType: 'insertCompositionText' }))
    textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中' }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }))

    expect(binding.isComposing()).toBe(false)
    expect(onEnd).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([insertionPoint + 1, insertionPoint + 1])

    insertText(textarea, '文')
    expect(textarea.value).toBe('A👨‍👩‍👧‍👦中文B')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([insertionPoint + 2, insertionPoint + 2])
    textarea.removeEventListener('input', binding.handleInput)
    binding.cleanup()
    textarea.remove()
  })

  it('draws Canvas selection and caret from layout geometry', () => {
    installMetrics()
    const layout = __octoTextLayout({ ...element, originalText: 'ab' }, 'ab', { maxWidth: 100 })
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    }

    __octoDrawTextSelection(context, layout, 0, 1)
    // Selection follows the glyph's own ascent/descent inside the line box, not the tallest
    // line-height rectangle. For a 10px glyph in a 12px line this is y=1, height=10.
    expect(context.fillRect).toHaveBeenCalledWith(0, 1, 10, 10)

    __octoDrawTextSelection(context, layout, 1, 1)
    // The caret follows the adjacent glyph's own ascent/descent inside the mixed-height line.
    expect(context.moveTo).toHaveBeenLastCalledWith(10, 1)
    expect(context.lineTo).toHaveBeenLastCalledWith(10, 11)
    expect(context.stroke).toHaveBeenCalled()
  })
})
