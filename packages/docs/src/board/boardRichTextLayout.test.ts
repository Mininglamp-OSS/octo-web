import { describe, expect, it } from 'vitest'

const bundles = await Promise.all([
  // @ts-expect-error vendored bundle has no standalone declaration file
  import('../../node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js').then((module) => ['dev', module] as const),
  // @ts-expect-error vendored bundle has no standalone declaration file
  import('../../node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js').then((module) => ['prod', module] as const),
])

const baseElement = {
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

const installMetrics = (setCustomTextMetricsProvider: (provider: object) => void) => {
  setCustomTextMetricsProvider({
    getLineWidth(text: string) {
      return Array.from(text).length * 10
    },
    getMetrics(text: string, _font: string, fontSize: number) {
      return {
        width: Array.from(text).length * 10,
        ascent: fontSize * 0.75,
        descent: fontSize * 0.25,
      }
    },
  })
}

describe.each(bundles)('Excalidraw rich text layout (%s)', (_bundle, helpers) => {
  const {
    __octoTextLayout,
    redrawTextBoundingBox,
    refreshTextDimensions,
    setCustomTextMetricsProvider,
  } = helpers
  installMetrics(setCustomTextMetricsProvider)

  it('keeps soft wraps out of UTF-16 source offsets and styles', () => {
    const layout = __octoTextLayout(
      {
        ...baseElement,
        originalText: 'abcd',
        text: 'ab\ncd',
        width: 20,
        customData: { textRuns: [{ start: 2, end: 4, fontSize: 20 }] },
      },
      'abcd',
      { maxWidth: 20 },
    )

    expect(layout.lines.map((line: any) => [line.line, line.sourceStart, line.sourceEnd, line.softBreak])).toEqual([
      ['ab', 0, 2, true],
      ['cd', 2, 4, false],
    ])
    expect(layout.lines[1].clusters[0].style.fontSize).toBe(20)
    expect(layout.displayText).toBe('ab\ncd')
    expect(layout.sourceOffsetToCaret(2)).toMatchObject({ sourceOffset: 2, lineIndex: 0, column: 2 })
  })

  it.each(['👨‍👩‍👧‍👦', 'e\u0301', '👍🏽'])('never splits grapheme %s', (grapheme) => {
    const source = `A${grapheme}B`
    const layout = __octoTextLayout({ ...baseElement, originalText: source, width: 10 }, source, { maxWidth: 10 })

    expect(layout.lines.map((line: any) => line.line)).toEqual(['A', grapheme, 'B'])
    expect(layout.lines[1].clusters).toHaveLength(1)
    expect(layout.lines[1].sourceEnd - layout.lines[1].sourceStart).toBe(grapheme.length)
    for (let offset = 1; offset < 1 + grapheme.length; offset++) {
      expect([1, 1 + grapheme.length]).toContain(layout.snapSourceOffset(offset))
    }
  })

  it('preserves hard breaks and a trailing empty line', () => {
    const layout = __octoTextLayout({ ...baseElement, originalText: 'a\n' }, 'a\n', { maxWidth: 100 })

    expect(layout.lines.map((line: any) => [line.line, line.sourceStart, line.sourceEnd, line.hardBreakEnd, line.hardBreak])).toEqual([
      ['a', 0, 1, 2, true],
      ['', 2, 2, 2, false],
    ])
    expect(layout.sourceOffsetToCaret(2)).toMatchObject({ lineIndex: 1, column: 0 })
  })

  it('merges mixed font metrics into one baseline and full bounds', () => {
    const layout = __octoTextLayout(
      {
        ...baseElement,
        originalText: 'ab',
        customData: { textRuns: [{ start: 1, end: 2, fontSize: 20 }] },
      },
      'ab',
      { maxWidth: 100 },
    )

    expect(layout.lines[0]).toMatchObject({ ascent: 15, descent: 5, height: 24, baseline: 17 })
    expect(layout.lines[0].clusters.map((cluster: any) => cluster.style.fontSize)).toEqual([10, 20])
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 100, height: 24 })
  })

  it('uses the actual bound-text width while preserving the container wrap limit', () => {
    const source = 'abc'
    const element = {
      ...baseElement,
      id: 'short-bound-label',
      text: source,
      originalText: source,
      width: 100,
      height: 12,
      autoResize: true,
      containerId: 'container',
    } as any
    const container = {
      id: 'container',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 200,
      height: 20,
      angle: 0,
      points: [[0, 0], [200, 0]],
      boundElements: [{ type: 'text', id: element.id }],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
      isDeleted: false,
    } as any
    const elementsMap = new Map([[element.id, element], [container.id, container]]) as any

    const layout = __octoTextLayout(element, source, { maxWidth: 140 })
    expect(layout.contentWidth).toBe(30)
    expect(layout.bounds.width).toBe(30)

    redrawTextBoundingBox(element, container, elementsMap, false)
    expect(element.width).toBe(30)
    expect(element.width).toBeLessThan(140)
  })

  it('refreshes newly typed arrow text to its real width and centered position immediately', () => {
    const source = '风沙大风沙大'
    const element = {
      ...baseElement,
      id: 'new-arrow-label',
      text: '',
      originalText: '',
      width: 400,
      height: 12,
      autoResize: true,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: 'arrow',
    } as any
    const arrow = {
      id: 'arrow', type: 'arrow', x: 0, y: 0, width: 400, height: 0, angle: 0,
      points: [[0, 0], [400, 0]], boundElements: [{ type: 'text', id: element.id }],
      startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', isDeleted: false,
    } as any
    const elementsMap = new Map([[element.id, element], [arrow.id, arrow]]) as any

    const refreshed = refreshTextDimensions(element, arrow, elementsMap, source)
    expect(refreshed.width).toBe(60)
    expect(refreshed.x).toBe(170)
    expect(refreshed.y).toBe(-17)
    expect(refreshed.y + refreshed.height).toBe(-5)
    expect(refreshed.width).toBeLessThan(element.width)

    const downwardV = {
      ...arrow,
      height: 100,
      points: [[0, 0], [200, 100], [400, 0]],
    } as any
    const downwardMap = new Map([[element.id, element], [downwardV.id, downwardV]]) as any
    const belowVertex = refreshTextDimensions(element, downwardV, downwardMap, source)
    expect(belowVertex.x).toBe(170)
    expect(belowVertex.y).toBe(105)
    expect(belowVertex.y).toBeGreaterThan(100)

    const symmetricS = {
      ...arrow,
      width: 200,
      height: 100,
      points: [[0, 100], [100, 100], [100, 0], [200, 0]],
    } as any
    const symmetricMap = new Map([[element.id, element], [symmetricS.id, symmetricS]]) as any
    const besideVerticalSegment = refreshTextDimensions(element, symmetricS, symmetricMap, source)
    expect(besideVerticalSegment.x + besideVerticalSegment.width).toBe(95)
    expect(besideVerticalSegment.y).toBe(44)
  })

  it('wraps enlarged bound text and keeps the complete glyph height visible', () => {
    setCustomTextMetricsProvider({
      getLineWidth(text: string, _font: string, fontSize: number) {
        return Array.from(text).length * fontSize
      },
      getMetrics(text: string, _font: string, fontSize: number) {
        return { width: Array.from(text).length * fontSize, ascent: fontSize * 0.8, descent: fontSize * 0.2 }
      },
    })
    try {
      const source = '放大文字'
      const element = {
        ...baseElement,
        id: 'large-bound-label',
        text: source,
        originalText: source,
        width: 60,
        height: 12,
        fontSize: 40,
        autoResize: true,
        containerId: 'container',
      } as any
      const container = {
        id: 'container', type: 'rectangle', x: 0, y: 0, width: 70, height: 30, angle: 0,
        boundElements: [{ type: 'text', id: element.id }], isDeleted: false,
      } as any
      const elementsMap = new Map([[element.id, element], [container.id, container]]) as any

      redrawTextBoundingBox(element, container, elementsMap, false)
      expect(element.width).toBe(40)
      expect(element.height).toBe(192)
      expect(container.height).toBeGreaterThanOrEqual(element.height)

      const renderLayout = __octoTextLayout(element)
      expect(renderLayout.displayText.split('\n')).toHaveLength(4)
      expect(renderLayout.lines).toHaveLength(4)
      expect(renderLayout.bounds).toMatchObject({ width: element.width, height: element.height })
    } finally {
      installMetrics(setCustomTextMetricsProvider)
    }
  })

  it('auto-resizes a mixed rich-text long line to its full content bounds', () => {
    const source = '混合字体字号 long line 12345'
    const element = {
      ...baseElement,
      id: 'mixed-long-line',
      text: source,
      originalText: source,
      width: 12,
      height: 12,
      autoResize: true,
      customData: {
        textRuns: [
          { start: 0, end: 4, fontSize: 24 },
          { start: 5, end: 9, fontFamily: 2006, fontSize: 18 },
        ],
      },
    } as any
    const elementsMap = new Map([[element.id, element]]) as any

    const layout = __octoTextLayout(element, source, { maxWidth: Infinity })
    expect(layout.lines).toHaveLength(1)
    expect(layout.bounds.width).toBe(Array.from(source).length * 10)
    expect(layout.bounds.height).toBeCloseTo(28.8)

    redrawTextBoundingBox(element, null, elementsMap, false)
    expect(element.width).toBe(layout.bounds.width)
    expect(element.height).toBeCloseTo(layout.bounds.height)
  })

  it('refreshes the whole auto-resize box from local mixed typography', () => {
    setCustomTextMetricsProvider({
      getLineWidth(text: string, _font: string) {
        return Array.from(text).length * 10
      },
      getMetrics(text: string, _font: string, fontSize: number) {
        return { width: Array.from(text).length * fontSize, ascent: fontSize * 0.75, descent: fontSize * 0.25 }
      },
    })
    try {
      const source = '范德萨大风沙'
      const element = {
        ...baseElement,
        id: 'mixed-auto-resize',
        text: source,
        originalText: source,
        width: 60,
        height: 12,
        autoResize: true,
        customData: { textRuns: [{ start: 2, end: 4, fontSize: 40 }] },
      } as any
      const elementsMap = new Map([[element.id, element]]) as any

      const expected = __octoTextLayout(element, source, { maxWidth: Infinity })
      const refreshed = refreshTextDimensions(element, null, elementsMap, source)

      expect(refreshed.width).toBe(expected.bounds.width)
      expect(refreshed.height).toBe(expected.bounds.height)
      expect(refreshed.width).toBeGreaterThan(element.width)
      expect(refreshed.height).toBeGreaterThan(element.height)
    } finally {
      installMetrics(setCustomTextMetricsProvider)
    }
  })

  it('grows the line box to the tallest glyph so a large local run is not clipped after commit', () => {
    // A CJK face reports a large descent. When a local large-font run's real glyph height
    // (ascent + descent) exceeds `lineHeight * fontSize`, the committed bounding box must take the
    // glyph height — otherwise the element height shrinks on exit-edit and clips the glyph bottom.
    // This is exactly what redrawTextBoundingBox reads back from the layout (metrics.height).
    setCustomTextMetricsProvider({
      getLineWidth(text: string) {
        return Array.from(text).length * 10
      },
      getMetrics(text: string, _font: string, fontSize: number) {
        // descent 0.5em is deliberately large: 40 * (0.95 + 0.5) = 58 > 40 * 1.2 = 48.
        return { width: Array.from(text).length * 10, ascent: fontSize * 0.95, descent: fontSize * 0.5 }
      },
    })
    try {
      const element = {
        ...baseElement,
        originalText: '中文',
        fontSize: 10,
        lineHeight: 1.2,
        customData: { textRuns: [{ start: 0, end: 2, fontSize: 40 }] },
      }
      const layout = __octoTextLayout(element, '中文', { maxWidth: 1000 })

      // Line box = the glyph's natural height (58), NOT lineHeight * fontSize (48).
      expect(layout.lines[0]).toMatchObject({ ascent: 38, descent: 20, height: 58, baseline: 38 })
      expect(layout.bounds.height).toBe(58)
      // The baseline leaves the full descent below it, so the glyph bottom is inside the box.
      expect(layout.lines[0].height - layout.lines[0].baseline).toBeGreaterThanOrEqual(20)

      // Re-measuring the identical committed element is byte-stable — repeated edit→commit cycles
      // must not let the height drift upward.
      const reflowed = __octoTextLayout(element, '中文', { maxWidth: 1000 })
      expect(reflowed.bounds.height).toBe(layout.bounds.height)
      expect(reflowed.lines[0].baseline).toBe(layout.lines[0].baseline)
    } finally {
      // Restore the suite-wide provider so later tests keep their expected metrics.
      installMetrics(setCustomTextMetricsProvider)
    }
  })

  it('commits runs-based mixed typography without clipping or edit-cycle drift', () => {
    setCustomTextMetricsProvider({
      getLineWidth(text: string) {
        return Array.from(text).length * 10
      },
      getMetrics(text: string, _font: string, fontSize: number) {
        return { width: Array.from(text).length * 10, ascent: fontSize * 0.95, descent: fontSize * 0.5 }
      },
    })
    try {
      const element = {
        ...baseElement,
        id: 'committed-text',
        text: '中文 Ab',
        originalText: '中文 Ab',
        width: 10,
        height: 10,
        autoResize: true,
        customData: {
          textRuns: [
            { start: 0, end: 2, fontSize: 40, fontWeight: 700 },
            { start: 3, end: 5, fontSize: 28, fontStyle: 'italic', fontFamily: 'serif' },
          ],
        },
      } as any
      const elementsMap = new Map([[element.id, element]]) as any

      redrawTextBoundingBox(element, null, elementsMap, false)
      const committedHeight = element.height
      expect(committedHeight).toBe(58)

      redrawTextBoundingBox(element, null, elementsMap, false)
      expect(element.height).toBe(committedHeight)
    } finally {
      installMetrics(setCustomTextMetricsProvider)
    }
  })

  it.each([
    ['left', 0],
    ['center', 40],
    ['right', 80],
  ])('positions %s aligned lines and hit boundaries', (textAlign, x) => {
    const layout = __octoTextLayout({ ...baseElement, originalText: 'ab', textAlign }, 'ab', { maxWidth: 100 })
    expect(layout.lines[0].x).toBe(x)
    expect(layout.scenePointToSourceOffset({ x: x - 1, y: 1 })).toBe(0)
    expect(layout.scenePointToSourceOffset({ x: x + 4, y: 1 })).toBe(0)
    expect(layout.scenePointToSourceOffset({ x: x + 6, y: 1 })).toBe(1)
    expect(layout.scenePointToSourceOffset({ x: x + 100, y: 1 })).toBe(2)
  })

  it('round trips every grapheme boundary through caret geometry', () => {
    const source = 'A👨‍👩‍👧‍👦e\u0301\nB'
    const layout = __octoTextLayout({ ...baseElement, originalText: source }, source, { maxWidth: 30 })

    for (const offset of layout.boundaries.filter((offset: number) => source[offset - 1] !== '\n')) {
      const caret = layout.sourceOffsetToCaret(offset)
      const roundTrip = layout.scenePointToSourceOffset({ x: caret.x, y: caret.top + caret.height / 2 })
      expect(layout.snapSourceOffset(roundTrip)).toBe(layout.snapSourceOffset(offset))
    }
  })

  it('uses each selected glyph metrics instead of the tallest line box', () => {
    setCustomTextMetricsProvider({
      getLineWidth(text: string) { return Array.from(text).length * 10 },
      getMetrics(text: string, _font: string, fontSize: number) {
        return { width: Array.from(text).length * 10, ascent: fontSize * 0.75, descent: fontSize * 0.25 }
      },
    })
    try {
      const source = '小大字'
      const layout = __octoTextLayout({
        ...baseElement, originalText: source, autoResize: true,
        customData: { textRuns: [{ start: 1, end: 2, fontSize: 40 }] },
      }, source, { maxWidth: Infinity })

      const rects = layout.selectionRects(0, source.length)
      expect(rects).toHaveLength(3)
      expect(rects.map((rect: any) => rect.height)).toEqual([17.5, 40, 17.5])
      expect(rects[0].y).toBeGreaterThan(rects[1].y)
      expect(new Set(rects.map((rect: any) => rect.y + rect.height)).size).toBe(1)
    } finally {
      installMetrics(setCustomTextMetricsProvider)
    }
  })

  it('builds selection rectangles only on grapheme boundaries', () => {
    const source = 'A👨‍👩‍👧‍👦B'
    const layout = __octoTextLayout({ ...baseElement, originalText: source }, source, { maxWidth: 100 })
    const rects = layout.selectionRects(2, 5)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject({ sourceStart: 1, sourceEnd: 1 + '👨‍👩‍👧‍👦'.length })
  })
})
