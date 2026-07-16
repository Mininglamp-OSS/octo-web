import '@testing-library/jest-dom';
import { server } from '../__mocks__/server';

// Enable MSW before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
