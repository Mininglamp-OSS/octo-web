import '@testing-library/jest-dom';

// jsdom does not implement media APIs used by PreJoin/Room; provide inert stubs
// so component tests can mount without touching real devices.
if (!(navigator as unknown as { mediaDevices?: unknown }).mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [] }),
      getDisplayMedia: async () => ({ getTracks: () => [] }),
      enumerateDevices: async () => [],
    },
  });
}

if (typeof (globalThis as unknown as { matchMedia?: unknown }).matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
