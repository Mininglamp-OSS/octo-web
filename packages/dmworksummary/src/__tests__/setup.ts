import '@testing-library/jest-dom';

// jsdom under Node 22+ does not expose a working `window.localStorage` /
// `sessionStorage` unless `--localstorage-file` is passed; the globals resolve
// to `undefined`, so tests calling `localStorage.clear()` crash. Provide a
// minimal in-memory Storage polyfill, isolated per run.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

for (const prop of ['localStorage', 'sessionStorage'] as const) {
  const current = typeof window !== 'undefined'
    ? (window as unknown as Record<string, unknown>)[prop]
    : undefined;
  if (!current) {
    const storage = new MemoryStorage();
    Object.defineProperty(window, prop, { value: storage, writable: true, configurable: true });
    Object.defineProperty(globalThis, prop, { value: storage, writable: true, configurable: true });
  }
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => ({
    clearRect: () => {},
    drawImage: () => {},
    fillRect: () => {},
    fillStyle: '',
    getImageData: () => ({ data: [] }),
    measureText: () => ({ width: 0 }),
    putImageData: () => {},
    strokeRect: () => {},
  }),
});
