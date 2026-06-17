// Offline IndexedDB cache helpers (frontend-design §6).
//
// Cache key is user-scoped (`octo-doc:{uid}:{space}:{folder}:{doc}`) so a different identity
// never renders a previous user's local copy before the backend confirms permission. v2.1:
// segment 3 is the docs-native folder.
//
// clearDocCache enforces a strict teardown order so deleteDatabase is not blocked by an open
// y-indexeddb handle (called on 4403/4404, logout, account switch — §6.3).

export interface DocScope {
  uid: string
  space: string
  folder: string
  doc: string
}

/** Build the user-scoped IndexedDB cache key. */
export function cacheKey(scope: DocScope): string {
  return `octo-doc:${scope.uid}:${scope.space}:${scope.folder}:${scope.doc}`
}

/** Minimal disposable surface so this module stays decoupled from the editor/provider. */
export interface DocCacheHandles {
  freezeUI(): void
  /** Broadcast a close to sibling tabs so they release the IDB handle first (prevents blocked). */
  broadcastClose(key: string): void
  disconnectProvider(): void
  destroyProvider(): void
  destroyEditor(): void
  /** Closes the y-indexeddb handle (returns when the IDB connection is released). */
  destroyLocalPersistence(): Promise<void>
}

/**
 * Wrap indexedDB.deleteDatabase in a Promise, observing blocked/error/success.
 * On `blocked` we wait — the close has been broadcast, so a sibling tab releasing its
 * handle will let `success` finish the deletion.
 */
export function deleteDatabaseAwait(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error(`deleteDatabase(${name}) failed`))
    req.onblocked = () => {
      // Still held by another connection: the close was broadcast; success will resolve us.
    }
  })
}

/**
 * Terminal close: strict ordering (frontend-design §6.3) to avoid a deleteDatabase block.
 *   freeze UI -> broadcast close -> disconnect -> destroy provider -> destroy editor
 *   -> destroy local persistence -> deleteDatabase (await) -> (caller navigates).
 */
export async function clearDocCache(key: string, handles: DocCacheHandles): Promise<void> {
  handles.freezeUI()
  handles.broadcastClose(key)
  handles.disconnectProvider()
  handles.destroyProvider()
  handles.destroyEditor()
  await handles.destroyLocalPersistence()
  await deleteDatabaseAwait(key)
}
