import "@testing-library/jest-dom/vitest";

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

if (typeof HTMLCanvasElement !== "undefined") {
  const canvasContext = new Proxy({}, { get: () => () => undefined });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  });
}
