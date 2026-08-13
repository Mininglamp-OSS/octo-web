if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (...args: unknown[]) => unknown
  }
  const originalGetContext = proto.getContext

  proto.getContext = function patchedGetContext(this: HTMLCanvasElement, ...args: unknown[]) {
    const result = typeof originalGetContext === 'function'
      ? originalGetContext.apply(this, args)
      : null
    if (result) return result
    return {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      globalAlpha: 1,
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray() }),
      putImageData: () => {},
      createImageData: () => ({ data: new Uint8ClampedArray() }),
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
      getContextAttributes: () => ({}),
    }
  }
}

// Node 26 + vitest 4 + jsdom: jsdom no longer exposes `window.localStorage`
// unless launched with `--localstorage-file`, and Node's built-in
// `sessionStorage` is on globalThis but not mirrored onto `window`. Older
// tests here (e.g. login_vm_realname.test.ts) use bare `localStorage.setItem`
// and would otherwise blow up in loginSuccess() at
// `localStorage.getItem("pendingInviteCode")` — a pre-existing env issue
// noted in the review. Mirror the polyfill already in place under
// `packages/dmworkbase/src/__tests__/setup.ts` so every spelling —
// `localStorage`, `window.localStorage`, `globalThis.localStorage` — resolves
// to the same in-memory object.
function installMemoryStorage(): Storage {
  const store = new Map<string, string>()
  const api: Storage = {
    get length() { return store.size },
    clear() { store.clear() },
    getItem(key) { return store.has(key) ? (store.get(key) as string) : null },
    key(index) {
      const keys = Array.from(store.keys())
      return index >= 0 && index < keys.length ? keys[index] : null
    },
    removeItem(key) { store.delete(key) },
    setItem(key, value) { store.set(key, String(value)) },
  }
  return api
}

if (typeof window !== 'undefined') {
  if (typeof (window as any).localStorage === 'undefined' || (window as any).localStorage === null) {
    const ls = installMemoryStorage()
    Object.defineProperty(window, 'localStorage', { configurable: true, value: ls })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: ls })
  }
  if (typeof (window as any).sessionStorage === 'undefined') {
    const ss = (globalThis as any).sessionStorage ?? installMemoryStorage()
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: ss })
    if (typeof (globalThis as any).sessionStorage === 'undefined') {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: ss })
    }
  }
}
