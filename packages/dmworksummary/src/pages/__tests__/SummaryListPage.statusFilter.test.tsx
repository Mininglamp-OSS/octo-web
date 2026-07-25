import { describe, expect, it, vi } from 'vitest';

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

import { TaskStatus } from '../../types/summary';
import { getStatusOptions } from '../SummaryListPage';

describe('SummaryListPage status filter', () => {
    it('hides the participant-confirmation phase but keeps the cancelled terminal state', () => {
        const values = getStatusOptions().map((option) => option.value);

        expect(values).not.toContain(TaskStatus.WAITING_CONFIRM);
        expect(values).toContain(TaskStatus.CANCELLED);
        expect(values).toEqual([
            '',
            TaskStatus.PENDING,
            TaskStatus.PROCESSING,
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
        ]);
    });
});
