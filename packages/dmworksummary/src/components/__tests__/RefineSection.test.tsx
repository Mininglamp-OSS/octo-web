/**
 * RefineSection 组件测试（需求2 P2 · agent 总结反馈修改）
 *
 * 覆盖：
 *  - 三重显示条件（status / trigger_type / creator_id）任一不满足不渲染
 *  - 输入校验（空、超长）走 Toast.warning 且不打 API
 *  - 正常提交调用 API + onRefineSuccess + Toast.success + 输入清空
 *  - 提交中按钮 loading/disabled 防重复
 *  - 错误码 40001/40002/40004 → 各自 Toast 文案
 *  - 其他错误 → 通用 refineFailed Toast
 *  - onChange 超过字符上限自动截断
 */

import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RefineSection } from '../RefineSection';
import * as summaryApi from '../../api/summaryApi';
import type { SummaryDetail } from '../../types/summary';
import { TaskStatus, TriggerType, SummaryMode } from '../../types/summary';

// ─── Mock Semi UI：与仓库现有测试保持一致（ChatSummaryNewModal.test.tsx） ───
vi.mock('@douyinfe/semi-ui', () => ({
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Button: ({ children, onClick, disabled, loading, theme, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            data-loading={loading}
            data-theme={theme}
            {...rest}
        >
            {children}
        </button>
    ),
    TextArea: ({ value, onChange, placeholder, disabled, autosize: _autosize, ...rest }: any) => (
        <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            {...rest}
        />
    ),
}));

// mock API 层：仅暴露 refineAgentSummary
vi.mock('../../api/summaryApi', () => ({
    refineAgentSummary: vi.fn(),
}));

// @octo/base 的 dmworkBase mock 里 WKApp.loginInfo.uid = 'test-uid'

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDetail(override: Partial<SummaryDetail> = {}): SummaryDetail {
    const now = new Date().toISOString();
    return {
        task_id: 42,
        task_no: 'AGENT-2026-42',
        title: 'agent 总结',
        summary_mode: SummaryMode.BY_GROUP,
        status: TaskStatus.COMPLETED,
        trigger_type: TriggerType.AGENT,
        time_range_start: now,
        time_range_end: now,
        sources: [],
        participants: [],
        result: {
            content: '# 旧版本内容',
            total_msg_count: 100,
            total_token_used: 1024,
            model_version: 'v2.1',
            version: 1,
            generated_at: now,
            citations: [],
        },
        error_message: null,
        creator_id: 'test-uid',
        origin_channel_id: 'group-1',
        origin_channel_type: 1,
        created_at: now,
        updated_at: now,
        ...override,
    };
}

describe('RefineSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('显示条件（三重必须同时满足）', () => {
        it('三重全满足时渲染标题/输入框/提交按钮', () => {
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            expect(screen.getByText('反馈修改')).toBeInTheDocument();
            expect(
                screen.getByPlaceholderText('输入修改需求，如「把风险章节扩充成一整段」'),
            ).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '提交修改' })).toBeInTheDocument();
        });

        it('status != COMPLETED 时不渲染（PROCESSING）', () => {
            const { container } = render(
                <RefineSection
                    detail={makeDetail({ status: TaskStatus.PROCESSING })}
                    onRefineSuccess={vi.fn()}
                />,
            );
            expect(container.firstChild).toBeNull();
        });

        it('trigger_type != AGENT 时不渲染（MANUAL）', () => {
            const { container } = render(
                <RefineSection
                    detail={makeDetail({ trigger_type: TriggerType.MANUAL })}
                    onRefineSuccess={vi.fn()}
                />,
            );
            expect(container.firstChild).toBeNull();
        });

        it('trigger_type != AGENT 时不渲染（SCHEDULED）', () => {
            const { container } = render(
                <RefineSection
                    detail={makeDetail({ trigger_type: TriggerType.SCHEDULED })}
                    onRefineSuccess={vi.fn()}
                />,
            );
            expect(container.firstChild).toBeNull();
        });

        it('creator_id !== 当前 uid 时不渲染', () => {
            const { container } = render(
                <RefineSection
                    detail={makeDetail({ creator_id: 'other-user' })}
                    onRefineSuccess={vi.fn()}
                />,
            );
            expect(container.firstChild).toBeNull();
        });

        it('creator_id 缺失时不渲染（undefined !== "test-uid"）', () => {
            const { container } = render(
                <RefineSection
                    detail={makeDetail({ creator_id: undefined })}
                    onRefineSuccess={vi.fn()}
                />,
            );
            expect(container.firstChild).toBeNull();
        });
    });

    describe('输入校验', () => {
        it('空输入（未键入）时按钮 disabled', () => {
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            expect(screen.getByRole('button', { name: '提交修改' })).toBeDisabled();
        });

        it('纯空格输入 → 按钮保持 disabled，无法提交', () => {
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);

            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            );
            fireEvent.change(textarea, { target: { value: '   ' } });

            // 空格不触发 trim() 后的有效字符，按钮 disabled 由 !instruction.trim() 决定 → 用户点不到
            expect(screen.getByRole('button', { name: '提交修改' })).toBeDisabled();
            expect(summaryApi.refineAgentSummary).not.toHaveBeenCalled();
        });

        it('输入超过 1000 字符 → onChange 自动截断到 1000', () => {
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            ) as HTMLTextAreaElement;

            fireEvent.change(textarea, { target: { value: 'a'.repeat(1500) } });

            expect(textarea.value.length).toBe(1000);
            expect(screen.getByText('1000 / 1000')).toBeInTheDocument();
        });

        it('字符计数随输入实时变化', () => {
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            expect(screen.getByText('0 / 1000')).toBeInTheDocument();

            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            );
            fireEvent.change(textarea, { target: { value: '扩展风险章节' } });
            expect(screen.getByText('6 / 1000')).toBeInTheDocument();
        });
    });

    describe('提交流程', () => {
        it('提交成功：调 API + onRefineSuccess + Toast.success + 清空输入', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            const citations = [
                {
                    chat_id: 'g1',
                    chat_type: 'group' as const,
                    message_seq: 1,
                    sender_name: '张三',
                    message_content: 'x',
                },
            ];
            (summaryApi.refineAgentSummary as any).mockResolvedValue({
                task_id: 42,
                new_version: 2,
                content: '# 新版本内容',
                citations,
            });
            const onSuccess = vi.fn();
            render(<RefineSection detail={makeDetail()} onRefineSuccess={onSuccess} />);

            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            ) as HTMLTextAreaElement;
            fireEvent.change(textarea, { target: { value: '扩展风险章节' } });

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: '提交修改' }));
                await flushPromises();
            });

            expect(summaryApi.refineAgentSummary).toHaveBeenCalledWith(42, '扩展风险章节');
            expect(onSuccess).toHaveBeenCalledWith('# 新版本内容', 2, citations);
            expect(Toast.success).toHaveBeenCalledWith('修改成功，已更新到版本 2');
            expect(textarea.value).toBe('');
        });

        it('提交中按钮 loading + disabled 防重复', async () => {
            let resolveFn: (v: any) => void = () => {};
            (summaryApi.refineAgentSummary as any).mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveFn = resolve;
                    }),
            );

            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            );
            fireEvent.change(textarea, { target: { value: '优化摘要' } });

            const submit = screen.getByRole('button', { name: '提交修改' });
            act(() => {
                fireEvent.click(submit);
            });

            expect(submit).toHaveAttribute('data-loading', 'true');
            expect(submit).toBeDisabled();
            expect(textarea).toBeDisabled();

            fireEvent.click(submit);
            expect(summaryApi.refineAgentSummary).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveFn({ task_id: 42, new_version: 2, content: 'x', citations: [] });
                await flushPromises();
            });
        });

        it('输入前后空白 → API 收到 trim 后的内容', async () => {
            (summaryApi.refineAgentSummary as any).mockResolvedValue({
                task_id: 42,
                new_version: 3,
                content: '# ok',
            });
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            );
            fireEvent.change(textarea, { target: { value: '  扩展摘要  ' } });

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: '提交修改' }));
                await flushPromises();
            });

            expect(summaryApi.refineAgentSummary).toHaveBeenCalledWith(42, '扩展摘要');
        });
    });

    describe('错误码 Toast 映射', () => {
        function axiosError(code: number) {
            return { response: { data: { code, message: `err-${code}` } } };
        }

        async function submitAndFlush() {
            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            );
            fireEvent.change(textarea, { target: { value: '任意需求' } });
            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: '提交修改' }));
                await flushPromises();
            });
        }

        it('code=40001 → Toast.error refineNotSupported', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            (summaryApi.refineAgentSummary as any).mockRejectedValue(axiosError(40001));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();
            expect(Toast.error).toHaveBeenCalledWith('本总结不支持增量修改');
        });

        it('code=40002 → Toast.error refineNotCreator', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            (summaryApi.refineAgentSummary as any).mockRejectedValue(axiosError(40002));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();
            expect(Toast.error).toHaveBeenCalledWith('你不是本总结的创建者，无法修改');
        });

        it('code=40004 → Toast.error refineNoSnapshot', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            (summaryApi.refineAgentSummary as any).mockRejectedValue(axiosError(40004));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();
            expect(Toast.error).toHaveBeenCalledWith('本总结数据版本较老，无法增量修改');
        });

        it('未识别 code → 通用 refineFailed', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            (summaryApi.refineAgentSummary as any).mockRejectedValue(axiosError(50000));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();
            expect(Toast.error).toHaveBeenCalledWith('修改失败，请稍后重试');
        });

        it('网络错误（无 response）→ 通用 refineFailed', async () => {
            const { Toast } = await import('@douyinfe/semi-ui');
            (summaryApi.refineAgentSummary as any).mockRejectedValue(new Error('Network Error'));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();
            expect(Toast.error).toHaveBeenCalledWith('修改失败，请稍后重试');
        });

        it('失败后按钮 loading 复位、输入不清空（方便重试）', async () => {
            (summaryApi.refineAgentSummary as any).mockRejectedValueOnce(axiosError(40001));
            render(<RefineSection detail={makeDetail()} onRefineSuccess={vi.fn()} />);
            await submitAndFlush();

            const submit = screen.getByRole('button', { name: '提交修改' });
            expect(submit).toHaveAttribute('data-loading', 'false');
            const textarea = screen.getByPlaceholderText(
                '输入修改需求，如「把风险章节扩充成一整段」',
            ) as HTMLTextAreaElement;
            expect(textarea.value).toBe('任意需求');
        });

        it('提交失败不调 onRefineSuccess', async () => {
            (summaryApi.refineAgentSummary as any).mockRejectedValue(axiosError(40001));
            const onSuccess = vi.fn();
            render(<RefineSection detail={makeDetail()} onRefineSuccess={onSuccess} />);
            await submitAndFlush();
            expect(onSuccess).not.toHaveBeenCalled();
        });
    });
});
