import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardVersionScene } from '../boardVersions.ts'

// A historical board version's `files` container holds REFS ONLY — `{ attachId, mimeType, status }`
// straight out of the Y.Doc — never the binary/dataURL (see whiteboard-schema/fileRef.ts and
// collab/binding.ts rehydrateFiles). Excalidraw only draws an image when `files[id].dataURL` is
// present, so the preview must rehydrate those refs (resolve signed URL → fetch → dataURL) through
// the SAME attachments path the live board uses, or every image element previews as a grey
// placeholder. These tests capture the `initialData.files` the preview seeds Excalidraw with and
// assert the binary was resolved in — the regression the metadata-only fixtures could not catch.

let lastInitialData: { elements?: unknown[]; files?: Record<string, unknown> } | null = null

vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({
    children,
    initialData,
  }: {
    children?: ReactNode
    initialData?: { elements?: unknown[]; files?: Record<string, unknown> } | null
  }) => {
    lastInitialData = initialData ?? null
    return <div data-testid="excalidraw-canvas">{children}</div>
  }
  const MainMenu = (() => null) as unknown as { DefaultItems: Record<string, unknown> }
  MainMenu.DefaultItems = {}
  // Faithful to `fractional-indexing`'s head-length rule (`a`→2 … `z`→27): a key whose head claims
  // more integer digits than the string carries is unparseable — the backend's zero-padded
  // `r00000000` scheme (head `r`→19 digits, only 9 follow).
  const parseableIndex = (key: unknown): boolean => {
    if (typeof key !== 'string' || key.length === 0) return true
    const head = key[0]
    let intLen = -1
    if (head >= 'a' && head <= 'z') intLen = head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
    else if (head >= 'A' && head <= 'Z') intLen = 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
    return intLen >= 0 && intLen <= key.length
  }
  return {
    Excalidraw,
    MainMenu,
    // Mirror the real `restoreElements` → `syncInvalidIndices`: regenerating a key next to an
    // unparseable one throws `invalid order key` (octo-docs-backend #51), the throw that blanks
    // bot-written boards. The preview must sanitize before restore so this never fires.
    restoreElements: (els: readonly unknown[] | null | undefined) => {
      const out = els ? [...els] : []
      for (const el of out) {
        if (el && typeof el === 'object' && !parseableIndex((el as { index?: unknown }).index)) {
          throw new Error('invalid order key')
        }
      }
      return out
    },
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

const resolveAttachments = vi.fn(
  async (_docId: string, attachIds: string[]) => ({
    items: attachIds.map((attachId) => ({ attachId, url: `https://blob.test/${attachId}`, mime: 'image/png' })),
    notFound: [] as string[],
  }),
)
vi.mock('../../attachments/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../attachments/api.ts')>()
  return {
    ...actual,
    resolveAttachments: (...a: unknown[]) => resolveAttachments(...(a as [string, string[]])),
  }
})

import { BoardScenePreview } from '../BoardScenePreview.tsx'
import { isExcalidrawFractionalIndex } from '../collab/index.ts'

// A one-pixel PNG so the fetched Blob decodes into a real data URL through jsdom's FileReader.
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

beforeEach(() => {
  lastInitialData = null
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([PNG_BYTES], { type: 'image/png' }),
    })),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// A version scene with one image element whose `files` entry is a REF (attachId, no dataURL) —
// exactly what `getBoardVersionState` returns from the serialized Y.Doc.
function imageScene(): BoardVersionScene {
  return {
    elements: [{ id: 'img1', type: 'image', fileId: 'file_a' }],
    files: { file_a: { attachId: 'att_1', mimeType: 'image/png', status: 'saved', createdAt: 1 } },
  }
}

