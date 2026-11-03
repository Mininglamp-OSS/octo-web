import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SummaryCard from './SummaryCard';
import { TriggerType } from '../types/summary';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../__mocks__/dmworkBase');
    return { ...actual };
});

/**
 * Semi's Tooltip declares `content` as PropTypes.node and renders it as a React
 * child (lib/es/tooltip/index.js renderContentNode), with no innerHTML path in
 * the module. Rendering that prop here proves the card hands over React nodes:
 * an HTML string would surface as escaped text and produce no <mark> element.
 */
vi.mock('@douyinfe/semi-ui', () => ({
    Dropdown: Object.assign(({ children }: any) => <>{children}</>, {
        Menu: ({ children }: any) => <>{children}</>,
        Item: ({ children }: any) => <>{children}</>,
    }),
    Modal: Object.assign(({ children }: any) => <>{children}</>, {
        confirm: () => null,
        info: () => null,
        error: () => null,
    }),
    Tooltip: ({ content, children }: any) => (
        <>{children}<span data-testid="tooltip-content">{content}</span></>
    ),
}));

const baseTask = {
    task_id: 1,
    task_no: 'T001',
    title: 'Budget Review',
    summary_mode: 1,
    status: 3,
    trigger_type: 1,
    creator_id: 'test-uid',
    time_range_start: '2026-01-01T00:00:00Z',
    time_range_end: '2026-01-02T00:00:00Z',
    sources: [{ source_type: 1, source_id: 's1' }],
    total_msg_count: 10,
    creator_name: '张三',
    origin_channel_id: 'ch1',
    origin_channel_type: 2,
    created_at: '2026-01-01T09:30:00Z',
    completed_at: '2026-01-01T10:00:00Z',
};

describe('SummaryCard tooltip content', () => {
    it('hands the tooltip React nodes instead of an HTML string', () => {
        const { container } = render(<SummaryCard
            task={{ ...baseTask, topic: 'Project notes', trigger_type: TriggerType.AGENT,
                search_match: { title_ranges: [[0, 6]], topic_ranges: [[0, 7]] } } as any}
            onClick={() => {}} onDelete={() => {}} />);

        const tooltips = Array.from(container.querySelectorAll('[data-testid="tooltip-content"]'));
        expect(tooltips.length).toBeGreaterThan(0);
        expect(tooltips.some(node => node.querySelector('mark') !== null)).toBe(true);
        for (const node of tooltips) expect(node.textContent).not.toContain('<mark');
    });
});
