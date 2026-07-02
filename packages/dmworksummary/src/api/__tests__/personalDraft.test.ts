import { describe, it, expect, vi, beforeEach } from 'vitest';

// OCT-21 Stage 4 (v2 F1) — personalDraftSummary must NOT reuse the `put` helper,
// because that helper rethrows `new Error(extractErrorMessage(err))` and drops
// `response.status`. SummaryEditor.handleSave's 409 branch hard-depends on
// `error.status === 409`, so the draft API has to attach the HTTP status onto the
// thrown Error (mirroring editSummary). These tests pin that contract.

const { mockPut } = vi.hoisted(() => ({ mockPut: vi.fn() }));

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: vi.fn(),
            post: vi.fn(),
            put: mockPut,
            delete: vi.fn(),
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() },
            },
        }),
        isCancel: (err: unknown) => !!(err as { __CANCEL__?: boolean })?.__CANCEL__,
    },
}));

import { personalDraftSummary } from '../summaryApi';

describe('personalDraftSummary (v2 F1: HTTP status passthrough)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('PUTs to /summaries/:id/personal-draft with {content} and resolves on 200', async () => {
        mockPut.mockResolvedValueOnce({ data: { data: {} } });
        await expect(personalDraftSummary(42, 'my draft [1]')).resolves.toBeUndefined();
        expect(mockPut).toHaveBeenCalledWith(
            '/summary/api/v1/summaries/42/personal-draft',
            { content: 'my draft [1]' },
        );
    });

    it('attaches error.status = 409 when the backend rejects with HTTP 409 (already submitted)', async () => {
        mockPut.mockRejectedValueOnce({
            response: { status: 409, data: { message: '草稿已被提交，请刷新后改走编辑接口' } },
        });
        try {
            await personalDraftSummary(42, 'late draft');
            throw new Error('expected personalDraftSummary to reject');
        } catch (err) {
            const e = err as Error & { status?: number };
            expect(e.status).toBe(409); // load-bearing: SummaryEditor 409 branch depends on this
            expect(e.message).toContain('草稿已被提交');
        }
    });

    it('passes through other HTTP statuses too (e.g. 500) so callers can branch', async () => {
        mockPut.mockRejectedValueOnce({
            response: { status: 500, data: { message: 'internal error' } },
        });
        try {
            await personalDraftSummary(7, 'x');
            throw new Error('expected reject');
        } catch (err) {
            const e = err as Error & { status?: number };
            expect(e.status).toBe(500);
        }
    });

    it('rethrows cancellations preserving axios.isCancel identity', async () => {
        const cancelErr = { __CANCEL__: true, message: 'canceled' };
        mockPut.mockRejectedValueOnce(cancelErr);
        await expect(personalDraftSummary(1, 'x')).rejects.toBe(cancelErr);
    });
});
