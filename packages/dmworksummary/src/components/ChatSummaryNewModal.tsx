import React, { Component, createRef } from 'react';
import { Modal, Toast, Tag, Button, Dropdown, SplitButtonGroup } from '@douyinfe/semi-ui';
import { IconPlus, IconClock, IconChevronDown } from '@douyinfe/semi-icons';
import { WKApp, I18nContext } from '@octo/base';
import type { TopicTemplate, ChatCandidate, ScheduleConfig, ChatMessage } from '../types/summary';
import { SourceType, SummaryMode } from '../types/summary';
import { getSourceType, getOriginChannelType } from '../utils/channelType';
import { channelToChatCandidate } from '../utils/channelConvert';
import { resolveTemplate, computeTemplateSelection, type ResolvableTemplate } from '../utils/templateResolver';
import { describeSchedule, scheduleToParams, genSessionId } from '../utils/summaryHelpers';
import * as summaryApi from '../api/summaryApi';
import { getTopicTemplates } from '../api/summaryApi';
import { TOPIC_TEMPLATES } from '../constants/templates';
import { MAX_CHAT_SELECT } from '../constants/limits';
import TemplateCard from './TemplateCard';
import AgentChatPanel from './AgentChatPanel';
import ChatSelectorModal from './ChatSelectorModal';
import ScheduleConfigModal from './ScheduleConfigModal';
import './ChatSummaryNewModal.css';

interface ChatSummaryNewModalProps {
    visible: boolean;
    channel: { channelID: string; channelType: number };
    onClose: () => void;
    onSubmit: (taskId: number) => void;
}

interface ChatSummaryNewModalState {
    topic: string;
    mode: 'normal' | 'agent';
    templates: ResolvableTemplate[];
    selectedChats: ChatCandidate[];
    showChatSelector: boolean;
    submitting: boolean;
    agentSubmitting: boolean;
    savingSummary: boolean;
    templatePlaceholderRange: [number, number] | null;
    scheduleConfig: ScheduleConfig | null;
    showScheduleConfig: boolean;
    // Agent 多轮问答：气泡 UI + session_id。后端按 session_id 持久化记忆，同一会话复用即可续上下文。
    messages: ChatMessage[];
    sessionId: string;
}

