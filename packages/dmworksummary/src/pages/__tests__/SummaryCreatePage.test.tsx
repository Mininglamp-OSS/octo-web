import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SummaryCreatePage from '../SummaryCreatePage';

vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, loading, theme, icon, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} data-theme={theme} {...rest}>
            {icon}{children}
        </button>
    ),
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Typography: { Text: ({ children }: any) => <span>{children}</span> },
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
    Avatar: ({ children }: any) => <span data-testid="avatar">{children}</span>,
    Modal: ({ children, visible }: any) => visible ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => <span data-testid="icon-plus" />,
    IconClock: () => <span data-testid="icon-clock" />,
    IconUserGroup: () => <span data-testid="icon-user-group" />,
}));

vi.mock('../../api/summaryApi', () => ({
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
    createSchedule: vi.fn().mockResolvedValue({}),
    getTopicTemplatesConfig: vi.fn().mockResolvedValue({ templates: [], custom_template_limit: 30 }),
    updateMyTopicTemplate: vi.fn().mockResolvedValue({}),
    resetMyTopicTemplate: vi.fn().mockResolvedValue({}),
    createCustomTopicTemplate: vi.fn().mockResolvedValue({}),
    updateCustomTopicTemplate: vi.fn().mockResolvedValue({}),
    deleteCustomTopicTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../components/ChatSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/MemberSelectorModal', () => ({ default: () => null }));
vi.mock('../../components/ScheduleConfigModal', () => ({ default: () => null }));

import { getTopicTemplatesConfig } from '../../api/summaryApi';

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SummaryCreatePage templates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the four fallback template cards when topic is empty', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByText('汇总项目进展')).toBeInTheDocument();
        expect(screen.getByText('跟踪任务进度')).toBeInTheDocument();
        expect(screen.getByText('总结团队周报')).toBeInTheDocument();
        expect(screen.getByText('总结聊天内容')).toBeInTheDocument();
        expect(screen.getByText('更多模板')).toBeInTheDocument();
        expect(screen.queryByText('生成个人工作周报')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('更多模板'));
        });

        expect(screen.getByText('生成个人工作周报')).toBeInTheDocument();
        expect(screen.getByText('OKR 进展对齐')).toBeInTheDocument();
        expect(screen.getByText('提取待办事项')).toBeInTheDocument();
        expect(screen.getByText('归类用户反馈')).toBeInTheDocument();
    });

    it('hides templates once the topic has content', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: '总结本周进展' } });
        });

        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
        expect(screen.queryByText('汇总项目进展')).not.toBeInTheDocument();
    });

    it('fills the topic from a fixed template on click', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('总结团队周报'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结主题: 总结团队周报\n内容重点: 总结团队成员每周工作，按成员、重点进展、成果产出、风险问题、下周计划整理');
        // templates hidden after selection
        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
    });

    it('fills the topic frame from a project progress template', async () => {
        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('汇总项目进展'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结主题: 汇总项目进展\n内容重点: 总结项目当前进展，按已完成、进行中、风险阻塞、下一步计划整理');
    });

    it('renders custom templates below builtin templates and fills topic on click', async () => {
        vi.mocked(getTopicTemplatesConfig).mockResolvedValueOnce({ custom_template_limit: 30, templates: [
            { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
            { id: 'custom_risk', label: '风险复盘', icon: 'FileText', description: '按风险点整理', type: 'fixed', pattern: '按风险、影响、负责人分点总结', is_custom: true },
        ] });

        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('我的模板 1/30')).toBeInTheDocument();
        expect(screen.getByText('风险复盘')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByText('风险复盘'));
        });

        const textarea = document.querySelector('.summary-workbench-textarea') as HTMLTextAreaElement;
        expect(textarea.value).toBe('总结主题: 风险复盘\n内容重点: 按风险点整理');
    });

    it('disables custom template creation when the configured limit is reached', async () => {
        vi.mocked(getTopicTemplatesConfig).mockResolvedValueOnce({ custom_template_limit: 1, templates: [
            { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
            { id: 'custom_risk', label: '风险复盘', icon: 'FileText', description: '按风险点整理', type: 'fixed', pattern: '按风险点整理', is_custom: true },
        ] });

        await act(async () => {
            render(<SummaryCreatePage />);
            await flushPromises();
        });

        expect(screen.getByText('我的模板 1/1')).toBeInTheDocument();
        expect(screen.getByText('已达到模板数量上限，删除旧模板后可继续新建')).toBeInTheDocument();
        expect(screen.getByText('新建模板').closest('button')).toBeDisabled();
    });

});
