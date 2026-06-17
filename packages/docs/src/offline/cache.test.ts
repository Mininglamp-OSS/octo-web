import { describe, it, expect, vi } from 'vitest'
import { cacheKey, clearDocCache, deleteDatabaseAwait, type DocCacheHandles } from './cache.ts'

describe('cacheKey', () => {
  it('is user-scoped: octo-doc:{uid}:{space}:{folder}:{doc}', () => {
    expect(cacheKey({ uid: 'u_1', space: 's', folder: 'f_888', doc: 'd_1' })).toBe(
      'octo-doc:u_1:s:f_888:d_1',
    )
  })

  it('isolates different users for the same document', () => {
    const a = cacheKey({ uid: 'u_a', space: 's', folder: 'f', doc: 'd' })
    const b = cacheKey({ uid: 'u_b', space: 's', folder: 'f', doc: 'd' })
    expect(a).not.toBe(b)
  })
})

describe('clearDocCache ordering', () => {
  it('tears down in the §6.3 order before deleting the database', async () => {
    const order: string[] = []
    const handles: DocCacheHandles = {
      freezeUI: () => order.push('freezeUI'),
      broadcastClose: () => order.push('broadcastClose'),
      disconnectProvider: () => order.push('disconnect'),
      destroyProvider: () => order.push('destroyProvider'),
      destroyEditor: () => order.push('destroyEditor'),
      destroyLocalPersistence: async () => {
        order.push('destroyLocalPersistence')
      },
    }
    await clearDocCache('octo-doc:u:s:f:d', handles)
    expect(order).toEqual([
      'freezeUI',
      'broadcastClose',
      'disconnect',
      'destroyProvider',
      'destroyEditor',
      'destroyLocalPersistence',
    ])
  })

  it('freezes UI and broadcasts close before disconnecting (prevents deleteDatabase block)', async () => {
    const calls: string[] = []
    const handles: DocCacheHandles = {
      freezeUI: vi.fn(() => calls.push('freeze')),
      broadcastClose: vi.fn(() => calls.push('broadcast')),
      disconnectProvider: vi.fn(() => calls.push('disconnect')),
      destroyProvider: vi.fn(),
      destroyEditor: vi.fn(),
      destroyLocalPersistence: vi.fn(async () => {}),
    }
    await clearDocCache('octo-doc:u:s:f:d2', handles)
    expect(calls.indexOf('freeze')).toBeLessThan(calls.indexOf('broadcast'))
    expect(calls.indexOf('broadcast')).toBeLessThan(calls.indexOf('disconnect'))
  })
})

describe('deleteDatabaseAwait', () => {
  it('resolves when the database is deleted', async () => {
    const name = 'octo-doc:u:s:f:dtest'
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    await expect(deleteDatabaseAwait(name)).resolves.toBeUndefined()
  })
})
