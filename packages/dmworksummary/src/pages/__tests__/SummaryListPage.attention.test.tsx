import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Input: () => null,
    Select: () => null,
    Spin: () => null,
    Pagination: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
    Tooltip: () => null,
}));
vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => null,
    IconPlus: () => null,
    IconRefresh: () => null,
}));
vi.mock('../../components/SummaryCard', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import * as api from '../../api/summaryApi';
import SummaryListPage from '../SummaryListPage';

function makePage(item: Record<string, unknown>, attentionCount: number) {
    const page = new SummaryListPage({});
    (page as any).state = {
        ...(page.state as any),
        items: [{ task_id: 1, ...item }],
    };
    (page as any).attentionCount = attentionCount;
    (page as any).setState = function (this: any, patch: any) {
        this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    };
    return page;
}

describe('SummaryListPage attention synchronization', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps the optimistic count aligned so the next poll does not reload the list', async () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ attention_count: 2, items: [], total: 0 } as any);
        const page = makePage({ is_unread: true, has_pending_invitation: false, needs_attention: true }, 3);
        const loadData = vi.spyOn(page, 'loadData').mockResolvedValue(undefined);

        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: false, needsAttention: false },
        }));
        (page as any).handleAttentionCountRefreshed_({ count: 2 });
        await Promise.resolve();

        expect((page as any).attentionCount).toBe(2);
        expect((page.state as any).items[0]).toMatchObject({ is_unread: false, needs_attention: false });
        expect(loadData).not.toHaveBeenCalled();
    });

    it('uses the server response instead of clearing other unread cursors or pending attention', () => {
        vi.mocked(api.listSummaries).mockResolvedValue({ attention_count: 3, items: [], total: 0 } as any);
        const page = makePage({ is_unread: true, has_pending_invitation: true, needs_attention: true }, 3);

        // A team cursor may be read while a personal cursor remains unread.
        (page as any).handleSummaryRead_(new CustomEvent('summary-read', {
            detail: { taskId: 1, isUnread: true, needsAttention: true },
        }));

        expect((page.state as any).items[0]).toMatchObject({ is_unread: true, needs_attention: true });
        expect((page as any).attentionCount).toBe(3);
    });
});
