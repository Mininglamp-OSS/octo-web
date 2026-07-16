/**
 * MSW browser setup for development and testing.
 * 
 * NOTE: This file is NOT automatically mounted in the workspace package.
 * To enable browser-side mocking, import and start this worker in your app entry point:
 * 
 * ```typescript
 * if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MSW) {
 *   const { worker } = await import('@dmwork/summary/src/__mocks__/browser');
 *   await worker.start({ onUnhandledRequest: 'bypass' });
 * }
 * ```
 * 
 * The main app (e.g., apps/web) should also run `npx msw init <public-dir>` to generate
 * the mockServiceWorker.js file required by Service Worker API.
 */
import { setupWorker } from 'msw/browser';
import { summaryHandlers } from './handlers';

export const worker = setupWorker(...summaryHandlers);
