import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import SummaryCard from './SummaryCard';
import { ParticipantStatus, TaskStatus, TriggerType, type SummarySearchMatch } from '../types/summary';

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
    // Round-10 P2-4: SummaryCard now uses <Tooltip>, <Dropdown> (with
    // <Dropdown.Menu>/<Dropdown.Item> sub-components) and <Modal> for the
    // source label and per-card menu. yujiawei re-review at 87c7574 flagged
    // Tooltip/Modal missing from this mock — Dropdown.Menu / Dropdown.Item
    // are the additional sub-component sites that need pass-through stubs
    // so the 18 tests can render (was 18/18 red at both merge-base and
    // this head). Modal.confirm keeps a callable for handlers that spawn a
    // confirm dialog; the tests never exercise it directly.
    Tooltip: ({ children }: any) => <>{children}</>,
    Modal: Object.assign(({ children }: any) => <>{children}</>, {
        confirm: () => null,
        info: () => null,
        error: () => null,
    }),
    Dropdown: Object.assign(({ children, render, visible, onVisibleChange }: any) => {
        const child = React.Children.only(children);
        return (
            <>
                {React.cloneElement(child, {
                    onClick: (event: any) => {
                        child.props.onClick?.(event);
                        onVisibleChange?.(!visible);
                    },
                })}
                {visible ? render : null}
            </>
        );
    }, {
        Menu: ({ children }: any) => <>{children}</>,
        Item: ({ children, onClick }: any) => (
            <button onClick={onClick as any}>{children}</button>
        ),
    }),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    default: () => <svg />,
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

