import {
  OCTO_NATIVE_SHAPE_KINDS,
  getOctoNativeShapeBounds,
  getOctoNativeShapeElementProps,
  getOctoNativeShapePath,
  getOctoNativeShapePoints,
  getOctoNativeShapeStrokePaths,
  getOctoToolbarContract,
  isPointInOctoNativeShape,
} from '@excalidraw/excalidraw/octo-native-shapes'
import { describe, expect, it } from 'vitest'

const canvasContext = new Proxy(
  {
    filter: 'none',
    measureText: (text: string) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
    }),
  },
  {
    get: (target, property) => Reflect.get(target, property) ?? (() => undefined),
  },
)

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => canvasContext,
})

const { convertToExcalidrawElements, restoreElements, serializeAsJSON } = await import(
  '@excalidraw/excalidraw'
)

describe('patched Excalidraw native shape contract', () => {
  it.each(OCTO_NATIVE_SHAPE_KINDS)('creates and round-trips %s as a rectangle subtype', (nativeShapeKind) => {
    const props = getOctoNativeShapeElementProps(nativeShapeKind)
    expect(props).not.toBeNull()
    if (!props) throw new Error(`missing native shape props for ${nativeShapeKind}`)
    expect(props).toEqual({
      type: 'rectangle',
      roundness: null,
      customData: { nativeShapeKind },
    })
    expect(props?.type).not.toBe('line')

    const [element] = convertToExcalidrawElements([
      {
        id: `native-${nativeShapeKind}`,
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        type: props.type,
        customData: props.customData,
      },
    ])
    const json = serializeAsJSON([element], { activeTool: { type: 'selection' } } as never, {}, 'local')
    const restored = restoreElements(JSON.parse(json).elements, null)

    expect(restored).toHaveLength(1)
    expect(restored[0].type).toBe('rectangle')
    expect(restored[0].customData).toEqual({ nativeShapeKind })
  })

  it.each([
    ['triangle', [[50, 0], [100, 80], [0, 80]]],
    ['right-triangle', [[0, 0], [100, 80], [0, 80]]],
    ['parallelogram', [[20, 0], [100, 0], [80, 80], [0, 80]]],
    ['trapezoid', [[20, 0], [80, 0], [100, 80], [0, 80]]],
    ['right-arrow', [[0, 24], [65, 24], [65, 0], [100, 40], [65, 80], [65, 56], [0, 56]]],
  ] as const)('provides executable renderer geometry and hit testing for %s', (nativeShapeKind, expectedPoints) => {
    expect(getOctoNativeShapePoints(nativeShapeKind, 100, 80)).toEqual(expectedPoints)
    expect(getOctoNativeShapeBounds(nativeShapeKind, 100, 80, 10, 20)).toEqual([10, 20, 110, 100])
    expect(isPointInOctoNativeShape(nativeShapeKind, 100, 80, 50, 41)).toBe(true)
    expect(isPointInOctoNativeShape(nativeShapeKind, 100, 80, -1, -1)).toBe(false)

    const resized = getOctoNativeShapePoints(nativeShapeKind, 200, 40)
    expect(resized).not.toEqual(expectedPoints)
    expect(getOctoNativeShapeBounds(nativeShapeKind, 200, 40)).toEqual([0, 0, 200, 40])
  })

  it('keeps square on the standard rectangle renderer without throwing', () => {
    expect(() => getOctoNativeShapePath('square', 100, 80)).not.toThrow()
    expect(getOctoNativeShapePath('square', 100, 80)).toBeNull()
    expect(getOctoNativeShapePoints('square', 100, 80)).toBeNull()
  })

  it('uses a visibly deep curved rim for the cylinder and true curves for both speech bubbles', () => {
    expect(getOctoNativeShapePath('database', 100, 80)).toBe(
      'M 0 16 C 0 0, 100 0, 100 16 L 100 64 C 100 80, 0 80, 0 64 Z',
    )
    expect(getOctoNativeShapeStrokePaths('database', 100, 80)).toEqual([
      'M 0 16 C 0 32, 100 32, 100 16',
    ])
    expect(getOctoNativeShapePath('database', 100, 80, { databaseRimRatio: 0.4 })).toBe(
      'M 0 32 C 0 0, 100 0, 100 32 L 100 48 C 100 80, 0 80, 0 48 Z',
    )
    expect(getOctoNativeShapeStrokePaths('database', 100, 80, { databaseRimRatio: 0.06 })).toEqual([
      'M 0 4.8 C 0 9.6, 100 9.6, 100 4.8',
    ])
    const narrowCylinderPoints = getOctoNativeShapePoints('database', 10, 100, 0, 0, { databaseRimRatio: 0.4 })
    expect(narrowCylinderPoints?.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))])).toEqual([
      [0, 3.6], [0.4, 1.62], [2.2, 0.36], [5, 0], [7.8, 0.36], [9.6, 1.62], [10, 3.6],
      [10, 96.4], [9.6, 98.38], [7.8, 99.64], [5, 100], [2.2, 99.64], [0.4, 98.38], [0, 96.4],
    ])
    expect(getOctoNativeShapePath('speech-bubble', 100, 80)).toContain('C')
    const roundedBubblePath = getOctoNativeShapePath('speech-bubble-rounded', 100, 80)
    expect(roundedBubblePath).toContain('Q')
    expect(roundedBubblePath).toContain('L 50 80')
    expect(getOctoNativeShapePath('notched-dovetail', 100, 80)).toBeNull()
    expect(getOctoNativeShapePoints('inverted-triangle', 100, 80)).toEqual([
      [0, 0], [100, 0], [50, 80],
    ])
    expect(getOctoNativeShapeBounds('inverted-triangle', 100, 80)).toEqual([0, 0, 100, 80])
    expect(isPointInOctoNativeShape('inverted-triangle', 100, 80, 50, 60)).toBe(true)
    expect(getOctoNativeShapePoints('database', 0, 0)?.flat().every(Number.isFinite)).toBe(true)
    expect(getOctoNativeShapeBounds('database', 0, 0)?.every(Number.isFinite)).toBe(true)
    expect(getOctoNativeShapePath('chevron', 100, 80)).toBeNull()
  })

  it('centers the rounded speech bubble tail on the bottom edge', () => {
    const points = getOctoNativeShapePoints('speech-bubble-rounded', 100, 80)
    expect(points).toHaveLength(11)
    expect(points?.[6]).toEqual([50, 80])
    expect(points?.[5]?.[0]).toBeCloseTo(58)
    expect(points?.[7]?.[0]).toBeCloseTo(42)
    expect(points?.[5]?.[1]).toBe(64)
    expect(points?.[7]?.[1]).toBe(64)
    expect(isPointInOctoNativeShape('speech-bubble-rounded', 100, 80, 50, 72)).toBe(true)
    expect(isPointInOctoNativeShape('speech-bubble-rounded', 100, 80, 25, 76)).toBe(false)
  })

  it('provides bounded, hittable geometry for every native preset', () => {
    expect(OCTO_NATIVE_SHAPE_KINDS).toHaveLength(19)
    for (const nativeShapeKind of OCTO_NATIVE_SHAPE_KINDS) {
      const points = getOctoNativeShapePoints(nativeShapeKind, 100, 80)
      if (nativeShapeKind === 'square') {
        // Square deliberately delegates geometry, bounds, and hit testing to Excalidraw's standard
        // rectangle renderer instead of maintaining a second native-shape implementation.
        expect(points).toBeNull()
        expect(getOctoNativeShapeBounds(nativeShapeKind, 100, 80)).toBeNull()
        continue
      }
      expect(points?.length).toBeGreaterThanOrEqual(3)
      const bounds = getOctoNativeShapeBounds(nativeShapeKind, 100, 80)
      expect(bounds).not.toBeNull()
      expect(bounds?.[0]).toBeGreaterThanOrEqual(0)
      expect(bounds?.[1]).toBeGreaterThanOrEqual(0)
      expect(bounds?.[2]).toBeLessThanOrEqual(100)
      expect(bounds?.[3]).toBeLessThanOrEqual(80)
      expect(isPointInOctoNativeShape(nativeShapeKind, 100, 80, 50, 41)).toBe(true)
    }
  })

  it('defines merged shape/line primaries, flyouts, new slots, and read-only behavior', () => {
    const editable = getOctoToolbarContract(false)
    expect(editable).toMatchObject({
      canCreate: true,
      shapePrimary: 'rectangle',
      linePrimary: 'arrow',
    })
    expect(editable.shapeFlyout).toEqual([
      'rounded-rectangle',
      'ellipse',
      'diamond',
      'square',
      'circle',
      'triangle',
      'parallelogram',
      'database',
      'notched-dovetail',
      'chevron',
      'trapezoid',
      'speech-bubble',
      'speech-bubble-rounded',
      'right-triangle',
      'star',
      'hexagon',
      'pentagon',
      'octagon',
      'left-arrow',
      'right-arrow',
      'bidirectional-arrow',
    ])
    expect(editable.shapeFlyout).toHaveLength(21)
    expect(editable.lineFlyout).toEqual([
      'curved-arrow',
      'elbow-arrow',
      'straight-arrow',
      'straight-line',
    ])

    expect(getOctoToolbarContract(true)).toEqual({
      canCreate: false,
      shapePrimary: null,
      linePrimary: null,
      shapeFlyout: [],
      lineFlyout: [],
    })
  })
})
