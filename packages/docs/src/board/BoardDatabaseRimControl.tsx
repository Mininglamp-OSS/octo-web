import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { t } from '../octoweb/index.ts'
import { bumpElementStamp } from './boardElementBump.ts'

export const DATABASE_RIM_RATIO_DEFAULT = 0.2
export const DATABASE_RIM_RATIO_MIN = 0.06
export const DATABASE_RIM_RATIO_MAX = 0.4

interface DatabaseElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  version?: number
  versionNonce?: number
  isDeleted?: boolean
  locked?: boolean
  customData?: Record<string, unknown> & {
    nativeShapeKind?: unknown
    databaseRimRatio?: unknown
  }
  [key: string]: unknown
}

type ViewportState = ReturnType<ExcalidrawImperativeAPI['getAppState']>

interface ControlSnapshot {
  element: DatabaseElement
  state: ViewportState
}

interface DragState {
  pointerId: number
  elementId: string
  initialRatio: number
  latestRatio: number
  pointerOffsetRatio: number
}

interface DragListeners {
  move: (event: PointerEvent) => void
  finish: (event: PointerEvent) => void
  cancel: (event: PointerEvent) => void
}

export function clampDatabaseRimRatio(value: number): number {
  if (!Number.isFinite(value)) return DATABASE_RIM_RATIO_DEFAULT
  return Math.min(DATABASE_RIM_RATIO_MAX, Math.max(DATABASE_RIM_RATIO_MIN, value))
}

export function readDatabaseRimRatio(element: Pick<DatabaseElement, 'customData'>): number {
  const value = element.customData?.databaseRimRatio
  return clampDatabaseRimRatio(typeof value === 'number' ? value : DATABASE_RIM_RATIO_DEFAULT)
}

export function databaseRimDepth(
  element: Pick<DatabaseElement, 'width' | 'height' | 'customData'>,
): number {
  return Math.min(element.height, element.width * 0.9) * readDatabaseRimRatio(element)
}

export function databaseRimHandleScenePoint(
  element: Pick<DatabaseElement, 'x' | 'y' | 'width' | 'height' | 'angle' | 'customData'>,
): { x: number; y: number } {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const localX = centerX
  // The visible top seam reaches 1.75 × rim depth at its horizontal midpoint.
  const localY = element.y + databaseRimDepth(element) * 1.75
  const cos = Math.cos(element.angle)
  const sin = Math.sin(element.angle)
  return {
    x: centerX + (localX - centerX) * cos - (localY - centerY) * sin,
    y: centerY + (localX - centerX) * sin + (localY - centerY) * cos,
  }
}

function rawDatabaseRimRatioFromScenePoint(
  element: Pick<DatabaseElement, 'x' | 'y' | 'width' | 'height' | 'angle'>,
  scenePoint: { x: number; y: number },
): number {
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const dx = scenePoint.x - centerX
  const dy = scenePoint.y - centerY
  const localY = centerY - dx * Math.sin(element.angle) + dy * Math.cos(element.angle)
  const rimScale = Math.min(element.height, element.width * 0.9)
  if (!Number.isFinite(rimScale) || rimScale <= 0) return DATABASE_RIM_RATIO_DEFAULT
  return (localY - element.y) / (rimScale * 1.75)
}

export function databaseRimRatioFromScenePoint(
  element: Pick<DatabaseElement, 'x' | 'y' | 'width' | 'height' | 'angle'>,
  scenePoint: { x: number; y: number },
): number {
  return clampDatabaseRimRatio(rawDatabaseRimRatioFromScenePoint(element, scenePoint))
}

function selectedDatabaseSnapshot(api: ExcalidrawImperativeAPI): ControlSnapshot | null {
  if (typeof api.getAppState !== 'function' || typeof api.getSceneElements !== 'function') return null
  const state = api.getAppState()
  if (!state?.activeTool || state.viewModeEnabled || state.activeTool.type !== 'selection') return null
  const selectedIds = Object.entries(state.selectedElementIds ?? {})
    .filter(([, selected]) => selected)
    .map(([id]) => id)
  if (selectedIds.length !== 1) return null
  const element = api.getSceneElements().find((candidate) => candidate.id === selectedIds[0]) as DatabaseElement | undefined
  if (
    !element
    || element.isDeleted
    || element.locked
    || element.type !== 'rectangle'
    || element.customData?.nativeShapeKind !== 'database'
    || !Number.isFinite(element.width)
    || !Number.isFinite(element.height)
    || element.width <= 0
    || element.height <= 0
  ) return null
  return { element, state }
}

