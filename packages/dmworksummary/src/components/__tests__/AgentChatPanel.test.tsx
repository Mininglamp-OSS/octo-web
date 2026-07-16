import React from 'react';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentChatPanel from '../AgentChatPanel';

// @octo/base 走 dmworkBase mock，其 I18nContext 默认值已带 t，直接渲染即可。
vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, loading, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} {...rest}>
            {children}
        </button>
    ),
    Modal: ({ visible, children, onOk, onCancel, confirmLoading }: any) => 
        visible ? (
            <div data-testid="save-modal">
                {children}
                <button 
                    data-testid="modal-ok" 
                    onClick={onOk} 
                    disabled={confirmLoading}
                >
                    确定
                </button>
                <button data-testid="modal-cancel" onClick={onCancel}>
                    取消
                </button>
            </div>
        ) : null,
    Input: ({ value, onChange, placeholder }: any) => (
        <input
            data-testid="summary-title-input"
            value={value}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder={placeholder}
        />
    ),
    Toast: {
        warning: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('AgentChatPanel handleKeyDown (Bug1: IME 组字回车不发送)', () => {
    it('IME 组字中 (isComposing=true) 按 Enter 不触发 onSend', () => {
        const onSend = vi.fn();
        rtlRender(<AgentChatPanel messages={[]} onSend={onSend} sending={false} />);
        const textarea = screen.getByPlaceholderText(/回车发送/);
        fireEvent.change(textarea, { target: { value: '你好' } });
        // fireEvent.keyDown 的第二参会同时写到 nativeEvent 上
        fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('非组字 (isComposing=false) 按 Enter 正常触发 onSend', () => {
        const onSend = vi.fn();
        rtlRender(<AgentChatPanel messages={[]} onSend={onSend} sending={false} />);
        const textarea = screen.getByPlaceholderText(/回车发送/);
        fireEvent.change(textarea, { target: { value: '你好' } });
        fireEvent.keyDown(textarea, { key: 'Enter', isComposing: false });
        expect(onSend).toHaveBeenCalledWith('你好');
    });
});

describe('AgentChatPanel - Save as Summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('无 assistant 产出时不渲染保存按钮', async () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn();
        const { Toast } = await import('@douyinfe/semi-ui');
        
        // 组件实际行为是 canSave = hasAssistantOutput() && onSaveAsSummary
        // 所以无 assistant 产出时,按钮根本不渲染
        rtlRender(
            <AgentChatPanel
                messages={[{ role: 'user', content: '你好' }]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        // 按钮不应该渲染
        expect(screen.queryByText('保存为总结')).not.toBeInTheDocument();
        // Toast.warning 不会被调用,因为按钮不存在
        expect(Toast.warning).not.toHaveBeenCalled();
    });

    it('有 assistant 产出时点击保存按钮应打开对话框', () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn();
        
        rtlRender(
            <AgentChatPanel
                messages={[
                    { role: 'user', content: '你好' },
                    { role: 'assistant', content: '你好，我是助手' },
                ]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        const saveButton = screen.getByText('保存为总结');
        fireEvent.click(saveButton);

        expect(screen.getByTestId('save-modal')).toBeInTheDocument();
        expect(screen.getByTestId('summary-title-input')).toBeInTheDocument();
    });

    it('空标题时点击确定应显示警告', async () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn();
        const { Toast } = await import('@douyinfe/semi-ui');
        
        rtlRender(
            <AgentChatPanel
                messages={[
                    { role: 'user', content: '你好' },
                    { role: 'assistant', content: '你好，我是助手' },
                ]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        // 打开对话框
        const saveButton = screen.getByText('保存为总结');
        fireEvent.click(saveButton);

        // 验证对话框已打开
        expect(screen.getByTestId('save-modal')).toBeInTheDocument();
        
        // 不输入标题,直接点确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);
        
        // 验证警告被调用,onSaveAsSummary 未被调用
        expect(Toast.warning).toHaveBeenCalled();
        expect(onSaveAsSummary).not.toHaveBeenCalled();
    });

    it('保存成功后应关闭对话框并清空标题', async () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn().mockResolvedValue(true);
        
        rtlRender(
            <AgentChatPanel
                messages={[
                    { role: 'user', content: '你好' },
                    { role: 'assistant', content: '你好，我是助手' },
                ]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        // 打开对话框
        const saveButton = screen.getByText('保存为总结');
        fireEvent.click(saveButton);

        // 验证对话框已打开
        expect(screen.getByTestId('save-modal')).toBeInTheDocument();
        
        // 输入标题
        const titleInput = screen.getByTestId('summary-title-input');
        fireEvent.change(titleInput, { target: { value: '测试总结' } });
        expect(titleInput).toHaveValue('测试总结');
        
        // 点击确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);
        
        // 等待异步操作完成
        await waitFor(() => {
            // 验证 onSaveAsSummary 被正确调用
            expect(onSaveAsSummary).toHaveBeenCalledWith('测试总结');
            expect(onSaveAsSummary).toHaveBeenCalledTimes(1);
        });
        
        // 保存成功后,对话框应该关闭
        await waitFor(() => {
            expect(screen.queryByTestId('save-modal')).not.toBeInTheDocument();
        });
    });

    it('保存失败后应保留对话框和已填标题', async () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn().mockResolvedValue(false);
        
        rtlRender(
            <AgentChatPanel
                messages={[
                    { role: 'user', content: '你好' },
                    { role: 'assistant', content: '你好，我是助手' },
                ]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        // 打开对话框
        const saveButton = screen.getByText('保存为总结');
        fireEvent.click(saveButton);

        // 验证对话框已打开
        expect(screen.getByTestId('save-modal')).toBeInTheDocument();
        
        // 输入标题
        const titleInput = screen.getByTestId('summary-title-input');
        fireEvent.change(titleInput, { target: { value: '测试总结' } });
        expect(titleInput).toHaveValue('测试总结');
        
        // 点击确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);
        
        // 等待异步操作完成
        await waitFor(() => {
            // 验证 onSaveAsSummary 被调用
            expect(onSaveAsSummary).toHaveBeenCalledWith('测试总结');
            expect(onSaveAsSummary).toHaveBeenCalledTimes(1);
        });
        
        // 保存失败后,对话框应该仍然存在
        expect(screen.getByTestId('save-modal')).toBeInTheDocument();
        // 标题应该保留
        expect(titleInput).toHaveValue('测试总结');
    });
});
describe('AgentChatPanel 新会话 action', () => {
    it('不提供 onNewSession 时不渲染「新会话」按钮', () => {
        rtlRender(<AgentChatPanel messages={[]} onSend={vi.fn()} sending={false} />);
        expect(screen.queryByText('新会话')).not.toBeInTheDocument();
    });

    it('提供 onNewSession 时渲染按钮，点击触发回调', () => {
        const onNewSession = vi.fn();
        rtlRender(
            <AgentChatPanel messages={[]} onSend={vi.fn()} sending={false} onNewSession={onNewSession} />,
        );
        const btn = screen.getByText('新会话');
        fireEvent.click(btn);
        expect(onNewSession).toHaveBeenCalledTimes(1);
    });

    it('发送中 (sending=true) 禁用「新会话」按钮', () => {
        const onNewSession = vi.fn();
        rtlRender(
            <AgentChatPanel messages={[]} onSend={vi.fn()} sending onNewSession={onNewSession} />,
        );
        const btn = screen.getByText('新会话') as HTMLButtonElement;
        expect(btn).toBeDisabled();
    });
});
