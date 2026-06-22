import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSummaryNewModal from '../ChatSummaryNewModal';

vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible, footer, onCancel }: any) =>
        visible ? (
            <div data-testid="modal">
                <div data-testid="modal-body">{children}</div>
                <div data-testid="modal-footer">{footer}</div>
            </div>
        ) : null,
    Toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    Tag: ({ children, closable, onClose }: any) => (
        <span data-testid="tag">
            {children}
            {closable && <button data-testid="tag-close" onClick={onClose}>x</button>}
        </span>
    ),
    Button: ({ children, onClick, disabled, loading, theme, icon, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} data-theme={theme} {...rest}>
            {icon}{children}
        </button>
    ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconPlus: () => <span data-testid="icon-plus" />,
    IconClock: () => <span data-testid="icon-clock" />,
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        WKApp: { mittBus: { emit: vi.fn() } },
    };
});

vi.mock('../../utils/channelConvert', () => ({
    channelToChatCandidate: (ch: any) => ({
        chat_id: ch.channelID,
        chat_type: 'group',
        name: 'Test Chat',
        member_count: null,
    }),
}));

vi.mock('../../utils/channelType', () => ({
    getSourceType: () => 1,
}));

vi.mock('../../api/summaryApi', () => ({
    getTopicTemplates: vi.fn().mockResolvedValue([]),
    createSummary: vi.fn().mockResolvedValue({ task_id: 1 }),
}));

vi.mock('../TemplateCard', () => ({
    default: ({ template, onClick }: any) => (
        <div data-testid={`template-${template.id}`} onClick={() => onClick(template)}>
            {template.label}
        </div>
    ),
}));

vi.mock('../ChatSelectorModal', () => ({
    default: () => null,
}));

vi.mock('../ScheduleConfigModal', () => ({
    default: () => null,
}));

vi.mock('../../constants/templates', () => ({
    TOPIC_TEMPLATES: [
        { id: 'project_progress', label: '汇总项目进展', icon: 'FileText', description: '总结进展', type: 'parameterized', pattern: '总结 {project_name} 的项目进展', placeholders: [{ key: 'project_name', label: '输入项目名称', position: [3, 9] }] },
        { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: '总结工作', type: 'fixed', pattern: '总结每周的工作周报' },
        { id: 'chat_content', label: '总结聊天内容', icon: 'MessageSquare', description: '总结聊天', type: 'fixed', pattern: '总结本群中的关键内容' },
    ],
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatSummaryNewModal', () => {
    const defaultProps = {
        visible: true,
        channel: { channelID: 'ch1', channelType: 2 },
        onClose: vi.fn(),
        onSubmit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows updated description text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.getByText('邀请同事一起总结信息，并根据聊天等内容自动总结')).toBeInTheDocument();
    });

    it('does not contain old description text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.queryByText('邀请同事一起汇总信息，并根据聊天、文档、会议和邮件等自动总结。')).not.toBeInTheDocument();
    });

    it('shows templates when input is empty', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByTestId('template-weekly_report')).toBeInTheDocument();
        expect(screen.getByTestId('template-chat_content')).toBeInTheDocument();
    });

    it('hides templates when input has content', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试主题' } });

        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();
        expect(screen.queryByTestId('template-weekly_report')).not.toBeInTheDocument();
    });

    it('shows templates again when input is cleared', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试' } });
        expect(screen.queryByText('试试总结')).not.toBeInTheDocument();

        fireEvent.change(input, { target: { value: '' } });
        expect(screen.getByText('试试总结')).toBeInTheDocument();
        expect(screen.getByTestId('template-weekly_report')).toBeInTheDocument();
    });

    it('renders templates inside the unified input-area container', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const inputArea = body.querySelector('.chat-summary-modal-input-area');
        expect(inputArea).toBeInTheDocument();

        const input = inputArea!.querySelector('.chat-summary-modal-input');
        expect(input).toBeInTheDocument();

        const templatesLabel = inputArea!.querySelector('.chat-summary-modal-templates-label');
        expect(templatesLabel).toBeInTheDocument();
        expect(templatesLabel!.textContent).toBe('试试总结');

        const templatesContainer = inputArea!.querySelector('.chat-summary-modal-templates');
        expect(templatesContainer).toBeInTheDocument();
    });

    it('renders templates before chat selector in DOM order', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const html = body.innerHTML;
        const templatesIdx = html.indexOf('template-weekly_report');
        const chatSelectorIdx = html.indexOf('chat-summary-modal-chat-section');
        expect(templatesIdx).toBeGreaterThan(-1);
        expect(chatSelectorIdx).toBeGreaterThan(-1);
        expect(templatesIdx).toBeLessThan(chatSelectorIdx);
    });

    it('input-area keeps its structure when templates are hidden', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const body = screen.getByTestId('modal-body');
        const inputArea = body.querySelector('.chat-summary-modal-input-area');
        expect(inputArea).toBeInTheDocument();

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题');
        fireEvent.change(input, { target: { value: '测试' } });

        expect(inputArea!.querySelector('.chat-summary-modal-input')).toBeInTheDocument();
        expect(inputArea!.querySelector('.chat-summary-modal-templates')).not.toBeInTheDocument();
    });

    it('parameterized template click sets value with placeholder, then focus removes placeholder text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-project_progress');
        fireEvent.click(templateCard);

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        expect(input.value).toBe('总结 输入项目名称 的项目进展');

        await act(async () => {
            await flushPromises();
        });

        expect(input.value).toBe('总结  的项目进展');
    });

    it('fixed template click does not set placeholder range', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-weekly_report');
        await act(async () => {
            fireEvent.click(templateCard);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        expect(input.value).toBe('总结每周的工作周报');

        await act(async () => {
            fireEvent.focus(input);
            await flushPromises();
        });

        expect(input.value).toBe('总结每周的工作周报');
    });

    it('onChange clears placeholder range so subsequent focus does not remove text', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const templateCard = screen.getByTestId('template-project_progress');
        await act(async () => {
            fireEvent.click(templateCard);
            await flushPromises();
        });

        const input = screen.getByPlaceholderText('输入聊天内你想总结的主题') as HTMLTextAreaElement;
        fireEvent.change(input, { target: { value: '总结 我的项目 的项目进展' } });

        await act(async () => {
            fireEvent.focus(input);
            await flushPromises();
        });

        expect(input.value).toBe('总结 我的项目 的项目进展');
    });

    it('footer only contains the submit button', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const footer = screen.getByTestId('modal-footer');
        expect(footer.textContent).toContain('开始总结');
        expect(footer.textContent).not.toContain('添加成员');
        expect(footer.textContent).not.toContain('定时更新');
        expect(footer.textContent).not.toContain('总结并发到聊天');
    });

    it('submit button is disabled when input is empty', async () => {
        await act(async () => {
            render(<ChatSummaryNewModal {...defaultProps} />);
            await flushPromises();
        });

        const footer = screen.getByTestId('modal-footer');
        const submitBtn = footer.querySelector('button');
        expect(submitBtn).toBeDisabled();
    });

    it('does not render when not visible', () => {
        render(<ChatSummaryNewModal {...defaultProps} visible={false} />);
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });
});
