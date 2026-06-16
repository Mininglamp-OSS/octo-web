import React from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SummaryCard from './SummaryCard';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../__mocks__/dmworkBase');
    return { ...actual };
});

// Popconfirm 暴露 content，便于断言不同分支下的删除确认文案。
vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ icon, onClick }: any) => (
        <button data-testid="delete-btn" onClick={onClick}>{icon}</button>
    ),
    Popconfirm: ({ children, content }: any) => (
        <span data-testid="popconfirm">
            <span data-testid="popconfirm-content">{content}</span>
            {children}
        </span>
    ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconDelete: () => <svg data-testid="delete-icon" />,
}));

vi.mock('./TaskStatusBadge', () => ({
    default: () => <span data-testid="status-badge" />,
}));

vi.mock('./OverflowTooltip', () => ({
    default: ({ children }: any) => <span>{children}</span>,
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function makeItem(overrides: Record<string, unknown> = {}) {
    return {
        task_id: 1,
        task_no: 'T001',
        title: '测试总结',
        summary_mode: 1,
        status: 3,
        trigger_type: 1,
        time_range_start: '2026-01-01T00:00:00Z',
        time_range_end: '2026-01-02T00:00:00Z',
        sources: [{ source_type: 1, source_id: 's1' }],
        total_msg_count: 10,
        creator_name: '张三',
        origin_channel_id: 'ch1',
        origin_channel_type: 2,
        created_at: '2026-01-01T09:30:00Z',
        completed_at: '2026-01-01T10:00:00Z',
        ...overrides,
    };
}

const noop = () => {};

describe('SummaryCard isScheduledTask', () => {
    it('schedule_id > 0 时使用定时删除确认文案', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '定时总结', schedule_id: 5, trigger_type: 1 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        const content = screen.getByTestId('popconfirm-content');
        expect(content).toHaveTextContent('是定时更新的总结');
        expect(content).not.toHaveTextContent('历史版本也将一并清除');
    });

    it('trigger_type === 2 且无 schedule_id 时走兜底定时分支', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '调度生成总结', schedule_id: undefined, trigger_type: 2 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        const content = screen.getByTestId('popconfirm-content');
        expect(content).toHaveTextContent('是定时更新的总结');
    });

    it('普通手动任务使用普通删除确认文案', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '手动总结', schedule_id: undefined, trigger_type: 1 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        const content = screen.getByTestId('popconfirm-content');
        expect(content).toHaveTextContent('历史版本也将一并清除');
        expect(content).not.toHaveTextContent('是定时更新的总结');
    });
});
