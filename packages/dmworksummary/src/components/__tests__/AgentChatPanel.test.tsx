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
