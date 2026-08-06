import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  BoardDatabaseRimControl,
  DATABASE_RIM_RATIO_DEFAULT,
  DATABASE_RIM_RATIO_MAX,
  DATABASE_RIM_RATIO_MIN,
  databaseRimDepth,
  databaseRimHandleScenePoint,
  databaseRimRatioFromScenePoint,
  readDatabaseRimRatio,
} from '../BoardDatabaseRimControl.tsx'

type DatabaseElementFixture = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  version: number
  versionNonce: number
  isDeleted: boolean
  locked: boolean
  customData: {
    nativeShapeKind: string
    databaseRimRatio?: number
  }
}

const databaseElement = (overrides: Partial<DatabaseElementFixture> = {}): DatabaseElementFixture => ({
  id: 'database-1',
  type: 'rectangle',
  x: 100,
  y: 80,
  width: 120,
  height: 100,
  angle: 0,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  locked: false,
  customData: { nativeShapeKind: 'database' },
  ...overrides,
})

describe('BoardDatabaseRimControl geometry', () => {
  it('uses the default and clamps each per-element ratio to the safe range', () => {
    expect(readDatabaseRimRatio(databaseElement())).toBe(DATABASE_RIM_RATIO_DEFAULT)
    expect(readDatabaseRimRatio(databaseElement({ customData: { nativeShapeKind: 'database', databaseRimRatio: -1 } }))).toBe(DATABASE_RIM_RATIO_MIN)
    expect(readDatabaseRimRatio(databaseElement({ customData: { nativeShapeKind: 'database', databaseRimRatio: 1 } }))).toBe(DATABASE_RIM_RATIO_MAX)
  })

  it('places and drags the handle in element-local space after rotation', () => {
    const element = databaseElement({ angle: Math.PI / 2 })
    const handle = databaseRimHandleScenePoint(element as never)
    expect(handle.x).toBeCloseTo(175)
    expect(handle.y).toBeCloseTo(130)
    expect(databaseRimRatioFromScenePoint(element as never, handle)).toBeCloseTo(DATABASE_RIM_RATIO_DEFAULT)
  })

  it('keeps degenerate inverse geometry finite', () => {
    const element = databaseElement({ width: 0, height: 0 })
    const handle = databaseRimHandleScenePoint(element as never)
    expect(Number.isFinite(handle.x)).toBe(true)
    expect(Number.isFinite(handle.y)).toBe(true)
    expect(databaseRimRatioFromScenePoint(element as never, handle)).toBe(DATABASE_RIM_RATIO_DEFAULT)
  })

  it('uses the renderer width cap for tall narrow cylinders', () => {
    const element = databaseElement({ width: 50, height: 100 })
    expect(databaseRimDepth(element)).toBe(9)
    const handle = databaseRimHandleScenePoint(element as never)
    expect(handle).toEqual({ x: 125, y: 95.75 })
    expect(databaseRimRatioFromScenePoint(element as never, handle)).toBeCloseTo(DATABASE_RIM_RATIO_DEFAULT)
  })
})

function setupControl(initialRatio?: number) {
  let element = databaseElement(initialRatio === undefined
    ? {}
    : { customData: { nativeShapeKind: 'database', databaseRimRatio: initialRatio } })
  let listener: (() => void) | undefined
  const updateScene = vi.fn((update: { elements?: readonly typeof element[] }) => {
    element = update.elements?.find((candidate) => candidate.id === element.id) ?? element
    listener?.()
  })
  const api = {
    getAppState: () => ({
      viewModeEnabled: false,
      activeTool: { type: 'selection' },
      selectedElementIds: { [element.id]: true },
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    }),
    getSceneElements: () => [element],
    getSceneElementsIncludingDeleted: () => [element],
    updateScene,
    onChange: (callback: () => void) => {
      listener = callback
      return () => { listener = undefined }
    },
  } as unknown as ExcalidrawImperativeAPI
  const root = document.createElement('div')
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, toJSON: () => ({}),
  })
  document.body.append(root)
  const view = render(<BoardDatabaseRimControl excalidrawAPI={api} readOnly={false} rootRef={{ current: root }} />)
  const start = (pointerId = 7, clientY = 115) => fireEvent.pointerDown(screen.getByRole('slider', { name: 'docs.board.databaseRimHandleLabel' }), {
    pointerId,
    clientX: 160,
    clientY,
  })
  const moveTo = (clientY: number) => act(() => window.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 7,
    clientX: 160,
    clientY,
  })))
  const move = () => moveTo(141.25)
  return { api, getElement: () => element, root, start, move, moveTo, updateScene, ...view }
}

