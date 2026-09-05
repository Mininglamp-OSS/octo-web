// P1-3 (yujiawei review 5087124100): the envelope demanded data === null for
// the empty-history case; a backend that OMITS `data` entirely (Go omitempty
// idiom) made getSummaryWorkspaceHistory throw "Summary workspace response
// has no data" — a protocol-error banner on a brand-new workbench instead of
// the blank canvas.
//
// This regression locks the accepted omitted-data contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: mockGet,
      interceptors: { request: { use: () => undefined }, response: { use: () => undefined } },
    }),
    get: mockGet,
    isCancel: () => false,
  },
}));

vi.mock('@octo/base', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
  return actual;
});

describe('summaryApi — omitted data on the empty-history envelope is tolerated (P1-3)', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('getSummaryWorkspaceHistory returns null for {code:0,message:"ok"} with NO data key', async () => {
    const { getSummaryWorkspaceHistory } = await import('../summaryApi');
    mockGet.mockResolvedValue({ data: { code: 0, message: 'ok' } }); // no `data` key
    const result = await getSummaryWorkspaceHistory('session-empty');
    expect(result).toBeNull();
  });

  it('still returns null for an explicit data:null (existing contract)', async () => {
    const { getSummaryWorkspaceHistory } = await import('../summaryApi');
    mockGet.mockResolvedValue({ data: { code: 0, message: 'ok', data: null } });
    const result = await getSummaryWorkspaceHistory('session-empty');
    expect(result).toBeNull();
  });
});
