// Read-only Excalidraw preview of a historical board scene (frontend-design §6 board preview).
//
// The board's version preview must render the actual DRAWING of a past version, not a text diff —
// so unlike the doc panel (which renders ProseMirror JSON) this mounts a real, view-only Excalidraw
// canvas seeded with the decoded scene. Excalidraw touches window/DOM at import time and cannot run
// under SSR, so it is loaded with the same client-only dynamic `import()` BoardShell uses; the chunk
// is shared with the live board, so opening a preview after the board has mounted costs nothing.
//
// The canvas is `viewModeEnabled` (no editing affordances) and its hamburger is the same de-branded
// BoardMainMenu the live board uses, so the preview never leaks upstream Excalidraw branding.

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { i18n, t } from '../octoweb/index.ts'
import { BoardMainMenu, type ExcalidrawMainMenu } from './BoardMainMenu.tsx'
import type { BoardVersionScene } from './boardVersions.ts'

// Permissive structural view of just the Excalidraw surface the preview drives — we deliberately
// avoid importing Excalidraw's own types at module scope (the library is a client-only dynamic
// import; pulling its `.d.ts` graph into the isolated docs typecheck buys nothing here).
interface ExcalidrawPreviewProps {
  initialData?: { elements?: unknown[]; files?: Record<string, unknown>; scrollToContent?: boolean } | null
  viewModeEnabled?: boolean
  theme?: 'light' | 'dark'
  langCode?: string
  children?: ReactNode
}
type ExcalidrawComponent = ComponentType<ExcalidrawPreviewProps>
type RestoreElementsFn = (elements: readonly unknown[] | null | undefined, local: unknown) => unknown[]

/** Map the app locale to an Excalidraw langCode (mirrors BoardShell.toExcalidrawLang). */
function toExcalidrawLang(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function BoardScenePreview({ scene, dark }: { scene: BoardVersionScene; dark?: boolean }): ReactElement {
  const [Excalidraw, setExcalidraw] = useState<ExcalidrawComponent | null>(null)
  const [MainMenu, setMainMenu] = useState<ExcalidrawMainMenu | null>(null)
  const [failed, setFailed] = useState(false)
  const restoreElementsRef = useRef<RestoreElementsFn | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')])
      .then(([mod]) => {
        if (!active) return
        const m = mod as unknown as { restoreElements?: RestoreElementsFn }
        restoreElementsRef.current = m.restoreElements ?? null
        setMainMenu(() => mod.MainMenu as unknown as ExcalidrawMainMenu)
        setExcalidraw(() => mod.Excalidraw as unknown as ExcalidrawComponent)
      })
      .catch((err) => {
        console.error('[board] failed to load Excalidraw for version preview', err)
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Rehydrate raw persisted/historical elements into renderable Excalidraw shapes (drops unknown
  // element types, fills defaults) — the same restore step the live board applies to initialData.
  const elements = useMemo(() => {
    const restore = restoreElementsRef.current
    if (restore) return restore(scene.elements, null)
    return scene.elements
    // Recompute once the helper resolves (Excalidraw becoming non-null flips this).
  }, [scene, Excalidraw])

  const langCode = toExcalidrawLang(i18n.getLocale ? i18n.getLocale() : 'en-US')
  const isEmpty = !Array.isArray(elements) || elements.length === 0

  if (failed) return <div className="octo-board-state octo-error">{t('docs.state.error')}</div>
  if (!Excalidraw) return <div className="octo-board-state">{t('docs.board.version.previewLoading')}</div>

  return (
    <div className="octo-board-version-preview">
      {isEmpty && <p className="octo-comment-empty octo-board-version-preview-empty">{t('docs.board.version.previewEmpty')}</p>}
      <Excalidraw
        initialData={{ elements, files: scene.files, scrollToContent: true }}
        viewModeEnabled
        theme={dark ? 'dark' : 'light'}
        langCode={langCode}
      >
        {MainMenu && <BoardMainMenu MainMenu={MainMenu} />}
      </Excalidraw>
    </div>
  )
}
