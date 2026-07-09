// Whiteboard image binary sync (XIN-702): upload-on-insert, remote rehydrate, and the
// insecure-context file-id hash (P1 crypto.subtle digest crash).
//
//   A1  upload-on-insert     — a locally inserted image is uploaded and its returned attachId is
//                              written into the Y.Doc file ref (so peers can fetch the binary).
//   A2  remote rehydrate     — applyRemote fetches an image binary by attachId and addFiles() it
//                              into the canvas, so a peer renders the image (not a grey placeholder).
//   A3  insecure-context id  — generateIdForFile hashes bytes WITHOUT crypto.subtle, so inserting an
//                              image on plain-http LAN neither throws nor depends on a secure context.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { ExcalidrawYjsBinding, LOCAL_ORIGIN, REPAIR_ORIGIN } from '../binding.ts'
import { hashBytesToId, makeGenerateIdForFile } from '../fileSync.ts'
import { makeEl, FakeExcalidrawApi, syncDocs } from './helpers.ts'
import type { BinaryFileData } from '../types.ts'

/** Resolve pending microtasks so a fire-and-forget upload/fetch promise settles. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function filesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('files')
}

describe('whiteboard image sync (XIN-702)', () => {
  describe('A3: insecure-context file id (crypto.subtle digest crash fix)', () => {
    it('hashBytesToId is deterministic and never touches crypto.subtle', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5])
      const a = hashBytesToId(bytes)
      const b = hashBytesToId(new Uint8Array([1, 2, 3, 4, 5]))
      expect(a).toBe(b)
      expect(a.length).toBeGreaterThan(0)
      // different content → different id
      expect(hashBytesToId(new Uint8Array([9, 9, 9]))).not.toBe(a)
    })

    it('generateIdForFile resolves an id with crypto.subtle undefined (no throw)', async () => {
      const original = globalThis.crypto
      // Simulate a plain-http LAN insecure context: window.crypto exists but subtle is undefined.
      Object.defineProperty(globalThis, 'crypto', {
        value: { subtle: undefined },
        configurable: true,
      })
      try {
        const gen = makeGenerateIdForFile()
        const bytes = new Uint8Array([10, 20, 30]).buffer
        const file = { arrayBuffer: () => Promise.resolve(bytes) }
        const id = await gen(file)
        expect(typeof id).toBe('string')
        expect(id.length).toBeGreaterThan(0)
        // Deterministic for the same bytes.
        const again = await gen({ arrayBuffer: () => Promise.resolve(new Uint8Array([10, 20, 30]).buffer) })
        expect(again).toBe(id)
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
      }
    })
  })

  describe('A1: upload-on-insert sets attachId in the Y.Doc file ref', () => {
    let doc: Y.Doc
    let api: FakeExcalidrawApi
    let binding: ExcalidrawYjsBinding

    beforeEach(() => {
      doc = new Y.Doc()
      api = new FakeExcalidrawApi()
      binding = new ExcalidrawYjsBinding(doc, { api })
    })

    it('uploads a freshly inserted image binary and mirrors the returned attachId', async () => {
      const uploader = vi.fn(async (_file: BinaryFileData) => 'att-remote-1')
      binding.setFileSync({ uploader })

      const img = makeEl('img1', { type: 'image', fileId: 'f1' })
      binding.handleLocalChange([img], {
        f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1 },
      })

      // On HEAD (no upload wiring) attachId is never set — this is the P2 non-sync gap.
      expect(uploader).toHaveBeenCalledTimes(1)
      await flushMicrotasks()

      const yFile = filesOf(doc).get('f1')!
      // Canonical FileRef shape from the shared schema (buildFileRef): attachId + mimeType +
      // status:'saved' + createdAt. Binary itself never enters the Y.Doc (XIN-16 §2.2).
      expect(yFile.get('attachId')).toBe('att-remote-1')
      expect(yFile.get('mimeType')).toBe('image/png')
      expect(yFile.get('status')).toBe('saved')
      expect(yFile.get('createdAt')).toBe(1)
      expect(yFile.has('dataURL')).toBe(false)
    })

    it('does not re-upload a file that already carries an attachId', async () => {
      const uploader = vi.fn(async (_file: BinaryFileData) => 'att-x')
      binding.setFileSync({ uploader })
      const img = makeEl('img2', { type: 'image', fileId: 'f2' })
      binding.handleLocalChange([img], {
        f2: {
          id: 'f2',
          mimeType: 'image/png',
          dataURL: 'data:image/png;base64,BBBB',
          attachId: 'already-there',
        },
      })
      await flushMicrotasks()
      expect(uploader).not.toHaveBeenCalled()
      expect(filesOf(doc).get('f2')!.get('attachId')).toBe('already-there')
    })
  })

  describe('A2: applyRemote rehydrates image binaries via fetch + addFiles', () => {
    it('fetches by attachId and addFiles() so a peer renders the image', async () => {
      // Peer A authored an image; its Y.Doc holds the element + a file REF with attachId, no binary.
      const peer = new Y.Doc()
      const peerBinding = new ExcalidrawYjsBinding(peer, { api: new FakeExcalidrawApi(), enableUndo: false })
      peerBinding.setFileSync({ uploader: async () => 'att-shared' })
      peerBinding.handleLocalChange([makeEl('imgA', { type: 'image', fileId: 'fA' })], {
        fA: { id: 'fA', mimeType: 'image/png', dataURL: 'data:image/png;base64,CCCC' },
      })
      await flushMicrotasks()
      expect(filesOf(peer).get('fA')!.get('attachId')).toBe('att-shared')

      // Peer B receives the state. It has NO binary — it must fetch by attachId and addFiles.
      const docB = new Y.Doc()
      const apiB = new FakeExcalidrawApi()
      const bindingB = new ExcalidrawYjsBinding(docB, { api: apiB })
      const fetched: BinaryFileData = {
        id: 'fA',
        mimeType: 'image/png',
        dataURL: 'data:image/png;base64,CCCC',
      }
      // Batch fetcher: receives every fetchable ref at once, returns the resolved binaries.
      const fetcher = vi.fn(async (_refs: readonly { id: string; attachId: string; mimeType?: string }[]) => [
        fetched,
      ])
      bindingB.setFileSync({ fetcher })

      syncDocs(peer, docB, REPAIR_ORIGIN) // remote origin → triggers applyRemote on B
      await flushMicrotasks()

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0][0]).toEqual([
        expect.objectContaining({ id: 'fA', attachId: 'att-shared' }),
      ])
      expect(apiB.addFilesCalls).toBeGreaterThanOrEqual(1)
      expect(apiB.addedFiles.some((f) => f.id === 'fA')).toBe(true)
    })

    it('batches multiple fetchable refs into a single fetcher call (resolve batch path)', async () => {
      // Two remote images arriving in one apply must be fetched with ONE batch call, not two.
      const peer = new Y.Doc()
      const peerBinding = new ExcalidrawYjsBinding(peer, { api: new FakeExcalidrawApi(), enableUndo: false })
      let n = 0
      peerBinding.setFileSync({ uploader: async () => `att-${++n}` })
      peerBinding.handleLocalChange(
        [makeEl('imgX', { type: 'image', fileId: 'fX' }), makeEl('imgY', { type: 'image', fileId: 'fY' })],
        {
          fX: { id: 'fX', mimeType: 'image/png', dataURL: 'data:image/png;base64,XXXX' },
          fY: { id: 'fY', mimeType: 'image/png', dataURL: 'data:image/png;base64,YYYY' },
        },
      )
      await flushMicrotasks()

      const docB = new Y.Doc()
      const apiB = new FakeExcalidrawApi()
      const bindingB = new ExcalidrawYjsBinding(docB, { api: apiB })
      const fetcher = vi.fn(async (refs: readonly { id: string; attachId: string }[]) =>
        refs.map((r) => ({ id: r.id, mimeType: 'image/png', dataURL: 'data:image/png;base64,ZZZZ' })),
      )
      bindingB.setFileSync({ fetcher })

      syncDocs(peer, docB, REPAIR_ORIGIN)
      await flushMicrotasks()

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0][0].map((r) => r.id).sort()).toEqual(['fX', 'fY'])
      expect(apiB.addedFiles.map((f) => f.id).sort()).toEqual(['fX', 'fY'])
    })

    it('does not fetch a file the local client already holds the binary for', async () => {
      const doc = new Y.Doc()
      const api = new FakeExcalidrawApi()
      const binding = new ExcalidrawYjsBinding(doc, { api })
      const fetcher = vi.fn(async () => [])
      binding.setFileSync({ uploader: async () => 'att-local', fetcher })

      // Local insert: this client holds the binary already, so a later applyRemote must not re-fetch.
      binding.handleLocalChange([makeEl('imgL', { type: 'image', fileId: 'fL' })], {
        fL: { id: 'fL', mimeType: 'image/png', dataURL: 'data:image/png;base64,DDDD' },
      })
      await flushMicrotasks()
      binding.refreshFromDoc()
      await flushMicrotasks()
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  it('LOCAL_ORIGIN symbol is still exported (sanity)', () => {
    expect(typeof LOCAL_ORIGIN).toBe('symbol')
  })
})
