import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AgentChatPanel from '../AgentChatPanel';

// @octo/base 走 dmworkBase mock，其 I18nContext 默认值已带 t，直接渲染即可。
vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, disabled, loading, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} data-loading={loading} {...rest}>
            {children}
        </button>
    ),
}));

describe('AgentChatPanel handleKeyDown (Bug1: IME 组字回车不发送)', () => {
    it('IME 组字中 (isComposing=true) 按 Enter 不触发 onSend', () => {
        const onSend = vi.fn();
        rtlRender(<AgentChatPanel messages={[]} onSend={onSend} sending={false} />);
        const textarea = screen.getByPlaceholderText(/回车发送/);
        fireEvent.change(textarea, { target: { value: '你好' } });

describe('AgentChatPanel - Save as Summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('无 assistant 产出时点击保存按钮应显示警告', () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn();
        const { Toast } = require('@douyinfe/semi-ui');
        
        rtlRender(
            <AgentChatPanel
                messages={[{ role: 'user', content: '你好' }]}
                onSend={onSend}
                sending={false}
                onSaveAsSummary={onSaveAsSummary}
            />
        );

        const saveButton = screen.getByText(/保存为总结/);
        fireEvent.click(saveButton);

        expect(Toast.warning).toHaveBeenCalled();
        expect(onSaveAsSummary).not.toHaveBeenCalled();
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

        const saveButton = screen.getByText(/保存为总结/);
        fireEvent.click(saveButton);

        expect(screen.getByTestId('modal')).toBeInTheDocument();
        expect(screen.getByTestId('summary-title-input')).toBeInTheDocument();
    });

    it('空标题时点击确定应显示警告', () => {
        const onSend = vi.fn();
        const onSaveAsSummary = vi.fn();
        const { Toast } = require('@douyinfe/semi-ui');
        
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
        const saveButton = screen.getByText(/保存为总结/);
        fireEvent.click(saveButton);

        // 不输入标题直接点确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);

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
        const saveButton = screen.getByText(/保存为总结/);
        fireEvent.click(saveButton);

        // 输入标题
        const titleInput = screen.getByTestId('summary-title-input');
        fireEvent.change(titleInput, { target: { value: '测试总结' } });

        // 点击确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);

        await waitFor(() => {
            expect(onSaveAsSummary).toHaveBeenCalledWith('测试总结');
        });

        // 对话框应该关闭
        await waitFor(() => {
            expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
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
                savingSummary={false}
            />
        );

        // 打开对话框
        const saveButton = screen.getByText(/保存为总结/);
        fireEvent.click(saveButton);

        // 输入标题
        const titleInput = screen.getByTestId('summary-title-input');
        fireEvent.change(titleInput, { target: { value: '测试总结' } });

        // 点击确定
        const okButton = screen.getByTestId('modal-ok');
        fireEvent.click(okButton);

        await waitFor(() => {
            expect(onSaveAsSummary).toHaveBeenCalledWith('测试总结');
        });

        // 对话框应该保留
        expect(screen.getByTestId('modal')).toBeInTheDocument();
        // 标题应该保留
        expect(titleInput).toHaveValue('测试总结');
    });
});