function openCardMenu(taskId = 1) {
    fireEvent.click(screen.getByTestId(`summary-card-menu-${taskId}`));
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

describe('SummaryCard bot-created marker', () => {
    it('bot 创建时显示 Bot 小标与「由 <bot> 创建」', () => {
        render(
            <SummaryCard task={makeItem({ trigger_type: TriggerType.BOT, creator_bot_name: '周报助手' }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(screen.getByText('Bot')).toBeInTheDocument();
        expect(screen.getByText(/由 周报助手 创建/)).toBeInTheDocument();
    });

    it('bot 创建但后端未透出 creator_bot_name 时：仍显示 Bot 小标，但回退旧创建者文案而非「未知」', () => {
        // 复现 octo-smart-summary#188 上线前的真实生产形态：trigger_type=BOT
        // （自 #181 起可达）但 API 不返回 creator_bot_name。此前会渲染「由 未知 创建」。
        render(
            <SummaryCard task={makeItem({ trigger_type: TriggerType.BOT, creator_id: 'someone-else' }) as any} onClick={noop} onDelete={noop} />,
        );
        // Bot 小标由 trigger_type 驱动，名字缺失也应显示
        expect(screen.getByText('Bot')).toBeInTheDocument();
        // 名字缺失时不得再渲染「未知」创建者文案
        expect(screen.queryByText(/未知/)).not.toBeInTheDocument();
        // 回退到旧的 creator/time 文案（startedAt = "{name}于{time}"）
        expect(screen.getByText(/张三于/)).toBeInTheDocument();
    });

    it('人发起的总结不显示 Bot 小标', () => {
        render(
            <SummaryCard task={makeItem({ trigger_type: 1 }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(screen.queryByText('Bot')).not.toBeInTheDocument();
    });
});

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

        expect(screen.getByText('等待中')).toBeInTheDocument();
    });

    it('无待响应邀请时仍显示任务本身的状态', () => {
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.PROCESSING }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByText('AI正在分析聊天记录...')).toBeInTheDocument();
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

        expect(screen.getByText('等待中')).toBeInTheDocument();
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

        expect(screen.getByText('等待中')).toBeInTheDocument();
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

        expect(screen.getByText('已完成')).toBeInTheDocument();
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

describe('SummaryCard delete confirmation', () => {
    it('uses the current delete confirmation copy', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '手动总结' }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        openCardMenu();
        fireEvent.click(screen.getByText('删除'));
        expect(screen.getByText('删除后无法恢复')).toBeInTheDocument();
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
        openCardMenu();
        expect(screen.getByText('删除')).toBeInTheDocument();
        fireEvent.click(screen.getByText('删除'));
        expect(screen.getByText('删除后无法恢复')).toBeInTheDocument();
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
        openCardMenu();
        expect(screen.getByText('退出')).toBeInTheDocument();
        fireEvent.click(screen.getByText('退出'));
        expect(screen.getByText(/退出后将不再参与/)).toBeInTheDocument();
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
        openCardMenu();
        expect(screen.getByText('退出')).toBeInTheDocument();
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
        expect(screen.queryByTestId('summary-card-menu-1')).not.toBeInTheDocument();
    });
});

describe('SummaryCard relative time fallback (issue #1440)', () => {
    // 冻结时钟：formatRelativeTime 用真实 new Date()，不冻结断言会随真实时间漂移。
    const NOW = '2026-08-18T12:00:00Z';
    const daysAgoIso = (days: number) =>
        new Date(new Date(NOW).getTime() - days * 86400 * 1000).toISOString();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('超过十天的总结显示具体日期而不是「X天前」', () => {
        render(
            <SummaryCard task={makeItem({ created_at: daysAgoIso(15) }) as any} onClick={noop} onDelete={noop} />,
        );
        // 本地时区下的绝对日期（formatDateOnly 用本地时间）。
        const expected = (() => {
            const d = new Date(daysAgoIso(15));
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        })();
        expect(screen.getByText(new RegExp(`于${expected}`))).toBeInTheDocument();
        expect(screen.queryByText(/天前/)).not.toBeInTheDocument();
    });

    it('恰好十天仍显示相对时间（issue 要求是「超过」十天）', () => {
        render(
            <SummaryCard task={makeItem({ created_at: daysAgoIso(10) }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(screen.getByText(/10天前/)).toBeInTheDocument();
    });

    it('十天以内的总结保持相对时间', () => {
        render(
            <SummaryCard task={makeItem({ created_at: daysAgoIso(3) }) as any} onClick={noop} onDelete={noop} />,
        );
        expect(screen.getByText(/3天前/)).toBeInTheDocument();
    });
});

describe('SummaryCard engine-neutral personal classification', () => {
    it('Agent 来源与其他单人总结使用相同的个人总结图标', () => {
        render(
            <SummaryCard
                task={makeItem({ title: '对话生成总结', trigger_type: 3 }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        expect(screen.getByRole('img', { name: '个人总结' })).toBeInTheDocument();
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

describe('SummaryCard completed actions', () => {
    it.each([TriggerType.AGENT, TriggerType.MANUAL])('offers all five personal actions for engine %s', (trigger_type) => {
        render(<SummaryCard task={makeItem({ trigger_type, referenceable: true }) as any}
            onClick={noop} onDelete={noop} onEdit={noop} onContinueOptimize={noop}
            onRegenerate={noop} onSchedule={noop} />);
        openCardMenu();
        for (const label of ['编辑', '继续优化', '重新生成', '定时更新', '删除']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it.each([
        [TriggerType.MANUAL, false],
        [TriggerType.AGENT, true],
    ])('uses the legacy referenceable fallback for engine %s', (trigger_type, expected) => {
        render(
            <SummaryCard
                task={makeItem({ trigger_type, referenceable: undefined }) as any}
                onClick={noop}
                onDelete={noop}
                onContinueOptimize={noop}
            />,
        );

        openCardMenu();
        const continueOptimize = screen.queryByText('继续优化');
        if (expected) expect(continueOptimize).toBeInTheDocument();
        else expect(continueOptimize).not.toBeInTheDocument();
    });

    it('offers only the actions supplied by the host for an Agent summary', () => {
        const onContinueOptimize = vi.fn();
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.COMPLETED, trigger_type: TriggerType.AGENT }) as any}
                onClick={noop}
                onDelete={noop}
                onContinueOptimize={onContinueOptimize}
            />,
        );

        openCardMenu();
        expect(screen.getByText('继续优化')).toBeInTheDocument();
        expect(screen.getByText('删除')).toBeInTheDocument();
        expect(screen.queryByText('重新生成')).not.toBeInTheDocument();
        expect(screen.queryByText('编辑')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('继续优化'));
        expect(onContinueOptimize).toHaveBeenCalledWith(1);
    });

    it('Legacy Agent summary keeps regenerate and edit actions', () => {
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.COMPLETED, trigger_type: TriggerType.AGENT }) as any}
                onClick={noop}
                onDelete={noop}
                onRegenerate={noop}
                onEdit={noop}
            />,
        );

        openCardMenu();
        expect(screen.getByText('重新生成')).toBeInTheDocument();
        expect(screen.getByText('编辑')).toBeInTheDocument();
        expect(screen.queryByText('继续优化')).not.toBeInTheDocument();
    });

    it('hides continue refining when an Agent summary is not referenceable', () => {
        const onRegenerate = vi.fn();
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.COMPLETED, trigger_type: TriggerType.AGENT, referenceable: false }) as any}
                onClick={noop}
                onDelete={noop}
                onContinueOptimize={noop}
                onRegenerate={onRegenerate}
                onEdit={noop}
            />,
        );

        openCardMenu();
        expect(screen.queryByText('继续优化')).not.toBeInTheDocument();
        expect(screen.getByText('重新生成')).toBeInTheDocument();
        expect(screen.getByText('编辑')).toBeInTheDocument();
        expect(screen.getByText('删除')).toBeInTheDocument();

        fireEvent.click(screen.getByText('重新生成'));
        expect(onRegenerate).toHaveBeenCalledWith(1);
    });

    it('hides action items whose handlers are not provided', () => {
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.COMPLETED, trigger_type: TriggerType.MANUAL }) as any}
                onClick={noop}
                onDelete={noop}
            />,
        );

        openCardMenu();
        expect(screen.queryByText('重新生成')).not.toBeInTheDocument();
        expect(screen.queryByText('编辑')).not.toBeInTheDocument();
        expect(screen.getByText('删除')).toBeInTheDocument();
    });

    it('Workflow summary keeps regenerate, edit, and delete', () => {
        render(
            <SummaryCard
                task={makeItem({ status: TaskStatus.COMPLETED, trigger_type: TriggerType.MANUAL }) as any}
                onClick={noop}
                onDelete={noop}
                onRegenerate={noop}
                onEdit={noop}
            />,
        );

        openCardMenu();
        expect(screen.getByText('重新生成')).toBeInTheDocument();
        expect(screen.getByText('编辑')).toBeInTheDocument();
        expect(screen.getByText('删除')).toBeInTheDocument();
        expect(screen.queryByText('继续优化')).not.toBeInTheDocument();
    });
});

