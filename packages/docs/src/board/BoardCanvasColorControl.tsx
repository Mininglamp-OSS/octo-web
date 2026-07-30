/**
 * BoardCanvasColorControl — the app-owned canvas-background colour picker for the whiteboard's
 * top-toolbar slot 9 ("画布颜色"). The patched Excalidraw no longer opens its own left-side canvas
 * menu from that button or the digit-9 shortcut; both only dispatch the document custom event
 * {@link BOARD_CANVAS_COLOR_EVENT}. This component listens for that event and, in response, opens the
 * SAME shared {@link ColorSplitControl} the docs table toolbar and the board's text/shape colour
 * controls use — the full 5×9 preset grid + 更多颜色 spectrum + 重置颜色 clear row, portalled so the
 * toolbar can't clip it.
 *
 * The picked colour is written straight back through `updateScene({ appState: { viewBackgroundColor } })`,
 * and the control's current colour is CONTROLLED off the live `appState.viewBackgroundColor` (read
 * through the imperative API's `onChange` store) so the swatch always mirrors the canvas — no matter
 * whether the change came from here, an undo, or a remote peer.
 *
 * It renders nothing visible: the trigger lives in Excalidraw's native toolbar (the host span is
 * hidden in board.css, and the portalled popover anchors to the real `toolbar-canvas-color` button).
 * Read-only sessions render nothing and never bind the listener — viewers have no editing surface.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { ConfigProvider } from '@univerjs/design'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { ColorSplitControl, designLocale, getUniverPortal } from '../editor/colorControl.tsx'
import { DEFAULT_VIEW_BACKGROUND_COLOR } from './collab/schema.ts'
import { t } from '../octoweb/index.ts'
import './board.css'

/** Document event the patched Excalidraw toolbar button + digit-9 shortcut dispatch to open this
 *  app-owned picker instead of the native canvas menu. */
export const BOARD_CANVAS_COLOR_EVENT = 'octo-board-canvas-color-request'

/** Excalidraw's own default canvas background, used as the clear/reset target and the fallback when
 *  appState has no explicit `viewBackgroundColor` yet. Shared with the collab binding so the picker's
 *  reset and the binding's clear-to-default agree on what "no explicit background" means. */
const DEFAULT_CANVAS_COLOR = DEFAULT_VIEW_BACKGROUND_COLOR

interface Props {
  /** Live imperative Excalidraw API. Null before the canvas mounts — the control stays inert until
   *  it lands, then re-subscribes (BoardShell passes it as state). */
  excalidrawAPI: ExcalidrawImperativeAPI | null
  /** Read-only sessions expose no editing controls, so the listener is never bound. */
  readOnly?: boolean
  /** Live Board wrapper used to resolve the native toolbar anchor without querying the document. */
  rootRef?: RefObject<HTMLElement | null>
  /**
   * Commit an explicit user-picked colour to the shared collab doc (PR #1161 authority gate). Called
   * only on a real pick / reset from this control, so a pre-sync canvas default can never reach the
   * doc via `onChange`. Omitted on the standalone (non-collab) path — the local mirror still persists
   * the colour through the canvas `onChange`.
   */
  onColorCommit?: (color: string) => void
}

export function BoardCanvasColorControl({ excalidrawAPI, readOnly = false, rootRef, onColorCommit }: Props) {
  const [openSignal, setOpenSignal] = useState(0)
  const usable = !!excalidrawAPI && typeof excalidrawAPI.onChange === 'function'

  // Controlled current colour: subscribe to the live appState so the swatch tracks the canvas
  // background regardless of what changed it.
  const subscribe = useCallback(
    (notify: () => void) => (usable ? excalidrawAPI!.onChange(notify) : () => {}),
    [usable, excalidrawAPI],
  )
  const currentColor = useSyncExternalStore(
    subscribe,
    () => {
      if (!usable) return DEFAULT_CANVAS_COLOR
      const app = excalidrawAPI!.getAppState() as { viewBackgroundColor?: string }
      return app.viewBackgroundColor || DEFAULT_CANVAS_COLOR
    },
    () => DEFAULT_CANVAS_COLOR,
  )

  useEffect(() => {
    if (readOnly || typeof document === 'undefined') return
    const onRequest = () => setOpenSignal((n) => n + 1)
    document.addEventListener(BOARD_CANVAS_COLOR_EVENT, onRequest)
    return () => document.removeEventListener(BOARD_CANVAS_COLOR_EVENT, onRequest)
  }, [readOnly])

  if (readOnly || !usable) return null

  const apply = (color: string) => {
    if (!color) return
    excalidrawAPI!.updateScene({ appState: { viewBackgroundColor: color } as never })
    // Explicit user pick → request an immediate shared-doc commit. BoardShell applies the same real
    // provider sync gate used by the generic onChange mirror before forwarding this value.
    onColorCommit?.(color)
  }

  return (
    <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
      <span
        className="octo-board-canvas-color octo-theme"
        data-testid="board-canvas-color-control"
        data-current-color={currentColor}
      >
        <ColorSplitControl
          title={t('docs.board.canvasColor')}
          initialColor={currentColor}
          currentColor={currentColor}
          openSignal={openSignal}
          getAnchorRect={() =>
            rootRef?.current
              ?.querySelector<HTMLElement>('[data-testid="toolbar-canvas-color"]')
              ?.getBoundingClientRect() ?? null
          }
          renderIcon={(c) => (
            <span className="octo-board-color-icon" style={{ backgroundColor: c }} aria-hidden="true" />
          )}
          onMainClick={(c) => apply(c)}
          onPick={(c) => apply(c)}
          onClear={() => apply(DEFAULT_CANVAS_COLOR)}
          singleButton
          portalPopover
          portalAlign="end"
        />
      </span>
    </ConfigProvider>
  )
}