describe('BoardScenePreview image hydration', () => {
  it('rehydrates historical file refs into real binaries before seeding Excalidraw', async () => {
    render(<BoardScenePreview scene={imageScene()} docId="bd_1" />)

    // The scene's single attachId is resolved through the shared attachments path (no new endpoint).
    await waitFor(() => expect(resolveAttachments).toHaveBeenCalledWith('bd_1', ['att_1']))
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())

    const files = lastInitialData?.files as Record<string, { dataURL?: string }> | undefined
    expect(files).toBeTruthy()
    // The regression: without rehydration this entry is the bare ref and dataURL is undefined, so
    // Excalidraw renders a grey placeholder. After the fix it carries a decoded data URL.
    expect(files?.file_a?.dataURL).toMatch(/^data:image\/png/)
  })

  it('mounts immediately with no fetch when the scene has no file refs', async () => {
    render(<BoardScenePreview scene={{ elements: [{ id: 'r1', type: 'rectangle' }], files: {} }} docId="bd_1" />)
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())
    expect(resolveAttachments).not.toHaveBeenCalled()
  })

  it('degrades to a placeholder-only mount when the attachment fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob() })))
    render(<BoardScenePreview scene={imageScene()} docId="bd_1" />)
    // A failed binary fetch must not block the preview — it still mounts, just without the image.
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())
    const files = lastInitialData?.files as Record<string, { dataURL?: string }> | undefined
    expect(files?.file_a?.dataURL).toBeUndefined()
  })
})

// XIN-811 Blocking #1: the version-history preview seeds a real <Excalidraw> from the SAME
// restoreElements step the live board uses, but before this fix it skipped sanitizeFractionalIndices
// — so a bot-written scene (backend `r00000000` scheme) hit `syncInvalidIndices`, threw `invalid
// order key`, and blanked the preview (BoardVersionPanel only catches that with an error boundary).
// This was the third untrusted-restore path the original PR missed. The mocked restoreElements
// above throws on an unparseable key exactly as the real library does, so without the sanitize
// these renders throw and never mount.
describe('BoardScenePreview bot-board fractional-index sanitize (Blocking #1)', () => {
  // A historical bot scene whose z-order keys use the unparseable backend scheme, supplied
  // bottom→top; Y.Doc/serialized order is arbitrary, so ids are deliberately out of key order.
  function botScene(): BoardVersionScene {
    return {
      elements: [
        { id: 'mid', type: 'rectangle', index: 'r00000001' },
        { id: 'top', type: 'rectangle', index: 'r00000002' },
        { id: 'bg', type: 'rectangle', index: 'r00000000' },
      ],
      files: {},
    }
  }

  it('sanitizes bot fractional indices before restore so the preview mounts instead of throwing', async () => {
    render(<BoardScenePreview scene={botScene()} docId="bd_1" />)
    // Without the sanitize the mocked restore throws `invalid order key` and the canvas never mounts.
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())
    const els = (lastInitialData?.elements ?? []) as { id: string; index?: unknown }[]
    // Nothing Excalidraw's grammar would reject reaches the canvas.
    for (const el of els) expect(el.index == null || isExcalidrawFractionalIndex(el.index)).toBe(true)
    // Authored z-order is recovered from the arbitrary source order (homogeneous bot scene).
    expect(els.map((e) => e.id)).toEqual(['bg', 'mid', 'top'])
  })

  it('does not throw on a mixed scene and keeps author order (does not sink valid keys)', async () => {
    // Bot background (unparseable) UNDER a human shape (valid `a5`) — a string sort would invert it.
    const scene: BoardVersionScene = {
      elements: [
        { id: 'bg', type: 'rectangle', index: 'r00000000' },
        { id: 'human', type: 'rectangle', index: 'a5' },
      ],
      files: {},
    }
    render(<BoardScenePreview scene={scene} docId="bd_1" />)
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())
    const els = (lastInitialData?.elements ?? []) as { id: string; index?: unknown }[]
    expect(els.map((e) => e.id)).toEqual(['bg', 'human'])
    expect(els.find((e) => e.id === 'human')!.index).toBe('a5')
  })
})
