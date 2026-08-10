if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// vitest 4.x + Node.js 22 native storage: `localStorage` is gated behind
// `--localstorage-file`, so bare `localStorage` in production code (invite
// codes, pending-bind marker) reads as undefined and every branch that
// touches it throws instead of returning null. Provide a minimal in-memory
// polyfill so tests exercise the real code path. sessionStorage is already
// wired by jsdom.
if (typeof (globalThis as unknown as { localStorage?: Storage }).localStorage === 'undefined') {
  const store = new Map<string, string>()
  const localStorage: Storage = {
    get length() { return store.size },
    key(i) { return Array.from(store.keys())[i] ?? null },
    getItem(k) { return store.has(k) ? store.get(k)! : null },
    setItem(k, v) { store.set(String(k), String(v)) },
    removeItem(k) { store.delete(k) },
    clear() { store.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
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
