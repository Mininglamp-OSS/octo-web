/** Shared Doc/Sheet palette controls for Excalidraw shape tools 2–7. */
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { ConfigProvider } from '@univerjs/design'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { ColorSplitControl, designLocale, getUniverPortal } from '../editor/colorControl.tsx'
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_TEXT_COLOR } from '../editor/colorPalette.ts'
import { bumpElementStamp } from './boardElementBump.ts'
import { t } from '../octoweb/index.ts'

interface ElementView {
  id: string
  type: string
  isDeleted?: boolean
  strokeColor?: string
  backgroundColor?: string
  version?: number
  versionNonce?: number
}

interface Snapshot {
  elements: readonly ElementView[]
  selectedIds: Readonly<Record<string, boolean>>
  currentItemStrokeColor: string
  currentItemBackgroundColor: string
}

const EMPTY: Snapshot = {
  elements: [],
  selectedIds: {},
  currentItemStrokeColor: DEFAULT_TEXT_COLOR,
  currentItemBackgroundColor: DEFAULT_HIGHLIGHT_COLOR,
}

export function NativePanelShapeColorControls({
  excalidrawAPI,
  toolDefault,
  targetIds,
  backgroundTargetIds = targetIds,
  toolSupportsBackground = false,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI
  toolDefault: boolean
  /** Shape ids owned by this control. Mixed text/shape selections intentionally exclude text. */
  targetIds?: readonly string[]
  /** Subset that supports fill/background (lines and free-draw do not). */
  backgroundTargetIds?: readonly string[]
  /** Whether the active shape tool supports a background before an element exists. */
  toolSupportsBackground?: boolean
}) {
  const cache = useRef<{ signature: string; snapshot: Snapshot } | null>(null)
  const usable = typeof excalidrawAPI.onChange === 'function'
  // Memoize the subscribe callback so useSyncExternalStore does not resubscribe on every render
  // (a fresh closure each render forces React to unsubscribe/resubscribe every commit).
  const subscribe = useCallback(
    (notify: () => void) => (usable ? excalidrawAPI.onChange(notify) : () => {}),
    [usable, excalidrawAPI],
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      if (!usable) return EMPTY
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly ElementView[]
      const app = excalidrawAPI.getAppState() as ReturnType<ExcalidrawImperativeAPI['getAppState']> & {
        currentItemStrokeColor?: string
        currentItemBackgroundColor?: string
      }
      const selectedIds = (app.selectedElementIds ?? {}) as Readonly<Record<string, boolean>>
      // Signature is O(selected), not O(scene) (yujiawei P2-2): getSnapshot runs on every onChange —
      // i.e. every pointer-drag frame while a selection exists — so it must not allocate a string
      // proportional to the whole scene. `shared()` only reads the selected elements' colours, so we
      // key on those alone, mirroring NativePanelTextControls' selection-scoped signature. A change to
      // a non-selected element no longer forces a re-render; a change to the selection or to a selected
      // element's stroke/fill/version still does.
      const selectedKey = Object.keys(selectedIds).filter((id) => selectedIds[id]).sort()
      let selectedSig = ''
      for (const id of selectedKey) {
        const el = elements.find((candidate) => candidate.id === id)
        if (el) selectedSig += `${el.id}:${el.strokeColor ?? ''}:${el.backgroundColor ?? ''}:${el.version ?? ''}|`
      }
      const signature = `${selectedKey.join(',')}:${app.currentItemStrokeColor ?? ''}:${app.currentItemBackgroundColor ?? ''}:${selectedSig}`
      if (cache.current?.signature === signature) return cache.current.snapshot
      const next: Snapshot = {
        elements,
        selectedIds,
        currentItemStrokeColor: app.currentItemStrokeColor || DEFAULT_TEXT_COLOR,
        currentItemBackgroundColor: app.currentItemBackgroundColor || DEFAULT_HIGHLIGHT_COLOR,
      }
      cache.current = { signature, snapshot: next }
      return next
    },
    () => EMPTY,
  )

  const explicitTargets = targetIds ? new Set(targetIds) : null
  const explicitBackgroundTargets = backgroundTargetIds ? new Set(backgroundTargetIds) : explicitTargets
  const selected = snapshot.elements.filter((el) => (
    !el.isDeleted && (explicitTargets ? explicitTargets.has(el.id) : snapshot.selectedIds[el.id])
  ))
  const backgroundSelected = snapshot.elements.filter((el) => (
    !el.isDeleted && (explicitBackgroundTargets
      ? explicitBackgroundTargets.has(el.id)
      : snapshot.selectedIds[el.id])
  ))
  // Empty sentinel: a multi-selection whose members disagree on this colour. Kept distinct from any
  // real colour so the control can show an explicit "mixed" affordance instead of pretending one
  // member's colour is the shared truth.
  const MIXED = ''
  const shared = (key: 'strokeColor' | 'backgroundColor') => {
    if (toolDefault) return key === 'strokeColor'
      ? snapshot.currentItemStrokeColor
      : snapshot.currentItemBackgroundColor
    const targets = key === 'backgroundColor' ? backgroundSelected : selected
    const values = new Set(targets.map((el) => el[key]).filter((value): value is string => !!value))
    return values.size === 1 ? [...values][0] : MIXED
  }
  const apply = (key: 'strokeColor' | 'backgroundColor', color: string) => {
    if (toolDefault) {
      excalidrawAPI.updateScene({
        appState: { [key === 'strokeColor' ? 'currentItemStrokeColor' : 'currentItemBackgroundColor']: color } as never,
      })
      return
    }
    // Read the LIVE scene at click time rather than mutating the render snapshot: a concurrent
    // remote apply (or any edit since this control last rendered) may have advanced elements the
    // stale snapshot doesn't reflect, and replacing the scene from that snapshot would silently
    // revert those. `bumpElementStamp` re-versions each recoloured element so the collab CAS gate
    // still propagates the write.
    const targets = key === 'backgroundColor' ? backgroundSelected : selected
    const ids = new Set(targets.map((el) => el.id))
    const live = excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly ElementView[]
    const elements = live.map((el) => (ids.has(el.id)
      ? bumpElementStamp({ ...el, [key]: color })
      : el))
    excalidrawAPI.updateScene({ elements: elements as never, captureUpdate: 'IMMEDIATELY' })
  }
  const control = (key: 'strokeColor' | 'backgroundColor', title: string, fallback: string) => {
    const resolved = shared(key)
    const mixed = resolved === MIXED
    // Feed the ColorSplitControl a concrete colour even when mixed (its picker needs a value); the
    // explicit mixed affordance is driven off `mixed` and surfaced on the wrapper for callers/tests.
    const display = mixed ? fallback : resolved
    return (
      <fieldset className="octo-board-native-inject__fs">
        <legend>{title}</legend>
        <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
          <span
            className="octo-board-native-inject__color octo-theme"
            data-testid={key === 'strokeColor'
              ? 'board-native-panel-shape-stroke'
              : 'board-native-panel-shape-fill'}
            data-current-color={mixed ? 'mixed' : display}
          >
            <ColorSplitControl
              key={`${key}:${mixed ? 'mixed' : display}`}
              title={title}
              initialColor={display}
              currentColor={display}
              renderIcon={(value) => mixed
                ? <span className="octo-board-color-icon octo-board-color-icon--mixed" aria-hidden="true" />
                : <span className="octo-board-color-icon" style={{ backgroundColor: value }} />}
              // A mixed selection has no truthful main-swatch colour. Keep that action inert rather
              // than painting the picker's fallback over every selected shape; choosing an actual
              // palette colour remains an intentional write.
              onMainClick={(value) => { if (!mixed) apply(key, value) }}
              onPick={(value) => apply(key, value)}
              onClear={() => apply(key, key === 'strokeColor' ? DEFAULT_TEXT_COLOR : 'transparent')}
              portalPopover
            />
          </span>
        </ConfigProvider>
      </fieldset>
    )
  }

  return (
    <div
      className="octo-board-native-inject__panel octo-board-properties-interactive"
      data-testid="board-native-panel-shape-colors"
      role="group"
    >
      {control('strokeColor', t('docs.board.nativePanel.strokeColor'), DEFAULT_TEXT_COLOR)}
      {((toolDefault && toolSupportsBackground) || backgroundSelected.length > 0) && control(
        'backgroundColor',
        t('docs.board.nativePanel.backgroundColor'),
        DEFAULT_HIGHLIGHT_COLOR,
      )}
    </div>
  )
}
