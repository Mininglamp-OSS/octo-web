import "@testing-library/jest-dom";
import { localeCookieName, localeStorageKey } from "../i18n/detectLocale";
import { afterEach } from "vitest";
import { cleanup } from "./testingLibraryReact17";

afterEach(() => {
  cleanup();
});

if (typeof HTMLCanvasElement !== "undefined") {
  const canvasContext = new Proxy({}, { get: () => () => undefined });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  });
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: MockResizeObserver,
  });
}

// Node 26 + vitest 4 + jsdom: jsdom no longer exposes `window.localStorage`
// unless launched with `--localstorage-file`, and Node's built-in
// `sessionStorage` is on globalThis but not mirrored onto `window`. Older
// tests in this package (and the wider octo-web codebase) use bare
// `localStorage.setItem(...)` / `sessionStorage.clear()` and would otherwise
// blow up before the first expectation. Install a small in-memory polyfill
// for `localStorage` and mirror `sessionStorage` onto `window` so every
// spelling — `localStorage`, `window.localStorage`, `globalThis.localStorage`
// — resolves to the same object.
function installMemoryStorage(): Storage {
  const store = new Map<string, string>();
  const api: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key) { return store.has(key) ? (store.get(key) as string) : null; },
    key(index) {
      const keys = Array.from(store.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    removeItem(key) { store.delete(key); },
    setItem(key, value) { store.set(key, String(value)); },
  };
  return api;
}

if (typeof window !== "undefined") {
  if (typeof (window as any).localStorage === "undefined" || (window as any).localStorage === null) {
    const ls = installMemoryStorage();
    Object.defineProperty(window, "localStorage", { configurable: true, value: ls });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ls });
  }
  // Mirror Node's built-in sessionStorage onto window if jsdom didn't.
  if (typeof (window as any).sessionStorage === "undefined") {
    const ss = (globalThis as any).sessionStorage ?? installMemoryStorage();
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: ss });
    if (typeof (globalThis as any).sessionStorage === "undefined") {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: ss });
    }
  }
}

try {
  window.localStorage.setItem(localeStorageKey, "zh-CN");
  document.cookie = `${localeCookieName}=zh-CN`;
} catch (_) {
  // Tests that stub window/document can ignore locale persistence.
}
