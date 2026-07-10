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
  return {
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
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
