// jsdom under Node 22+ does not expose a working `window.localStorage` /
// `sessionStorage` unless `--localstorage-file` is passed; the globals resolve
// to `undefined`, so any test reading `localStorage.getItem` crashes. Provide a
// minimal in-memory Storage polyfill, isolated per run.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null }
  removeItem(key: string) { this.store.delete(key) }
  setItem(key: string, value: string) { this.store.set(key, String(value)) }
}

for (const prop of ['localStorage', 'sessionStorage'] as const) {
  const current = typeof window !== 'undefined'
    ? (window as unknown as Record<string, unknown>)[prop]
    : undefined
  if (!current) {
    const storage = new MemoryStorage()
    Object.defineProperty(window, prop, { value: storage, writable: true, configurable: true })
    Object.defineProperty(globalThis, prop, { value: storage, writable: true, configurable: true })
  }
}

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