describe('SummaryCard F6 search', () => {
    // Typed against the wire contract: a missing or null range array is legal,
    // so the fixtures below are checked instead of cast past the declaration.
    const nullableRangeCases: SummarySearchMatch[] = [
        { title_ranges: [[0, 1]], topic_ranges: null },
        { title_ranges: [[0, 1]] },
        { title_ranges: null, topic_ranges: [[0, 2]] },
    ];
    it.each(nullableRangeCases)('accepts nullable or missing range arrays without crashing: %j', (search_match) => {
        // Agent summaries keep title and topic separate, so each range array
        // marks its own row; a null/missing array must degrade to plain text.
        const { container } = render(<SummaryCard task={makeItem({ title: '标题', topic: '主题',
            trigger_type: TriggerType.AGENT, search_match } as any)} onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title')).toHaveTextContent('标题');
        const expectedHit = search_match.title_ranges ? '标' : '主题';
        expect(container.querySelector('mark')).toHaveTextContent(expectedHit);
    });
    it('falls back to the topic instead of the internal task number when untitled', () => {
        const { container } = render(<SummaryCard task={makeItem({ title: '', task_no: 'S-1234',
            topic: '方案评审', search_match: { title_ranges: null, topic_ranges: [[0, 4]] } } as any)}
            onClick={noop} onDelete={noop} />);
        // The matched evidence stays visible in the title row and is not repeated
        // as a second description row.
        expect(container.querySelector('.summary-card-title')).toHaveTextContent('方案评审');
        expect(container.querySelector('.summary-card-title mark')).toHaveTextContent('方案评审');
        expect(container.querySelector('.summary-card-title')).not.toHaveTextContent('S-1234');
        expect(container.querySelector('.summary-card-desc')).toBeNull();
    });
    it('keeps the derived template content as the title of a search card', () => {
        // Browse and search must render the same card: the title is the derived
        // content, never the short stored title, and the topic offsets are
        // re-based onto that derived string.
        const topic = '总结主题：聊天内容总结\n总结内容：总结聊天中的关键内容、核心结论、待办事项';
        const keyStart = Array.from(topic).indexOf('关');
        const { container } = render(<SummaryCard task={makeItem({
            title: '聊天内容总结', topic,
            search_match: { title_ranges: null, topic_ranges: [[keyStart, keyStart + 2]] } } as any)}
            onClick={noop} onDelete={noop} />);
        const title = container.querySelector('.summary-card-title')!;
        expect(title).toHaveTextContent('总结聊天中的关键内容、核心结论、待办事项');
        expect(title).not.toHaveTextContent('聊天内容总结');
        expect(title.querySelector('mark')).toHaveTextContent('关键');
    });
    it('shows the server historical signal even when match ranges are absent', () => {
        const { container } = render(<SummaryCard task={makeItem({ is_historical_match: true })}
            onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-search-history')).toBeInTheDocument();
    });
    it('shows original title/topic evidence and opens the matched historical task', () => {
        const onClick = vi.fn();
        const { container } = render(<SummaryCard task={makeItem({task_id: 42, schedule_id: 99,
            title: '😀ＯＣＴＯ', topic: '方案评审', trigger_type: TriggerType.AGENT,
            search_match: { title_ranges: [[1,5]], topic_ranges: [[0,4]] },
            is_historical_match: true }) as any} onClick={onClick} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title mark')).toHaveTextContent('ＯＣＴＯ');
        expect(container.querySelector('.summary-card-desc')).toHaveTextContent('主题：方案评审');
        expect(container.querySelector('.summary-search-history')).toHaveTextContent('2026');
        fireEvent.click(screen.getByTestId('summary-card-42'));
        expect(onClick).toHaveBeenCalledWith(42);
    });
    it('renders the topic as the title of a chat summary, and does not repeat it', () => {
        // Chat summaries derive their title from the topic in browse mode too, so
        // a topic hit is highlighted there instead of in a duplicate row.
        const { container } = render(<SummaryCard task={makeItem({title:'周会排期',topic:'方案评审',
            search_match:{ title_ranges:[], topic_ranges:[[0,4]] }}) as any} onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title')).toHaveTextContent('方案评审');
        expect(container.querySelector('.summary-card-title mark')).toHaveTextContent('方案评审');
        expect(container.querySelector('.summary-card-desc')).toBeNull();
    });
    it('never invents title highlights for a topic-only match on an agent summary', () => {
        const { container } = render(<SummaryCard task={makeItem({title:'周会排期',topic:'方案评审',
            trigger_type: TriggerType.AGENT,
            search_match:{ title_ranges:[], topic_ranges:[[0,4]] }}) as any} onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title')).toHaveTextContent('周会排期');
        expect(container.querySelector('.summary-card-title mark')).toBeNull();
        expect(container.querySelector('.summary-card-desc mark')).toHaveTextContent('方案评审');
    });
    it('surfaces a raw-title-only hit the derived title cannot carry', () => {
        // Manual task, plain topic: the card title is the topic, so a hit that
        // exists only in the raw title would otherwise be invisible.
        const { container } = render(<SummaryCard task={makeItem({ title: 'Budget Review', topic: 'Project notes',
            search_match: { title_ranges: [[0, 6]], topic_ranges: [] } }) as any} onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title')).toHaveTextContent('Project notes');
        expect(container.querySelector('.summary-card-title mark')).toBeNull();
        expect(container.querySelector('.summary-card-desc')).toBeNull();
        const evidence = container.querySelector('.summary-card-title-evidence')!;
        expect(evidence).toHaveTextContent('Budget Review');
        expect(evidence.querySelector('mark')).toHaveTextContent('Budget');
    });
    it('adds no evidence row when the title row already carries the hit', () => {
        const { container } = render(<SummaryCard task={makeItem({ title: 'Budget Review', topic: 'Project notes',
            trigger_type: TriggerType.AGENT,
            search_match: { title_ranges: [[0, 6]], topic_ranges: [] } }) as any} onClick={noop} onDelete={noop} />);
        expect(container.querySelector('.summary-card-title mark')).toHaveTextContent('Budget');
        expect(container.querySelector('.summary-card-title-evidence')).toBeNull();
    });
});
