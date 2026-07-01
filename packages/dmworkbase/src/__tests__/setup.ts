import '@testing-library/jest-dom'

// jsdom under Node 22+ does not expose a working `window.localStorage` /
// `sessionStorage` unless `--localstorage-file` is passed; the globals resolve
// to `undefined`, so any test that calls `localStorage.clear()` / `getItem`
// crashes in beforeEach. Provide a minimal in-memory Storage polyfill so
// storage-backed code (oidcLogout, I18nService persistence, layoutWidth, …)
// runs deterministically and isolated per test run.
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
    const desc = Object.getOwnPropertyDescriptor(window, prop)
    const current = desc ? (window as unknown as Record<string, unknown>)[prop] : undefined
    if (!current) {
        Object.defineProperty(window, prop, {
            value: new MemoryStorage(),
            writable: true,
            configurable: true,
        })
        Object.defineProperty(globalThis, prop, {
            value: (window as unknown as Record<string, Storage>)[prop],
            writable: true,
            configurable: true,
        })
    }
}

// ResizeObserver polyfill for jsdom (Semi UI components trigger this).
if (typeof ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
}

// HTMLCanvasElement.getContext() polyfill for jsdom.
// @douyinfe/semi-ui transitively imports lottie-web, which eagerly writes to
// `canvas.getContext("2d").fillStyle` at module-init time. jsdom returns null
// from getContext() by default → import crashes before any test runs. Return a
// minimal no-op 2D context stub so the module graph can load.
if (typeof HTMLCanvasElement !== 'undefined') {
    const proto = HTMLCanvasElement.prototype as unknown as {
        getContext: (...args: unknown[]) => unknown
    }
    const orig = proto.getContext
    proto.getContext = function patchedGetContext(this: HTMLCanvasElement, ...args: unknown[]) {
        const result = typeof orig === 'function' ? orig.apply(this, args) : null
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
