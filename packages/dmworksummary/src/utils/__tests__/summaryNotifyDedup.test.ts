import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    hasSentSummaryNotify,
    markSummaryNotifySent,
    summaryNotifyCompletionKey,
    withSummaryNotifyLock,
} from '../summaryHelpers';

describe('summary notify completion dedup', () => {
    beforeEach(() => localStorage.clear());

    it('keys by result run and falls back to updated_at', () => {
        expect(summaryNotifyCompletionKey({ task_id: 7, result_id: 11, updated_at: 'later' }))
            .toBe('7:result:11');
        expect(summaryNotifyCompletionKey({ task_id: 7, updated_at: '2026-08-05T00:00:00Z' }))
            .toBe('7:updated:2026-08-05T00:00:00Z');
        expect(summaryNotifyCompletionKey({ task_id: 7 })).toBeNull();
    });

    it('separates sources and completion runs', () => {
        markSummaryNotifySent('7:result:11', 'group-a');
        expect(hasSentSummaryNotify('7:result:11', 'group-a')).toBe(true);
        expect(hasSentSummaryNotify('7:result:11', 'group-b')).toBe(false);
        expect(hasSentSummaryNotify('7:result:12', 'group-a')).toBe(false);
    });

    it('uses a cross-tab Web Lock when available', async () => {
        const request = vi.fn(async (_name: string, action: () => Promise<string>) => action());
        const previous = navigator.locks;
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
        try {
            await expect(withSummaryNotifyLock('run:group', async () => 'sent')).resolves.toBe('sent');
            expect(request).toHaveBeenCalledWith('octo-summary-notify:run:group', expect.any(Function));
        } finally {
            Object.defineProperty(navigator, 'locks', { configurable: true, value: previous });
        }
    });
});