function snapshotSignature(snapshot: ControlSnapshot | null): string {
  if (!snapshot) return ''
  const { element, state } = snapshot
  return [
    element.id,
    element.version,
    element.x,
    element.y,
    element.width,
    element.height,
    element.angle,
    readDatabaseRimRatio(element),
    state.zoom?.value,
    state.scrollX,
    state.scrollY,
  ].join('|')
}

export function BoardDatabaseRimControl({
  excalidrawAPI,
  readOnly,
  rootRef,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null
  readOnly: boolean
  rootRef: RefObject<HTMLDivElement | null>
}) {
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null)
  const signatureRef = useRef('')
  const dragRef = useRef<DragState | null>(null)
  const dragListenersRef = useRef<DragListeners | null>(null)
  const refreshFrameRef = useRef<number | null>(null)
  const endDragRef = useRef<(finalize: boolean) => void>(() => {})

  const clearDragListeners = useCallback(() => {
    const listeners = dragListenersRef.current
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move)
      window.removeEventListener('pointerup', listeners.finish)
      window.removeEventListener('pointercancel', listeners.cancel)
      dragListenersRef.current = null
    }
    document.body.classList.remove('octo-board-database-rim-dragging')
  }, [])

  const refreshNow = useCallback(() => {
    const next = !readOnly && excalidrawAPI ? selectedDatabaseSnapshot(excalidrawAPI) : null
    const signature = snapshotSignature(next)
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    setSnapshot(next)
  }, [excalidrawAPI, readOnly])

  const scheduleRefresh = useCallback(() => {
    if (refreshFrameRef.current !== null) return
    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null
      refreshNow()
    })
  }, [refreshNow])

  useEffect(() => {
    refreshNow()
    if (!excalidrawAPI || typeof excalidrawAPI.onChange !== 'function') return
    const unsubscribe = excalidrawAPI.onChange(scheduleRefresh)
    return () => {
      unsubscribe()
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current)
        refreshFrameRef.current = null
      }
    }
  }, [excalidrawAPI, refreshNow, scheduleRefresh])

  const position = useMemo(() => {
    if (!snapshot) return null
    const point = databaseRimHandleScenePoint(snapshot.element)
    const zoom = snapshot.state.zoom?.value ?? 1
    return {
      left: (point.x + (snapshot.state.scrollX ?? 0)) * zoom,
      top: (point.y + (snapshot.state.scrollY ?? 0)) * zoom,
    }
  }, [snapshot])

  const commitRatio = useCallback((ratio: number, captureUpdate: 'EVENTUALLY' | 'IMMEDIATELY') => {
    const drag = dragRef.current
    const api = excalidrawAPI
    if (
      !drag
      || !api
      || readOnly
      || typeof api.getSceneElementsIncludingDeleted !== 'function'
      || typeof api.updateScene !== 'function'
    ) return
    const live = api.getSceneElementsIncludingDeleted() as unknown as readonly DatabaseElement[]
    const target = live.find((element) => element.id === drag.elementId)
    if (
      !target
      || target.isDeleted
      || target.locked
      || target.customData?.nativeShapeKind !== 'database'
    ) return
    if (captureUpdate === 'EVENTUALLY' && Math.abs(ratio - drag.latestRatio) < 0.001) return
    drag.latestRatio = ratio
    const elements = live.map((element) => element.id === target.id
      ? bumpElementStamp({
          ...element,
          customData: { ...(element.customData ?? {}), databaseRimRatio: ratio },
        })
      : element)
    api.updateScene({ elements: elements as never, captureUpdate })
  }, [excalidrawAPI, readOnly])

  const updateRatio = useCallback((clientX: number, clientY: number, captureUpdate: 'EVENTUALLY' | 'IMMEDIATELY') => {
    const drag = dragRef.current
    const api = excalidrawAPI
    const root = rootRef.current
    if (
      !drag
      || !api
      || !root
      || readOnly
      || typeof api.getAppState !== 'function'
      || typeof api.getSceneElementsIncludingDeleted !== 'function'
    ) return
    const state = api.getAppState()
    const zoom = state.zoom?.value ?? 1
    const rect = root.getBoundingClientRect()
    const scenePoint = {
      x: (clientX - rect.left) / zoom - (state.scrollX ?? 0),
      y: (clientY - rect.top) / zoom - (state.scrollY ?? 0),
    }
    const live = api.getSceneElementsIncludingDeleted() as unknown as readonly DatabaseElement[]
    const target = live.find((element) => element.id === drag.elementId)
    if (!target) return
    const pointerRatio = rawDatabaseRimRatioFromScenePoint(target, scenePoint)
    commitRatio(clampDatabaseRimRatio(pointerRatio - drag.pointerOffsetRatio), captureUpdate)
  }, [commitRatio, excalidrawAPI, readOnly, rootRef])

  const endDrag = useCallback((finalize: boolean) => {
    const drag = dragRef.current
    if (finalize && drag && Math.abs(drag.latestRatio - drag.initialRatio) >= 0.001) {
      commitRatio(drag.latestRatio, 'IMMEDIATELY')
    }
    dragRef.current = null
    clearDragListeners()
  }, [clearDragListeners, commitRatio])

  endDragRef.current = endDrag
  useEffect(() => () => endDragRef.current(true), [])

  useEffect(() => {
    // Permission loss is a cancellation boundary: clear listeners without writing a final update.
    if (readOnly) endDrag(false)
  }, [endDrag, readOnly])

  const startDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!snapshot || !excalidrawAPI) return
    event.preventDefault()
    event.stopPropagation()
    endDrag(true)
    const initialRatio = readDatabaseRimRatio(snapshot.element)
    const state = excalidrawAPI.getAppState()
    const zoom = state.zoom?.value ?? 1
    const rect = rootRef.current?.getBoundingClientRect()
    const pointerRatio = rect
      ? rawDatabaseRimRatioFromScenePoint(snapshot.element, {
          x: (event.clientX - rect.left) / zoom - (state.scrollX ?? 0),
          y: (event.clientY - rect.top) / zoom - (state.scrollY ?? 0),
        })
      : initialRatio
    dragRef.current = {
      pointerId: event.pointerId,
      elementId: snapshot.element.id,
      initialRatio,
      latestRatio: initialRatio,
      pointerOffsetRatio: pointerRatio - initialRatio,
    }
    document.body.classList.add('octo-board-database-rim-dragging')

    const move = (moveEvent: PointerEvent) => {
      if (dragRef.current?.pointerId !== moveEvent.pointerId) return
      moveEvent.preventDefault()
      updateRatio(moveEvent.clientX, moveEvent.clientY, 'EVENTUALLY')
    }
    const finish = (upEvent: PointerEvent) => {
      if (dragRef.current?.pointerId !== upEvent.pointerId) return
      upEvent.preventDefault()
      updateRatio(upEvent.clientX, upEvent.clientY, 'EVENTUALLY')
      endDrag(true)
    }
    const cancel = (cancelEvent: PointerEvent) => {
      if (dragRef.current?.pointerId !== cancelEvent.pointerId) return
      endDrag(true)
    }
    dragListenersRef.current = { move, finish, cancel }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish, { passive: false })
    window.addEventListener('pointercancel', cancel)
  }, [endDrag, excalidrawAPI, rootRef, snapshot, updateRatio])

  const adjustWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (
      !snapshot
      || !excalidrawAPI
      || readOnly
      || typeof excalidrawAPI.getSceneElementsIncludingDeleted !== 'function'
    ) return
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : 0
    if (!direction) return
    event.preventDefault()
    const live = excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly DatabaseElement[]
    const target = live.find((element) => element.id === snapshot.element.id)
    if (!target || target.isDeleted || target.locked || target.customData?.nativeShapeKind !== 'database') return
    const initialRatio = readDatabaseRimRatio(target)
    const nextRatio = clampDatabaseRimRatio(initialRatio + direction * 0.01)
    if (Math.abs(nextRatio - initialRatio) < 0.001) return
    endDrag(false)
    dragRef.current = {
      pointerId: -1,
      elementId: snapshot.element.id,
      initialRatio,
      latestRatio: initialRatio,
      pointerOffsetRatio: 0,
    }
    commitRatio(nextRatio, 'IMMEDIATELY')
    dragRef.current = null
  }, [commitRatio, endDrag, excalidrawAPI, readOnly, snapshot])

  if (!snapshot || !position) return null

  return (
    <button
      type="button"
      role="slider"
      aria-orientation="vertical"
      className="octo-board-database-rim-handle"
      style={position}
      aria-label={t('docs.board.databaseRimHandleLabel')}
      title={t('docs.board.databaseRimHandleTitle')}
      aria-valuemin={DATABASE_RIM_RATIO_MIN}
      aria-valuemax={DATABASE_RIM_RATIO_MAX}
      aria-valuenow={readDatabaseRimRatio(snapshot.element)}
      aria-valuetext={`${Math.round(readDatabaseRimRatio(snapshot.element) * 100)}%`}
      onPointerDown={startDrag}
      onKeyDown={adjustWithKeyboard}
    />
  )
}
