import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import SummaryCard from './SummaryCard';
import { ParticipantStatus, TaskStatus } from '../types/summary';

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
    Tag: ({ children }: any) => <span data-testid="ai-tag">{children}</span>,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconDelete: () => <svg data-testid="delete-icon" />,
    IconExit: () => <svg data-testid="exit-icon" />,
}));

vi.mock('./TaskStatusBadge', () => ({
    default: ({ status }: { status: number }) => <span data-testid="status-badge">{status}</span>,
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
        // FE-2 fail-safe 后仅 creator_id===当前 uid('test-uid') 才显示删除。
        // 默认把当前用户设为 creator，使「删除确认文案」类用例仍走 creator 分支；
        // 测需要别的 creator_id 的用例会通过 overrides 覆盖。
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
        ...overrides,
    };
}

const noop = () => {};

afterEach(cleanup);

describe('SummaryCard attention dot', () => {
    it('needs_attention=true 时显示关注红点', () => {
        const { container } = render(
            <SummaryCard task={makeItem({ needs_attention: true }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(container.querySelector('.summary-card-attention-dot')).not.toBeNull();
    });

    it('无需关注时不显示红点', () => {
        const { container } = render(
            <SummaryCard task={makeItem({ needs_attention: false }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(container.querySelector('.summary-card-attention-dot')).toBeNull();
    });
});

describe('SummaryCard status badge', () => {
    it('当前用户有待响应邀请时统一显示等待中，而不是任务的生成中', () => {
        render(
            <SummaryCard
                task={makeItem({
                    status: TaskStatus.PROCESSING,
                    creator_id: 'someone-else',
                    participants: [
                        { user_id: 'someone-else', status: ParticipantStatus.CONFIRMED },
                        { user_id: 'test-uid', status: ParticipantStatus.PENDING },
                    ],
                }) as any}
                onClick={noop}
                onDelete={noop}
                onRespond={noop as any}
            />,
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent(String(TaskStatus.PENDING));
    });

    it('无待响应邀请时仍显示任务本身的状态', () => {
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.PROCESSING }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent(String(TaskStatus.PROCESSING));
    });

    it('定时任务首次邀请仅根据待邀请标记显示等待中', () => {
        render(
            <SummaryCard
                task={makeItem({
                    status: TaskStatus.PROCESSING,
                    schedule_id: 10,
                    has_pending_invitation: true,
                    participants: [],
                }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent(String(TaskStatus.PENDING));
    });

    it('个人总结已生成但尚未提交时显示等待中', () => {
        render(
            <SummaryCard
                task={makeItem({
                    status: TaskStatus.PROCESSING,
                    has_pending_submission: true,
                    participants: [
                        { user_id: 'test-uid', status: ParticipantStatus.CONFIRMED },
                        { user_id: 'someone-else', status: ParticipantStatus.CONFIRMED },
                    ],
                }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent(String(TaskStatus.PENDING));
    });

    it('单人总结不使用待提交标记覆盖任务完成状态', () => {
        render(
            <SummaryCard
                task={makeItem({
                    status: TaskStatus.COMPLETED,
                    has_pending_submission: true,
                    participants: [{ user_id: 'test-uid', status: ParticipantStatus.COMPLETED }],
                }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByTestId('status-badge')).toHaveTextContent(String(TaskStatus.COMPLETED));
    });
});

describe('SummaryCard display title', () => {
    it('uses the complete template content instead of the short stored title', () => {
        render(
            <SummaryCard
                task={makeItem({
                    title: '聊天内容总结',
                    topic: '总结主题：聊天内容总结\n总结内容：总结聊天中的关键内容、核心结论、待办事项和需要关注的问题',
                }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        const title = screen.getByText('总结聊天中的关键内容、核心结论、待办事项和需要关注的问题');
        expect(title).toHaveTextContent('总结聊天中的关键内容、核心结论、待办事项和需要关注的问题');
        expect(title).not.toHaveTextContent('聊天内容总结');
        expect(title).not.toHaveAttribute('title');
    });
});

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

describe('SummaryCard creator vs participant footer (问题1)', () => {
    // dmworkBase mock 的 WKApp.loginInfo.uid === 'test-uid'。
    it('creator（creator_id === 当前用户）看到删除按钮 + 删除文案', () => {
        const onDelete = vi.fn();
        const onLeave = vi.fn();
        render(
            <SummaryCard
                task={makeItem({ creator_id: 'test-uid' }) as any}
                onClick={noop}
                onDelete={onDelete}
                onLeave={onLeave}
            />,
        );
        // 删除图标存在，退出图标不存在。
        expect(screen.getByTestId('delete-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('exit-icon')).not.toBeInTheDocument();
        const content = screen.getByTestId('popconfirm-content');
        expect(content).toHaveTextContent('确定要删除');
    });

    it('非 creator 参与者看到退出按钮 + 退出文案', () => {
        const onDelete = vi.fn();
        const onLeave = vi.fn();
        render(
            <SummaryCard
                task={makeItem({
                    creator_id: 'someone-else',
                    participants: [
                        { user_id: 'someone-else' },
                        { user_id: 'test-uid' },
                    ],
                }) as any}
                onClick={noop}
                onDelete={onDelete}
                onLeave={onLeave}
            />,
        );
        // 退出图标存在，删除图标不存在。
        expect(screen.getByTestId('exit-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('delete-icon')).not.toBeInTheDocument();
        const content = screen.getByTestId('popconfirm-content');
        expect(content).toHaveTextContent('退出后将不再参与该多人协作');
    });

    // FE-2（fail-safe）：creator_id 缺失（null/undefined）时【不】当 creator，
    // 不显示「删除整个任务」破坏性入口；是参与者则只显示退出。
    it('creator_id 为 null 时，非 creator（参与者）不显示删除，只显示退出（fail-safe）', () => {
        const onDelete = vi.fn();
        const onLeave = vi.fn();
        render(
            <SummaryCard
                task={makeItem({
                    creator_id: null,
                    participants: [
                        { user_id: 'someone-else' },
                        { user_id: 'test-uid' },
                    ],
                }) as any}
                onClick={noop}
                onDelete={onDelete}
                onLeave={onLeave}
            />,
        );
        // creator_id 缺失 → 不当 creator → 不显示删除按钮。
        expect(screen.queryByTestId('delete-icon')).not.toBeInTheDocument();
        // 作为参与者只显示退出。
        expect(screen.getByTestId('exit-icon')).toBeInTheDocument();
    });

    it('creator_id 为 undefined 时，非参与者不显示删除也不显示退出（fail-safe，无破坏性入口）', () => {
        const onDelete = vi.fn();
        const onLeave = vi.fn();
        render(
            <SummaryCard
                task={makeItem({
                    creator_id: undefined,
                    participants: [{ user_id: 'someone-else' }],
                }) as any}
                onClick={noop}
                onDelete={onDelete}
                onLeave={onLeave}
            />,
        );
        // creator_id 缺失 + 非参与者 → 既不删除也不退出。
        expect(screen.queryByTestId('delete-icon')).not.toBeInTheDocument();
        expect(screen.queryByTestId('exit-icon')).not.toBeInTheDocument();
    });
});

describe('SummaryCard AI Generated Badge', () => {
    it('trigger_type === 3 (AGENT) 时显示对话生成徽标', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '对话生成总结', trigger_type: 3 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        // 检查对话生成徽标 Tag 组件是否存在
        const aiTag = screen.getByTestId('ai-tag');
        expect(aiTag).toBeInTheDocument();
        expect(aiTag).toHaveTextContent('🤖');
    });

    it('trigger_type === 1 (MANUAL) 时不显示对话生成徽标', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '手动总结', trigger_type: 1 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.queryByText(/对话生成/)).not.toBeInTheDocument();
        expect(screen.queryByText(/🤖/)).not.toBeInTheDocument();
    });

    it('trigger_type === 2 (SCHEDULED) 时不显示对话生成徽标', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '定时总结', trigger_type: 2 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.queryByText(/对话生成/)).not.toBeInTheDocument();
    });
});