export default class ChatSummaryNewModal extends Component<
    ChatSummaryNewModalProps,
    ChatSummaryNewModalState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private inputRef = createRef<HTMLTextAreaElement>();

    // 同步实例锁：防快速双击/回车的竞态（React state 未刷新时仍能拦住第二次）。
    private agentSendInFlight = false;

    constructor(props: ChatSummaryNewModalProps) {
        super(props);
        this.state = {
            topic: '',
            mode: 'normal',
            templates: TOPIC_TEMPLATES,
            selectedChats: [],
            showChatSelector: false,
            submitting: false,
            agentSubmitting: false,
            savingSummary: false,
            templatePlaceholderRange: null,
            scheduleConfig: null,
            showScheduleConfig: false,
            messages: [],
            sessionId: '',
        };
    }

    componentDidMount() {
        if (this.props.visible) {
            const defaultChat = channelToChatCandidate(this.props.channel);
            this.setState({ selectedChats: [defaultChat] });
            void this.loadTemplates();
        }
    }

    componentDidUpdate(prevProps: ChatSummaryNewModalProps) {
        if (this.props.visible && !prevProps.visible) {
            const defaultChat = channelToChatCandidate(this.props.channel);
            this.setState({
                topic: '',
                mode: 'normal',
                selectedChats: [defaultChat],
                showChatSelector: false,
                submitting: false,
                agentSubmitting: false,
                savingSummary: false,
                templatePlaceholderRange: null,
                scheduleConfig: null,
                showScheduleConfig: false,
                messages: [],
                sessionId: '',
            });
            void this.loadTemplates();
        }
    }

    private async loadTemplates() {
        try {
            const templates = await getTopicTemplates();
            if (templates.length > 0) {
                this.setState({ templates });
            }
        } catch {
            // fallback to constants already in state
        }
    }

    private handleTemplateClick = (template: TopicTemplate) => {
        const { text, range } = computeTemplateSelection(template);

        if (range) {
            const [start, end] = range;
            this.setState({ topic: text, templatePlaceholderRange: [start, end] });

            setTimeout(() => {
                const input = this.inputRef.current;
                if (!input) return;
                input.focus();
                input.setSelectionRange(start, end);
            }, 0);
        } else {
            this.setState({ topic: text, templatePlaceholderRange: null });

            setTimeout(() => {
                this.inputRef.current?.focus();
            }, 0);
        }
    };

    private handleInputFocus = () => {
        const { templatePlaceholderRange, topic } = this.state;
        if (!templatePlaceholderRange) return;
        const [start, end] = templatePlaceholderRange;
        const newTopic = topic.substring(0, start) + topic.substring(end);
        this.setState({ topic: newTopic, templatePlaceholderRange: null }, () => {
            this.inputRef.current?.setSelectionRange(start, start);
        });
    };

    private getScheduleLabel(cfg: ScheduleConfig): string {
        const { cron_expr, interval_days, interval_months, run_time, day_of_week, day_of_month } = scheduleToParams(cfg);
        return describeSchedule(cron_expr, interval_days, interval_months, run_time, day_of_week, day_of_month);
    }

    private handleSubmit = async () => {
        const { topic, selectedChats, scheduleConfig } = this.state;
        const { channel, onSubmit } = this.props;

        if (!topic.trim()) return;

        const sourceType = getSourceType(channel);
        if (sourceType === null) return;

        this.setState({ submitting: true });
        try {
            const sources = selectedChats.length > 0
                // 不传 source_name：让后端按 source_id 现查 IM 库最新群名（带类型后缀），
                // 与下方 fallback 分支一致，避免把群名冻结进配置。
                ? selectedChats.map((c) => ({
                    source_type: (c.chat_type === 'group'
                        ? SourceType.GROUP_CHAT
                        : c.chat_type === 'thread'
                        ? SourceType.THREAD
                        : SourceType.DIRECT_MESSAGE),
                    source_id: c.chat_id,
                }))
                : [{
                    source_type: sourceType as 1 | 2 | 3,
                    source_id: channel.channelID,
                }];

            const res = await summaryApi.createSummary({
                topic: topic.trim(),
                origin_channel_id: channel.channelID,
                origin_channel_type: sourceType,
                sources,
            });

            // 若配置了定时：仿完整页，在 scope='task' 下由后端在一个事务里原子完成
            // 「建定时 + 绑定到 task_id」。总结本身已创建成功，定时失败仅提示不阻断。
            if (scheduleConfig !== null) {
                const { cron_expr, interval_days, interval_months, day_of_week, day_of_month, run_time } = scheduleToParams(scheduleConfig);
                try {
                    await summaryApi.createSchedule({
                        title: topic.trim(),
                        summary_mode: SummaryMode.BY_PERSON,
                        cron_expr,
                        interval_days,
                        interval_months,
                        day_of_week,
                        day_of_month,
                        run_time,
                        time_range_type: 2,
                        sources,
                        scope: 'task',
                        task_id: res.task_id,
                    });
                } catch (scheduleErr: any) {
                    // 与完整页 SummaryCreatePage 对齐：优先透出后端 message，回落 i18n 文案。
                    Toast.error(scheduleErr?.message || this.context.t('summary.create.scheduleFailed'));
                }
            }

            window.dispatchEvent(
                new CustomEvent('chat-summary-created', {
                    detail: { taskId: res.task_id, channelId: channel.channelID },
                }),
            );
            onSubmit(res.task_id);
            return true;
        } catch (err: unknown) {
            const msg = err instanceof Error
                ? err.message
                : this.context.t('summary.common.createFailedRetry');
            Toast.error(msg);
        } finally {
            this.setState({ submitting: false });
        }
    };

    /**
     * Agent 多轮交互问答。
     *
     * 与 handleSubmit 的区别：不建 task / 不触发 onSubmit / 不调 createAgentSummary，
     * 只做「多轮气泡 UI + session_id」。与 SummaryCreatePage 逻辑一致：
     * 同一会话复用同一 session_id，后端据此持久化多轮记忆（滑窗保留最近若干轮），追问可续上下文。
     */
    private handleAgentSend = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || this.state.agentSubmitting) return;
        // 同步锁：在读/生成 sessionId 之前拦并发，确保 sessionId 只生成一次。
        if (this.agentSendInFlight) return;
        this.agentSendInFlight = true;

        // 惰性生成 session_id，整会话复用。
        const sessionId = this.state.sessionId || genSessionId();

        this.setState((prev) => ({
            messages: [...prev.messages, { role: 'user', content: trimmed }],
            sessionId,
            agentSubmitting: true,
        }));

        try {
            const res = await summaryApi.agentChat({ message: trimmed, session_id: sessionId, profile: 'summary' });
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: res.reply }],
                // 后端回传 session_id 非空则回填（与后端持久化的会话保持一致）。
                sessionId: res.session_id || prev.sessionId,
            }));
        } catch (err: unknown) {
            // 失败：Toast + 追一条 assistant 错误气泡（让失败在对话流里可见）。
            const msg = err instanceof Error
                ? err.message
                : this.context.t('summary.common.createFailedRetry');
            Toast.error(msg);
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: msg }],
            }));
        } finally {
            this.agentSendInFlight = false;
            this.setState({ agentSubmitting: false });
        }
    };

    /** 主按钮点击：normal 走普通提交；agent 输入走面板底部输入框，主按钮无需提交。 */
    private handlePrimaryClick = () => {
        if (this.state.mode !== 'agent') {
            void this.handleSubmit();
        }
    };

    /** 下拉菜单选择模式：只切换 mode。首次进入 agent 时惰性生成 session_id。 */
    private handleSelectMode = (mode: 'normal' | 'agent') => {
        this.setState((prev) => ({
            mode,
            sessionId: mode === 'agent' && !prev.sessionId ? genSessionId() : prev.sessionId,
        }));
    };

    /** 保存为总结（agent 模式）。将当前 session 的产出落库为可检索的交付物。返回成功/失败。
     *
     * origin_channel_id / origin_channel_type 不再由前端传入 —— agent 对话入口在
     * e5a8eee 起就特意隐藏了"选择聊天/参与者/定时更新"三个控件,前端此时既没有
     * currentChannel 也没有让用户手选来源的地方。后端 handler 会按 session_id 从
     * agent_message 的 tool_calls 记录反查 agent 实际读过的第一个 channel_id
     * 作为 origin(见 agent_summary.go inferOriginChannelFromToolCalls),这样
     * 用户完全无感,来源和 agent 实际引用的数据严格一致。
     */
    handleSaveAsSummary = async (title: string): Promise<boolean> => {
        const { sessionId, selectedChats } = this.state;
        const { onSubmit } = this.props;
        const { t } = this.context;

        if (!sessionId) {
            Toast.warning(t('summary.create.noOutputToSave'));
            return false;
        }

        this.setState({ savingSummary: true });
        try {
            // sources 保留原逻辑:若用户在别处显式选过 chats,把它们透传成 sources;
            // 否则不传,后端会自己从 tool_calls 反推 origin,sources 留空由后续版本
            // 的 deliverable_context 快照补齐。
            const sources = selectedChats.length > 0
                ? selectedChats.map((c) => ({
                    source_type: (c.chat_type === 'group'
                        ? SourceType.GROUP_CHAT
                        : c.chat_type === 'thread'
                        ? SourceType.THREAD
                        : SourceType.DIRECT_MESSAGE),
                    source_id: c.chat_id,
                }))
                : undefined;

            const res = await summaryApi.createAgentSummary({
                session_id: sessionId,
                title,
                sources,
            });

            Toast.success(t('summary.create.agentSummaryCreated'));

            // dispatch 刷新事件。agent 保存路径下前端已不再持有具体 channel
            // (origin 由后端从 tool_calls 反查),下游刷新监听按 taskId 走即可,
            // channelId 传空串以保持事件字段结构不变、避免 undefined 引用崩溃。
            window.dispatchEvent(
                new CustomEvent('chat-summary-created', {
                    detail: { taskId: res.task_id, channelId: '' },
                }),
            );
            onSubmit(res.task_id);
            return true;
        } catch (err: unknown) {
            // 类型守卫:axios 错误
            if (err && typeof err === 'object' && 'response' in err) {
                const axiosErr = err as { response?: { data?: { code?: number } } };
                const code = axiosErr.response?.data?.code;
                // 40004: session 无产出
                if (code === 40004) {
                    Toast.error(t('summary.create.noOutputToSave'));
                    return false;
                }
            }
            // 其他错误
            const msg = err instanceof Error ? err.message : t('summary.common.createFailedRetry');
            Toast.error(msg);
            return false;
        } finally {
            this.setState({ savingSummary: false });
        }
    };


    private handleRemoveChat = (chatId: string) => {
        this.setState((prev) => ({
            selectedChats: prev.selectedChats.filter((c) => c.chat_id !== chatId),
        }));
    };

    render() {
        const { visible, onClose } = this.props;
        const { topic, mode, templates, selectedChats, showChatSelector, submitting, agentSubmitting, scheduleConfig, showScheduleConfig, messages } = this.state;
        const { t } = this.context;
        // 模板在 render() 用当前 locale 解析，切语言即时刷新（不在 state 烘焙）。
        const resolvedTemplates = templates.map((tpl) => resolveTemplate(tpl, t));

        // 提交进行中（任一路径）时禁用交互，避免并发双提交。
        const anySubmitting = submitting || agentSubmitting;
        const canSubmit = !!topic.trim() && !anySubmitting;
        const isAgent = mode === 'agent';
        // 主按钮文案随 mode 切换；提交中显示对应「…中」文案。
        const primaryLabel = isAgent
            ? (agentSubmitting ? t('summary.create.agentSubmitting') : t('summary.create.agentStart'))
            : (submitting ? t('summary.create.submitting') : t('summary.create.start'));

        const footer = (
            <div className="chat-summary-modal-footer">
                <SplitButtonGroup className="chat-summary-modal-split">
                    {/* agent 模式下输入走面板底部输入框，隐藏主「开始」按钮；normal 保持不变。 */}
                    {!isAgent && (
                        <Button
                            theme="solid"
                            size="default"
                            loading={anySubmitting}
                            disabled={!canSubmit}
                            onClick={this.handlePrimaryClick}
                        >
                            {primaryLabel}
                        </Button>
                    )}
                    <Dropdown
                        trigger="click"
                        position="bottomRight"
                        render={(
                            <Dropdown.Menu>
                                <Dropdown.Item
                                    active={!isAgent}
                                    onClick={() => this.handleSelectMode('normal')}
                                >
                                    {t('summary.create.start')}
                                </Dropdown.Item>
                                <Dropdown.Item
                                    active={isAgent}
                                    onClick={() => this.handleSelectMode('agent')}
                                >
                                    {t('summary.create.agentStart')}
                                </Dropdown.Item>
                            </Dropdown.Menu>
                        )}
                    >
                        <Button
                            theme="solid"
                            size="default"
                            disabled={anySubmitting}
                            icon={<IconChevronDown />}
                            aria-label={t('summary.create.switchMode')}
                        />
                    </Dropdown>
                </SplitButtonGroup>
            </div>
        );

        return (
            <>
                <Modal
                    visible={visible}
                    onCancel={onClose}
                    footer={footer}
                    width={640}
                    closable
                    title={null}
                    bodyStyle={{ padding: '24px 24px 0' }}
                    className="chat-summary-new-modal"
                >
                    <div className="chat-summary-modal-header">
                        <span className="chat-summary-modal-title">{t('summary.create.title')}</span>
                        <span className="chat-summary-modal-ai-badge">AI+</span>
                    </div>
                    <div className="chat-summary-modal-desc">
                        {t('summary.create.desc')}
                    </div>

                    <div className="chat-summary-modal-input-area">
                        {isAgent ? (
                            // 弹窗内高度受限：固定面板高度让内部消息列表滚动。
                            <div className="chat-summary-modal-agent-chat" style={{ height: 360 }}>
                                <AgentChatPanel
                                    messages={messages}
                                    onSend={this.handleAgentSend}
                                    sending={agentSubmitting}
                                    welcome={t('summary.create.agentChatWelcome')}
                                    onSaveAsSummary={this.handleSaveAsSummary}
                                    savingSummary={this.state.savingSummary}
                                />
                            </div>
                        ) : (
                            <>
                        <textarea
                            ref={this.inputRef}
                            className="chat-summary-modal-input"
                            placeholder={isAgent
                                ? t('summary.create.agentTopicPlaceholder')
                                : t('summary.create.topicPlaceholderInChat')}
                            value={topic}
                            onChange={(e) => this.setState({ topic: e.target.value, templatePlaceholderRange: null })}
                            onFocus={this.handleInputFocus}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && !submitting) {
                                    e.preventDefault();
                                    void this.handleSubmit();
                                }
                            }}
                        />
                        {!topic.trim() && (
                            <>
                                <div className="chat-summary-modal-templates-label">{t('summary.create.templatesTitle')}</div>
                                <div className="chat-summary-modal-templates">
                                    {resolvedTemplates.map((tpl) => (
                                        <TemplateCard
                                            key={tpl.id}
                                            template={tpl}
                                            onClick={this.handleTemplateClick}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                            </>
                        )}
                    </div>

                    <div className="chat-summary-modal-chat-section">
                        {!isAgent && (
                            <>
                            <Button
                                theme="borderless"
                                icon={<IconPlus />}
                                size="small"
                                onClick={() => this.setState({ showChatSelector: true })}
                                style={{
                                    color: selectedChats.length > 0
                                        ? 'var(--wk-color-primary, #3370FF)'
                                        : undefined,
                                }}
                            >
                                {selectedChats.length > 0
                                    ? t('summary.create.selectedChats', { values: { count: selectedChats.length } })
                                    : t('summary.create.selectChat')}
                            </Button>
                            <Button
                                theme="borderless"
                                icon={<IconClock />}
                                size="small"
                                onClick={() => this.setState({ showScheduleConfig: true })}
                                style={{
                                    marginLeft: 8,
                                    color: scheduleConfig ? 'var(--wk-color-primary, #3370FF)' : undefined,
                                }}
                            >
                                {scheduleConfig
                                    ? this.getScheduleLabel(scheduleConfig)
                                    : t('summary.schedule.config.title')}
                            </Button>
                            </>
                        )}
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                            {t('summary.create.archivedNotice')}
                        </span>
                        {selectedChats.length > 0 && (
                            <div className="chat-summary-modal-chat-tags">
                                {selectedChats.map((c) => (
                                    <Tag
                                        key={c.chat_id}
                                        closable
                                        onClose={() => this.handleRemoveChat(c.chat_id)}
                                        style={{ marginRight: 6, marginBottom: 4 }}
                                    >
                                        {c.name}
                                    </Tag>
                                ))}
                            </div>
                        )}
                    </div>
                </Modal>

                <ChatSelectorModal
                    visible={showChatSelector}
                    selected={selectedChats}
                    maxSelect={MAX_CHAT_SELECT}
                    onConfirm={(chats) =>
                        this.setState({ selectedChats: chats, showChatSelector: false })
                    }
                    onCancel={() => this.setState({ showChatSelector: false })}
                />

                <ScheduleConfigModal
                    visible={showScheduleConfig}
                    value={scheduleConfig ?? { unit: 'week', every: 1, time: '09:00' }}
                    onConfirm={(cfg) => this.setState({ scheduleConfig: cfg, showScheduleConfig: false })}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                />
            </>
        );
    }
}
