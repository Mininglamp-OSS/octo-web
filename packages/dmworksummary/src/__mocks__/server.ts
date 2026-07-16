/**
 * MSW node setup for Vitest tests.
 */
import { setupServer } from 'msw/node';
import { summaryHandlers } from './handlers';

export const server = setupServer(...summaryHandlers);
