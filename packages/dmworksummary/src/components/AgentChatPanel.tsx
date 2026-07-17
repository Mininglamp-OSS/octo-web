import React, { Component, createRef } from 'react';
import { Button, Modal, Input, Toast } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import type { ChatMessage, AgentProgressEvent, AgentDoneEvent, AgentErrorEvent } from '../types/summary';
import { agentChatStream, agentChat } from '../api/summaryApi';
import { genSessionId } from '../utils/summaryHelpers';
import './AgentChatPanel.css';

interface AgentChatPanelProps {
    messages: ChatMessage[];
    onSend: (text: string) => void;
    sending: boolean;
    welcome?: string;
    onSaveAsSummary?: (title: string) => Promise<boolean>;
    savingSummary?: boolean;
    onNewSession?: () => void;
    useStream?: boolean;
    sessionId?: string;
    profile?: string;
    onAssistantMessage?: (text: string, sessionId?: string) => void;
    onUserMessage?: (text: string, sessionId?: string) => void;
    /**
     * 引用的已有总结 task_id 列表。仅在**首轮**(messages.length===0)时随
     * 第一个 chat 请求发给后端;后续轮次此字段被忽略(引用一次锁定)。
     */
    referencedTaskIds?: number[];
    /**
     * 引用锁定后由 header/入口渲染的可视化元素(如"已引用总结 A"卡片)。
     * 传入即渲染在顶部标题栏(newSession 按钮同排);为 null 或不传时不渲染。
     */
    referenceHeader?: React.ReactNode;
}

/**
 * 抽象阶段 → 用户可见文案（前端持有措辞），存 i18n key path，让 t() 在 render
 * 时查表；与后端脱敏后的 phase 安全枚举一一对应，后端绝不下发原始工具名。
 * 未知 phase 走兜底 progress.fallback。SUM-850 blocker F1：所有用户可见字符串必须走 i18n。
 */
const PHASE_LABEL_KEYS: Record<string, string> = {
    understand: 'summary.common.agentChat.progress.understand',
    retrieve: 'summary.common.agentChat.progress.retrieve',
    filter: 'summary.common.agentChat.progress.filter',
    distill: 'summary.common.agentChat.progress.distill',
    compose: 'summary.common.agentChat.progress.compose',
    reply: 'summary.common.agentChat.progress.reply',
};
const PHASE_FALLBACK_KEY = 'summary.common.agentChat.progress.fallback';

interface ProgressStep {
    phase: string;
    step: number;
    count?: number;
    timestamp: number;
}

interface AgentChatPanelState {
    input: string;
    showSaveDialog: boolean;
    summaryTitle: string;
    isStreaming: boolean;
    progressSteps: ProgressStep[];
    processExpanded: boolean;
    streamStartTime: number;
}

