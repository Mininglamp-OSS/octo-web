import React, { Component, createRef } from 'react';
import { Button, Modal, Input, Toast } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import type { ChatMessage } from '../types/summary';
import './AgentChatPanel.css';

interface AgentChatPanelProps {
    messages: ChatMessage[];
    onSend: (text: string) => void;
    sending: boolean;
    /** 可选开场气泡（assistant 视角），无消息时展示在列表顶部 */
    welcome?: string;
    /** 可选：「保存为总结」回调,返回 Promise 表示成功/失败 */
    onSaveAsSummary?: (title: string) => Promise<boolean>;
    /** 保存中状态 */
    savingSummary?: boolean;
}

interface AgentChatPanelState {
    input: string;
    showSaveDialog: boolean;
    summaryTitle: string;
}

/**
 * Agent 交互式问答面板：多轮气泡 UI + 底部输入框。
 * 受控消息由父组件持有（含 session_id 透传）；本组件只负责渲染与输入交互。
 */
export default class AgentChatPanel extends Component<AgentChatPanelProps, AgentChatPanelState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    // 滚动容器：新消息 / sending 变化时自动滚到底
    private listRef = createRef<HTMLDivElement>();

    state: AgentChatPanelState = { 
        input: '', 
        showSaveDialog: false,
        summaryTitle: '',
    };

    componentDidMount() {
        this.scrollToBottom();
    }

    componentDidUpdate(prev: AgentChatPanelProps) {
        if (prev.messages.length !== this.props.messages.length || prev.sending !== this.props.sending) {
            this.scrollToBottom();
        }
    }

    private scrollToBottom = () => {
        const el = this.listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    };

    // 发送后清空输入框；sending 中禁止并发发送。
    private handleSend = () => {
        const text = this.state.input.trim();
        if (!text || this.props.sending) return;
        this.props.onSend(text);
        this.setState({ input: '' });
    };

    // 回车发送，Shift+Enter 换行。输入法组字中的 Enter 是确认候选词，不发送。
    private handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // isComposing 覆盖 React 合成事件下的 IME 组字态；keyCode 229 兜底老浏览器。
        if (e.nativeEvent.isComposing || (e as any).keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    };

    // 检查是否有 assistant 产出（至少一条 assistant 回复）
    private hasAssistantOutput = (): boolean => {
        return this.props.messages.some(m => m.role === 'assistant');
    };

    // 打开保存对话框
    private handleOpenSaveDialog = () => {
        const { t } = this.context;
        if (!this.hasAssistantOutput()) {
            Toast.warning(t('summary.create.noOutputToSave'));
            return;
        }
        this.setState({ showSaveDialog: true, summaryTitle: '' });
    };

    // 提交保存 - 异步等待结果,成功才关闭对话框
    private handleSaveConfirm = async () => {
        const { t } = this.context;
        const title = this.state.summaryTitle.trim();
        if (!title) {
            Toast.warning(t('summary.create.titleRequired'));
            return;
        }
        if (!this.props.onSaveAsSummary) return;
        
        const success = await this.props.onSaveAsSummary(title);
        if (success) {
            // 成功才关闭对话框并清空标题
            this.setState({ showSaveDialog: false, summaryTitle: '' });
        }
        // 失败时保留对话框和已填标题,方便用户重试
    };

    render() {
        const { messages, sending, welcome, savingSummary } = this.props;
        const { input, showSaveDialog, summaryTitle } = this.state;
        const { t } = this.context;
        const canSave = this.hasAssistantOutput() && this.props.onSaveAsSummary;

        return (
            <div className="agent-chat-panel">
                <div className="agent-chat-panel-list" ref={this.listRef}>
                    {welcome && (
                        <div className="agent-chat-msg agent-chat-msg--assistant">
                            <div className="agent-chat-bubble">{welcome}</div>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div
                            key={i}
                            className={`agent-chat-msg agent-chat-msg--${m.role}`}
                        >
                            <div className="agent-chat-bubble">{m.content}</div>
                        </div>
                    ))}
                </div>
                <div className="agent-chat-panel-input">
                    <textarea
                        className="agent-chat-textarea"
                        value={input}
                        placeholder={t('summary.create.agentChatPlaceholder')}
                        disabled={sending}
                        rows={1}
                        onChange={(e) => this.setState({ input: e.target.value })}
                        onKeyDown={this.handleKeyDown}
                    />
                    <Button
                        theme="solid"
                        size="default"
                        loading={sending}
                        disabled={sending || !input.trim()}
                        onClick={this.handleSend}
                    >
                        {t('summary.create.send')}
                    </Button>
                    {canSave && (
                        <Button
                            size="default"
                            disabled={!this.hasAssistantOutput() || savingSummary}
                            loading={savingSummary}
                            onClick={this.handleOpenSaveDialog}
                            style={{ marginLeft: 8 }}
                        >
                            {t('summary.create.saveAsSummary')}
                        </Button>
                    )}
                </div>

                {/* 保存为总结命名对话框 */}
                <Modal
                    title={t('summary.create.saveDialogTitle')}
                    visible={showSaveDialog}
                    onOk={this.handleSaveConfirm}
                    onCancel={() => this.setState({ showSaveDialog: false })}
                    okText={t('summary.common.confirm')}
                    cancelText={t('summary.common.cancel')}
                    confirmLoading={savingSummary}
                >
                    <Input
                        placeholder={t('summary.create.titlePlaceholder')}
                        value={summaryTitle}
                        onChange={v => this.setState({ summaryTitle: v })}
                        maxLength={100}
                        showClear
                        autoFocus
                    />
                </Modal>
            </div>
        );
    }
}
