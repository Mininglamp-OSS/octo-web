import "@testing-library/jest-dom/vitest";

// jsdom does not implement canvas. Shared UI imports can pull in lottie-web,
// which writes to canvas.getContext("2d").fillStyle during module init.
if (typeof HTMLCanvasElement !== "undefined") {
  const context2d = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
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
  } as unknown as CanvasRenderingContext2D;

  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    if (contextId === "2d") return context2d;
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
}

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

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});
