import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importBoardScene, preflightBoardImport } from './boardImport.ts'

const validElement = {
  id: 'shape-1', type: 'rectangle', x: 1, y: 2, width: 100, height: 80, angle: 0,
  version: 1, versionNonce: 1,
}
const validScene = {
  type: 'excalidraw', elements: [validElement],
  appState: { viewBackgroundColor: '#fff', zoom: { value: 1 } }, files: {},
}

beforeEach(() => window.localStorage.clear())

describe('board import preflight', () => {
  it.each([
    null,
    [validElement, null],
    [{ ...validElement, id: '' }],
    [{ ...validElement, x: Number.NaN }],
    [{ id: 'partial', type: 'rectangle' }],
  ])('rejects malformed element arrays before creation: %j', (elements) => {
    const create = vi.fn()
    expect(() => preflightBoardImport({ ...validScene, elements })).toThrow()
    expect(create).not.toHaveBeenCalled()
    expect(Object.keys(window.localStorage)).toHaveLength(0)
  })

  it('rejects malformed appState and files', () => {
    expect(() => preflightBoardImport({ ...validScene, appState: [] })).toThrow()
    expect(() => preflightBoardImport({ ...validScene, files: { f: null } })).toThrow()
    expect(() => preflightBoardImport({ ...validScene, files: { f: { mimeType: 'image/png', dataURL: 1 } } })).toThrow()
  })

  it('accepts a real-like image export with epoch-millisecond timestamps', () => {
    const now = Date.now()
    const image = {
      ...validElement,
      id: 'image-1', type: 'image', fileId: 'file-1', status: 'saved',
    }
    const stage = preflightBoardImport({
      ...validScene,
      elements: [image],
      files: {
        'file-1': {
          id: 'file-1', mimeType: 'image/png',
          dataURL: 'data:image/png;base64,iVBORw0KGgo=', created: now, lastRetrieved: now,
        },
      },
    }, 'u1')
    expect(stage.scene.elements).toHaveLength(1)
    expect(stage.scene.files?.['file-1']).toMatchObject({ created: now, lastRetrieved: now })
  })

  it('drops unsupported and dangling-file elements without rejecting valid survivors', () => {
    const stage = preflightBoardImport({
      ...validScene,
      elements: [
        validElement,
        { ...validElement, id: 'future', type: 'iframe' },
        { ...validElement, id: 'image-1', type: 'image', fileId: 'ghost' },
      ],
    })
    expect(stage.scene.elements.map((element) => (element as { id: string }).id)).toEqual(['shape-1'])
  })

  it('rejects unsafe supplied versions but defaults missing version metadata', () => {
    expect(() => preflightBoardImport({ ...validScene, elements: [{ ...validElement, version: 1e308 }] })).toThrow()
    const { version: _version, versionNonce: _nonce, ...legacyElement } = validElement
    const stage = preflightBoardImport({ ...validScene, elements: [legacyElement] })
    expect(stage.scene.elements[0]).toMatchObject({ id: 'shape-1', version: 1 })
    expect(Number.isInteger((stage.scene.elements[0] as { versionNonce?: unknown })?.versionNonce)).toBe(true)
  })

  it('accepts legacy null appState fields as absent while retaining strict non-null validation', () => {
    const stage = preflightBoardImport({
      ...validScene,
      appState: { gridSize: null, zoom: null, scrollX: null, scrollY: null },
    })
    expect(stage.scene.appState).toBeUndefined()
    expect(() => preflightBoardImport({ ...validScene, appState: { gridSize: '20' } })).toThrow()
  })

  it('does not create a server document when local persistence preflight fails', async () => {
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    const create = vi.fn(async () => ({ docId: 'server-board' }))
    const rollback = vi.fn(async () => undefined)
    await expect(importBoardScene(validScene, create, rollback, 'u1')).rejects.toThrow('storage failed')
    expect(create).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
    vi.mocked(Storage.prototype.setItem).mockRestore()
    Storage.prototype.setItem = original
  })

  it('migrates staged data to the real id and removes the temporary key', async () => {
    const create = vi.fn(async () => ({ docId: 'real-board' }))
    const rollback = vi.fn(async () => undefined)
    await expect(importBoardScene(validScene, create, rollback, 'u1')).resolves.toEqual({ docId: 'real-board' })
    const keys = Object.keys(window.localStorage)
    expect(keys).toEqual(['octo.board.scene.u1.real-board'])
    expect(keys.some((key) => key.includes('__import_'))).toBe(false)
    expect(rollback).not.toHaveBeenCalled()
  })

  it('cleans staging when create fails', async () => {
    await expect(importBoardScene(validScene, async () => { throw new Error('create failed') }, async () => undefined, 'u1')).rejects.toThrow('create failed')
    expect(Object.keys(window.localStorage)).toHaveLength(0)
  })

  it('rolls back the server document and cleans staging when the real-id write fails', async () => {
    let writes = 0
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      writes += 1
      if (writes === 2) throw new DOMException('quota changed', 'QuotaExceededError')
      return realSet.call(this, key, value)
    })
    writes = 0
    const rollback = vi.fn(async () => undefined)
    await expect(importBoardScene(validScene, async () => ({ docId: 'real-board' }), rollback, 'u1')).rejects.toThrow('storage failed')
    expect(rollback).toHaveBeenCalledWith('real-board')
    expect(Object.keys(window.localStorage).some((key) => key.includes('__import_'))).toBe(false)
    vi.mocked(Storage.prototype.setItem).mockRestore()
  })
})