export default class AgentChatPanel extends Component<AgentChatPanelProps, AgentChatPanelState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private listRef = createRef<HTMLDivElement>();
    private streamCloseHandle: (() => void) | null = null;

    state: AgentChatPanelState = { 
        input: '', 
        showSaveDialog: false,
        summaryTitle: '',
        isStreaming: false,
        progressSteps: [],
        processExpanded: true,
        streamStartTime: 0,
    };

    componentDidMount() {
        this.scrollToBottom();
    }

    componentDidUpdate(prev: AgentChatPanelProps, prevState: AgentChatPanelState) {
        if (
            prev.messages.length !== this.props.messages.length || 
            prev.sending !== this.props.sending ||
            prevState.isStreaming !== this.state.isStreaming ||
            prevState.progressSteps.length !== this.state.progressSteps.length
        ) {
            this.scrollToBottom();
        }
    }

    componentWillUnmount() {
        if (this.streamCloseHandle) {
            this.streamCloseHandle();
            this.streamCloseHandle = null;
        }
    }

    private scrollToBottom = () => {
        const el = this.listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    };

    private handleSend = () => {
        const text = this.state.input.trim();
        if (!text || this.props.sending || this.state.isStreaming) return;

        if (this.props.useStream) {
            this.startSSEStream(text);
        } else {
            this.props.onSend(text);
            this.setState({ input: '' });
        }
    };

    private startSSEStream = async (text: string) => {
        const { sessionId: propsSessionId, profile, onUserMessage, onAssistantMessage } = this.props;
        const { t } = this.context;
        if (!profile) {
            console.error('[AgentChatPanel] useStream=true but missing profile');
            Toast.error(t('summary.common.agentChat.errorMessage.sseNeedsProfile'));
            return;
        }

        // Bug fix: props.sessionId 可能是空字符串(父组件的 setState 是异步的,
        // 首次交互时父组件从 onUserMessage 生成的新 sessionId 在同一 render
        // cycle 里还未 propagate 到本组件)。这里本地兜底一次生成,同时通过
        // onAssistantMessage 的 sessionId 参数上抛让父组件同步持久化。
        // 见 CHAT-REFERENCE-BASED-DESIGN-v1: chat session 生命周期。
        const sessionId = propsSessionId || genSessionId();

        this.setState({
            input: '',
            isStreaming: true,
            progressSteps: [],
            processExpanded: true,
            streamStartTime: Date.now(),
        });

        // 先本地追加 user 消息(纯 UI,不发请求)
        onUserMessage?.(text, sessionId);

        try {
            // 每轮都把引用传给后端(和 CHAT-REFERENCE-BASED-DESIGN-v1 多轮上下文修复对齐)。
            // 后端每轮重新拼进 system prompt,让 agent 在多轮追问/迭代中始终能看到引用材料。
            const refIds = this.props.referencedTaskIds && this.props.referencedTaskIds.length > 0
                ? this.props.referencedTaskIds
                : undefined;

            const { close } = agentChatStream({
                session_id: sessionId,
                message: text,
                profile,
                referenced_task_ids: refIds,
            }, {
                onProgress: (evt: AgentProgressEvent) => {
                    this.setState(prev => {
                        const steps = prev.progressSteps;
                        const last = steps[steps.length - 1];
                        // 合并同一 phase 的连续事件为一行（保留最新的 step/count），
                        // 呈现为干净的抽象阶段时间线，而非逐工具日志。
                        if (last && last.phase === evt.phase) {
                            const merged: ProgressStep = {
                                ...last,
                                step: evt.step,
                                count: evt.count ?? last.count,
                                timestamp: Date.now(),
                            };
                            return { progressSteps: [...steps.slice(0, -1), merged] };
                        }
                        return {
                            progressSteps: [
                                ...steps,
                                {
                                    phase: evt.phase,
                                    step: evt.step,
                                    count: evt.count,
                                    timestamp: Date.now(),
                                },
                            ],
                        };
                    });
                },
                onDone: (evt: AgentDoneEvent) => {
                    const { t } = this.context;
                    const reply = evt.reply || t('summary.common.agentPanel.noReply');
                    // 优先用后端回传的 session_id(它可能对老 session 做过 canonicalize);
                    // 兜底用我们本地生成的 sessionId(和请求时发出去的一致,父组件据此持久化)。
                    onAssistantMessage?.(reply, evt.session_id || sessionId);
                    this.setState({
                        isStreaming: false,
                        processExpanded: false,
                    });
                    this.streamCloseHandle = null;
                },
                onError: (evt: AgentErrorEvent) => {
                    const { t } = this.context;
                    Toast.error(`${t('summary.common.agentChat.error')}: ${evt.message}`);
                    this.setState({ isStreaming: false });
                    this.streamCloseHandle = null;
                    // 仅传输层失败(transient: true)才重试,后端真实 error 不重试
                    if (evt.transient) {
                        this.fallbackToNormalChat(text, sessionId, profile);
                    }
                },
            });

            this.streamCloseHandle = close;

        } catch (err: any) {
            const { t } = this.context;
            console.error('[AgentChatPanel] SSE stream failed:', err);
            Toast.warning(t('summary.common.agentChat.streamInterrupted'));
            this.fallbackToNormalChat(text, sessionId, profile);
        }
    };

    private fallbackToNormalChat = async (text: string, sessionId: string, profile: string) => {
        const { t } = this.context;
        const { onAssistantMessage } = this.props;
        try {
            // Fallback 也每轮带引用(和 SSE 主链一致)
            const refIds = this.props.referencedTaskIds && this.props.referencedTaskIds.length > 0
                ? this.props.referencedTaskIds
                : undefined;

            const result = await agentChat({
                session_id: sessionId,
                message: text,
                profile,
                referenced_task_ids: refIds,
            });
            const reply = result.reply || t('summary.common.agentPanel.noReply');
            // 上抛 sessionId 让父组件持久化(和 SSE onDone 一致)
            onAssistantMessage?.(reply, result.session_id || sessionId);
        } catch (err: any) {
            Toast.error(t('summary.common.createFailed'));
            console.error('[AgentChatPanel] Fallback agentChat failed:', err);
        } finally {
            this.setState({ isStreaming: false });
        }
    };

    private handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || (e as any).keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    };

    private hasAssistantOutput = (): boolean => {
        return this.props.messages.some(m => m.role === 'assistant');
    };

    private handleOpenSaveDialog = () => {
        const { t } = this.context;
        if (!this.hasAssistantOutput()) {
            Toast.warning(t('summary.create.noOutputToSave'));
            return;
        }
        this.setState({ showSaveDialog: true, summaryTitle: '' });
    };

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
            this.setState({ showSaveDialog: false, summaryTitle: '' });
        }
    };

    private renderProcessPanel = () => {
        const { t } = this.context;
        const { progressSteps, processExpanded, streamStartTime, isStreaming } = this.state;

        if (!this.props.useStream || progressSteps.length === 0) return null;

        const elapsed = streamStartTime ? Math.round((Date.now() - streamStartTime) / 1000) : 0;

        return (
            <div className={`agent-chat-process-panel${processExpanded ? '' : ' agent-chat-process-panel--collapsed'}`}>
                <button
                    className="agent-chat-process-toggle"
                    onClick={() => this.setState(prev => ({ processExpanded: !prev.processExpanded }))}
                >
                    {processExpanded ? '▼' : '▶'} {t('summary.common.agentChat.viewGenerationProcess')} ({progressSteps.length} {t('summary.common.agentChat.stepsCount')})
                </button>
                
                {processExpanded && (
                    <>
                        <div className="agent-chat-process-timeline" aria-live="polite">
                            {progressSteps.map((step, i) => (
                                <div key={i} className="agent-chat-process-item">
                                    <span className="agent-chat-process-label">
                                        {t(PHASE_LABEL_KEYS[step.phase] || PHASE_FALLBACK_KEY)}
                                    </span>
                                    {step.count ? (
                                        <span className="agent-chat-process-detail">
                                            {t('summary.common.agentPanel.processedCount', { values: { count: step.count } })}
                                        </span>
                                    ) : null}
                                </div>
                            ))}
                            {isStreaming && (
                                <div className="agent-chat-process-item agent-chat-process-item--loading">
                                    <span className="agent-chat-process-spinner">⏳</span>
                                    <span>{t('summary.common.agentChat.generating')}</span>
                                </div>
                            )}
                        </div>
                        <div className="agent-chat-process-meta">
                            {t('summary.common.agentChat.generationTime')}: {elapsed}s
                        </div>
                    </>
                )}
            </div>
        );
    };

    render() {
        const { messages, sending, welcome, savingSummary, onNewSession, referenceHeader } = this.props;
        const { input, showSaveDialog, summaryTitle, isStreaming } = this.state;
        const { t } = this.context;
        const canSave = this.hasAssistantOutput() && this.props.onSaveAsSummary;

        const isBusy = sending || isStreaming;

        return (
            <div className="agent-chat-panel">
                {(onNewSession || referenceHeader) && (
                    <div className="agent-chat-panel-header">
                        {referenceHeader}
                        {onNewSession && (
                            <Button
                                theme="borderless"
                                size="small"
                                disabled={isBusy}
                                onClick={onNewSession}
                            >
                                {t('summary.create.newSession')}
                            </Button>
                        )}
                    </div>
                )}
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
                            <div className="agent-chat-bubble">
                                {m.content}
                                {m.role === 'assistant' && i === messages.length - 1 && this.props.useStream && (
                                    this.renderProcessPanel()
                                )}
                            </div>
                        </div>
                    ))}
                    {isStreaming && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
                        <div className="agent-chat-msg agent-chat-msg--assistant">
                            <div className="agent-chat-bubble">
                                {this.renderProcessPanel()}
                            </div>
                        </div>
                    )}
                </div>
                <div className="agent-chat-panel-input">
                    <textarea
                        className="agent-chat-textarea"
                        value={input}
                        placeholder={t('summary.create.agentChatPlaceholder')}
                        disabled={isBusy}
                        rows={1}
                        onChange={(e) => this.setState({ input: e.target.value })}
                        onKeyDown={this.handleKeyDown}
                    />
                    <Button
                        theme="solid"
                        size="default"
                        loading={isBusy}
                        disabled={isBusy || !input.trim()}
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