describe('BoardDatabaseRimControl interaction', () => {
  it('shows only for a single editable database and commits a stamped customData update', () => {
    const control = setupControl()
    control.start()
    control.move()
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 160, clientY: 141.25 })))

    expect(control.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'EVENTUALLY' }))
    expect(control.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
    expect(control.getElement().customData).toMatchObject({ nativeShapeKind: 'database', databaseRimRatio: 0.35 })
    expect(control.getElement().version).toBeGreaterThan(1)
    control.unmount()
    control.root.remove()
  })

  it('finalizes a cancelled drag at its latest ratio with an immediate history boundary', () => {
    const control = setupControl()
    control.start()
    control.move()
    expect(control.getElement().customData).toMatchObject({ databaseRimRatio: 0.35 })

    act(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 })))

    expect(control.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
    expect(control.getElement().customData).toMatchObject({ databaseRimRatio: 0.35 })
    expect(document.body.classList.contains('octo-board-database-rim-dragging')).toBe(false)
    control.unmount()
    control.root.remove()
  })

  it('cleans up an existing drag before a second pointer starts', () => {
    const control = setupControl()
    control.start(7)
    control.move()
    control.start(8)
    const callsAfterRestart = control.updateScene.mock.calls.length

    act(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 160, clientY: 130 })))
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 160, clientY: 130 })))

    expect(control.updateScene).toHaveBeenCalledTimes(callsAfterRestart)
    act(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 8 })))
    control.unmount()
    control.root.remove()
  })

  it('does not create a history update when the handle is clicked off-centre without moving', () => {
    const control = setupControl()
    control.start(7, 122)
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 160, clientY: 122 })))
    expect(control.updateScene).not.toHaveBeenCalled()
    control.unmount()
    control.root.remove()
  })

  it.each([
    { initialRatio: DATABASE_RIM_RATIO_MIN, pointerY: 85, centerY: 90.5, expectedAtCenter: 0.091 },
    { initialRatio: DATABASE_RIM_RATIO_MAX, pointerY: 155, centerY: 150, expectedAtCenter: 0.371 },
  ])('keeps off-centre dragging responsive at the $initialRatio boundary', ({ initialRatio, pointerY, centerY, expectedAtCenter }) => {
    const control = setupControl(initialRatio)
    control.start(7, pointerY)
    control.moveTo(centerY)
    expect(control.getElement().customData.databaseRimRatio).toBeCloseTo(expectedAtCenter, 2)
    act(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 })))
    control.unmount()
    control.root.remove()
  })

  it('supports keyboard adjustment with one immediate update', () => {
    const control = setupControl()
    const handle = screen.getByRole('slider', { name: 'docs.board.databaseRimHandleLabel' })
    expect(handle.getAttribute('aria-valuetext')).toBe('20%')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(control.updateScene).toHaveBeenCalledTimes(1)
    expect(control.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
    expect(control.getElement().customData.databaseRimRatio).toBeCloseTo(0.21)
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    control.unmount()
    control.root.remove()
  })

  it('accumulates keyboard steps from the live scene before the RAF refresh', () => {
    const control = setupControl()
    const handle = screen.getByRole('slider', { name: 'docs.board.databaseRimHandleLabel' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(control.getElement().customData.databaseRimRatio).toBeCloseTo(0.22)
    expect(control.updateScene).toHaveBeenCalledTimes(2)
    control.unmount()
    control.root.remove()
  })

  it('cancels an active drag without committing after permissions become read-only', () => {
    const control = setupControl()
    control.start()
    control.move()
    const callsBeforeDowngrade = control.updateScene.mock.calls.length

    control.rerender(<BoardDatabaseRimControl excalidrawAPI={control.api} readOnly rootRef={{ current: control.root }} />)
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 160, clientY: 150 })))
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 160, clientY: 150 })))

    expect(control.updateScene).toHaveBeenCalledTimes(callsBeforeDowngrade)
    expect(document.body.classList.contains('octo-board-database-rim-dragging')).toBe(false)
    control.unmount()
    control.root.remove()
  })

  it('removes window drag listeners on unmount and cannot mutate the old API afterwards', () => {
    const control = setupControl()
    control.start()
    control.move()
    control.unmount()
    const callsAfterCleanup = control.updateScene.mock.calls.length

    act(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 160, clientY: 130 })))
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 160, clientY: 130 })))

    expect(control.updateScene).toHaveBeenCalledTimes(callsAfterCleanup)
    expect(control.getElement().customData).toMatchObject({ databaseRimRatio: 0.35 })
    expect(document.body.classList.contains('octo-board-database-rim-dragging')).toBe(false)
    control.root.remove()
  })
})
