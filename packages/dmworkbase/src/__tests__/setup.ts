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

try {
  window.localStorage.setItem(localeStorageKey, "zh-CN");
  document.cookie = `${localeCookieName}=zh-CN`;
} catch (_) {
  // Tests that stub window/document can ignore locale persistence.
}
