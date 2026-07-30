import {
  OCTO_NATIVE_SHAPE_KINDS,
  getOctoNativeShapeBounds,
  getOctoNativeShapeElementProps,
  getOctoNativeShapePoints,
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
    ['inverted-triangle', [[0, 0], [100, 0], [50, 80]]],
    ['parallelogram', [[20, 0], [100, 0], [80, 80], [0, 80]]],
  ] as const)('provides executable renderer geometry and hit testing for %s', (nativeShapeKind, expectedPoints) => {
    expect(getOctoNativeShapePoints(nativeShapeKind, 100, 80)).toEqual(expectedPoints)
    expect(getOctoNativeShapeBounds(nativeShapeKind, 100, 80, 10, 20)).toEqual([10, 20, 110, 100])
    expect(isPointInOctoNativeShape(nativeShapeKind, 100, 80, 50, 40)).toBe(true)
    expect(isPointInOctoNativeShape(nativeShapeKind, 100, 80, -1, -1)).toBe(false)

    const resized = getOctoNativeShapePoints(nativeShapeKind, 200, 40)
    expect(resized).not.toEqual(expectedPoints)
    expect(getOctoNativeShapeBounds(nativeShapeKind, 200, 40)).toEqual([0, 0, 200, 40])
  })

  it('defines merged shape/line primaries, flyouts, new slots, and read-only behavior', () => {
    const editable = getOctoToolbarContract(false)
    expect(editable).toMatchObject({
      canCreate: true,
      shapePrimary: 'rectangle',
      linePrimary: 'arrow',
    })
    expect(editable.shapeFlyout).toEqual([
      'rectangle',
      'rounded-rectangle',
      'diamond',
      'ellipse',
      'triangle',
      'inverted-triangle',
      'parallelogram',
    ])
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
