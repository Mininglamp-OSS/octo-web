// Test stub for lottie-web. Semi UI pulls it in transitively; its top-level
// canvas init throws under jsdom (no getContext). Aliased in vite.config so
// Semi components can mount in unit tests — we assert on DOM, not animations.
const noop = () => {};

export default {
  loadAnimation: () => ({
    play: noop,
    stop: noop,
    pause: noop,
    destroy: noop,
    goToAndStop: noop,
    addEventListener: noop,
    removeEventListener: noop,
  }),
  setQuality: noop,
  destroy: noop,
};
