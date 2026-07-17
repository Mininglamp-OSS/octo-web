import React, { Component, createRef } from 'react';
import { Modal, Toast, Tag, Button, Dropdown, SplitButtonGroup } from '@douyinfe/semi-ui';
import { IconPlus, IconClock, IconChevronDown } from '@douyinfe/semi-icons';
import { WKApp, I18nContext } from '@octo/base';
import VoiceInputButton from '@octo/base/src/Components/VoiceInputButton';
import type { ReplaceMode, SelectionRange } from '@octo/base/src/Components/VoiceInputButton';
import type { TopicTemplate, ChatCandidate, ScheduleConfig, CreateAgentSummaryParams, ChatMessage } from '../types/summary';
import { SourceType, SummaryMode } from '../types/summary';
import { getSourceType, getOriginChannelType } from '../utils/channelType';
import { channelToChatCandidate } from '../utils/channelConvert';
import { resolveTemplate, computeTemplateSelection, getTemplateEditableFields, deriveSummaryTitle, type ResolvableTemplate } from '../utils/templateResolver';

import { describeSchedule, scheduleToParams, genSessionId, readAgentChatSession, writeAgentChatSession, clearAgentChatSession } from '../utils/summaryHelpers';
import * as summaryApi from '../api/summaryApi';
import { getTopicTemplatesConfig } from '../api/summaryApi';
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
    appliedTemplateLabel: string;
    customTemplateLimit: number;
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
    showMoreTemplates: boolean;
    editingTemplate: TopicTemplate | null;
    creatingCustomTemplate: boolean;
    editingTemplateLabel: string;
    editingTemplateDescription: string;
    savingTemplate: boolean;
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

    private handleVoiceTranscribed = (
        text: string,
        mode: ReplaceMode,
        savedRange?: SelectionRange
    ) => {
        if (mode === 'all') {
            this.setState({ topic: text, templatePlaceholderRange: null });
        } else if (mode === 'selection' && savedRange) {
            this.setState((prev) => ({
                topic: prev.topic.slice(0, savedRange.from) + text + prev.topic.slice(savedRange.to),
                templatePlaceholderRange: null,
            }));
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.topic.length;
                return {
                    topic: prev.topic.slice(0, pos) + text + prev.topic.slice(pos),
                    templatePlaceholderRange: null,
                };
            });
        }
    };

    // 同步实例锁：防快速双击/回车的竞态（React state 未刷新时仍能拦住第二次）。
    private agentSendInFlight = false;

    // localStorage key 按频道隔离，不同群各自的对话不串（见 summaryHelpers）。
    private agentChannelId(): string | undefined {
        return this.props.channel?.channelID;
    }

    // 拉历史的竞态守卫：每次新的 hydrate 自增，异步返回时比对，丢弃过期请求。
    private historyLoadToken = 0;

    constructor(props: ChatSummaryNewModalProps) {
        super(props);
        this.state = {
            topic: '',
            appliedTemplateLabel: '',
            customTemplateLimit: 30,
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
            showMoreTemplates: false,
            editingTemplate: null,
            creatingCustomTemplate: false,
            editingTemplateLabel: '',
            editingTemplateDescription: '',
            savingTemplate: false,
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
                appliedTemplateLabel: '',
                customTemplateLimit: 30,
                mode: 'normal',
                selectedChats: [defaultChat],
                showChatSelector: false,
                submitting: false,
                agentSubmitting: false,
                savingSummary: false,
                templatePlaceholderRange: null,
                scheduleConfig: null,
                showScheduleConfig: false,
                showMoreTemplates: false,
                editingTemplate: null,
                creatingCustomTemplate: false,
                editingTemplateLabel: '',
                editingTemplateDescription: '',
                savingTemplate: false,
                messages: [],
                sessionId: '',
            });
            void this.loadTemplates();
        }
    }

    private async loadTemplates() {
        try {
            const data = await getTopicTemplatesConfig();
            this.setState({ customTemplateLimit: data.custom_template_limit });
            if (data.templates.length > 0) {
                this.setState({ templates: data.templates });
            }
        } catch {
            // fallback to constants already in state
        }
    }


    private handleTemplateEdit = (template: TopicTemplate) => {
        this.setState({
            editingTemplate: template,
            creatingCustomTemplate: false,
            editingTemplateLabel: getTemplateEditableFields(template).label,
            editingTemplateDescription: getTemplateEditableFields(template).description,
        });
    };

    private canCreateCustomTemplate = () => {
        const resolvedTemplates = this.state.templates.map((tpl) => resolveTemplate(tpl, this.context.t));
        return resolvedTemplates.filter((tpl) => tpl.is_custom).length < this.state.customTemplateLimit;
    };

    private handleCustomTemplateCreate = () => {
        if (!this.canCreateCustomTemplate()) return;
        this.setState({
            editingTemplate: null,
            creatingCustomTemplate: true,
            editingTemplateLabel: '',
            editingTemplateDescription: '',
        });
    };

    private closeTemplateEdit = () => {
        if (this.state.savingTemplate) return;
        this.clearTemplateEditor();
    };

    private clearTemplateEditor() {
        this.setState({
            editingTemplate: null,
            creatingCustomTemplate: false,
            editingTemplateLabel: '',
            editingTemplateDescription: '',
        });
    }

    private replaceTemplateInState(template: TopicTemplate) {
        this.setState((prev) => ({
            templates: prev.templates.map((tpl) => (tpl.id === template.id ? template : tpl)),
        }));
    }

    private appendTemplateToState(template: TopicTemplate) {
        this.setState((prev) => ({
            templates: [...prev.templates, template],
        }));
    }

    private removeTemplateFromState(templateId: string) {
        this.setState((prev) => ({
            templates: prev.templates.filter((tpl) => tpl.id !== templateId),
        }));
    }

    private handleTemplateSave = async () => {
        const {
            editingTemplate,
            creatingCustomTemplate,
            editingTemplateLabel,
            editingTemplateDescription,
        } = this.state;
        const label = editingTemplateLabel.trim();
        const description = editingTemplateDescription.trim();
        if (!label || !description) return;
        this.setState({ savingTemplate: true });
        try {
            if (creatingCustomTemplate) {
                const template = await summaryApi.createCustomTopicTemplate({ label, description });
                this.appendTemplateToState(template);
                Toast.success(this.context.t('summary.templates.custom.createSuccess'));
            } else if (editingTemplate?.is_custom) {
                const template = await summaryApi.updateCustomTopicTemplate(editingTemplate.id, { label, description });
                this.replaceTemplateInState(template);
                Toast.success(this.context.t('summary.templates.custom.saveSuccess'));
            } else if (editingTemplate) {
                const template = await summaryApi.updateMyTopicTemplate(editingTemplate.id, { label, description });
                this.replaceTemplateInState(template);
                Toast.success(this.context.t('summary.templates.custom.saveSuccess'));
            }
            this.clearTemplateEditor();
        } catch (err: any) {
            Toast.error(err?.message || this.context.t(creatingCustomTemplate
                ? 'summary.templates.custom.createFailed'
                : 'summary.templates.custom.saveFailed'));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private handleTemplateReset = async () => {
        const { editingTemplate } = this.state;
        if (!editingTemplate || editingTemplate.is_custom) return;
        this.setState({ savingTemplate: true });
        try {
            const template = await summaryApi.resetMyTopicTemplate(editingTemplate.id);
            this.replaceTemplateInState(template);
            this.clearTemplateEditor();
            Toast.success(this.context.t('summary.templates.custom.resetSuccess'));
        } catch (err: any) {
            Toast.error(err?.message || this.context.t('summary.templates.custom.resetFailed'));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private handleCustomTemplateDelete = async (template?: TopicTemplate) => {
        const target = template?.is_custom ? template : this.state.editingTemplate;
        if (!target?.is_custom) return;
        this.setState({ savingTemplate: true });
        try {
            await summaryApi.deleteCustomTopicTemplate(target.id);
            this.removeTemplateFromState(target.id);
            if (this.state.editingTemplate?.id === target.id) {
                this.clearTemplateEditor();
            }
            Toast.success(this.context.t('summary.templates.custom.deleteSuccess'));
        } catch (err: any) {
            Toast.error(err?.message || this.context.t('summary.templates.custom.deleteFailed'));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private requestCustomTemplateDelete = (template?: TopicTemplate) => {
        const target = template?.is_custom ? template : this.state.editingTemplate;
        if (!target?.is_custom) return;
        Modal.confirm({
            title: this.context.t('summary.templates.custom.deleteConfirmTitle'),
            content: this.context.t('summary.templates.custom.deleteConfirmContent', { values: { name: target.label } }),
            okText: this.context.t('summary.templates.custom.delete'),
            cancelText: this.context.t('summary.common.cancel'),
            okButtonProps: { type: 'danger' },
            onOk: () => this.handleCustomTemplateDelete(target),
        });
    };

    private handleMoreTemplateClick = (template: TopicTemplate) => {
        this.setState({ showMoreTemplates: false }, () => this.handleTemplateClick(template));
    };

    private handleTemplateClick = (template: TopicTemplate) => {
        const { t } = this.context;
        const { text, range } = computeTemplateSelection(template, {
            topic: t('summary.templates.custom.promptTopic'),
            context: t('summary.templates.custom.promptContext'),
        });

        if (range) {
            const [start, end] = range;
            this.setState({ topic: text, appliedTemplateLabel: template.label, templatePlaceholderRange: [start, end] });

            setTimeout(() => {
                const input = this.inputRef.current;
                if (!input) return;
                input.focus();
                input.setSelectionRange(start, end);
            }, 0);
        } else {
            this.setState({ topic: text, appliedTemplateLabel: template.label, templatePlaceholderRange: null });

            setTimeout(() => {
                this.inputRef.current?.focus();
            }, 0);
        }
    };

    private handleReselectTemplate = () => {
        this.setState({ topic: '', appliedTemplateLabel: '', templatePlaceholderRange: null });
        setTimeout(() => {
            this.inputRef.current?.focus();
        }, 0);
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
        const summaryTitle = deriveSummaryTitle(topic);

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
                title: summaryTitle,
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
                        title: summaryTitle,
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
        // 持久化到 localStorage：关闭弹窗/刷新后再进来可按 session_id 拉回历史（「退出不丢」）。
        writeAgentChatSession(this.agentChannelId(), sessionId);

        this.setState((prev) => ({
            messages: [...prev.messages, { role: 'user', content: trimmed }],
            sessionId,
            agentSubmitting: true,
        }));

        try {
            const res = await summaryApi.agentChat({ message: trimmed, session_id: sessionId, profile: 'summary' });
            // 后端回传 session_id 非空则回填并持久化（与后端持久化的会话保持一致）。
            const nextSessionId = res.session_id || sessionId;
            writeAgentChatSession(this.agentChannelId(), nextSessionId);
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: res.reply }],
                sessionId: nextSessionId,
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


    /** SSE 模式：追加 user 消息(仅 UI,不发请求)。 */
    private handleAgentUserMessage = (text: string, incomingSessionId?: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        
        // 惰性生成 session_id，整会话复用
        const sessionId = incomingSessionId || this.state.sessionId || genSessionId();
        writeAgentChatSession(this.agentChannelId(), sessionId);

        this.setState((prev) => ({
            messages: [...prev.messages, { role: 'user', content: trimmed }],
            sessionId,
        }));
    };

    /** SSE 模式：追加 assistant 消息(仅 UI,不发请求)。 */
    private handleAgentAssistantMessage = (text: string, sessionId?: string) => {
        // 后端回传 session_id 非空则回填并持久化（与后端持久化的会话保持一致）
        if (sessionId && sessionId !== this.state.sessionId) {
            writeAgentChatSession(this.agentChannelId(), sessionId);
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: text }],
                sessionId,
            }));
        } else {
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: text }],
            }));
        }
    };
    /** 主按钮点击：normal 走普通提交；agent 输入走面板底部输入框，主按钮无需提交。 */
    private handlePrimaryClick = () => {
        if (this.state.mode !== 'agent') {
            void this.handleSubmit();
        }
    };

    /** 下拉菜单选择模式：切到 agent 时从 localStorage 恢复 session_id 并回显历史。 */
    private handleSelectMode = (mode: 'normal' | 'agent') => {
        // 已在目标模式则短路，避免重复进入 agent 触发多余的历史拉取/状态重置。
        if (mode === this.state.mode) return;
        if (mode === 'agent') {
            this.enterAgentMode();
        } else {
            this.setState({ mode });
        }
    };

    /**
     * 进入 agent 模式：读 localStorage 拿 session_id → 拉历史回显。
     * 无历史（新会话）则照旧空白开场；session_id 仍惰性生成于首次发送。
     */
    private enterAgentMode() {
        const stored = readAgentChatSession(this.agentChannelId());
        this.setState((prev) => ({
            mode: 'agent',
            sessionId: stored || prev.sessionId,
        }));
        if (stored) void this.loadAgentHistory(stored);
    }

    /**
     * 按 session_id 拉回历史消息回显。失败/无历史静默降级为「空白新开场」，不打挂面板。
     * 竞态守卫：仅当 token 未过期、当前仍是该会话、且本地尚无消息时才灌入，避免覆盖用户新发的消息。
     */
    private async loadAgentHistory(sessionId: string) {
        const token = ++this.historyLoadToken;
        try {
            const data = await summaryApi.getAgentChatHistory(sessionId);
            if (token !== this.historyLoadToken) return;
            if (this.state.sessionId !== sessionId || this.state.mode !== 'agent') return;
            if (this.state.messages.length > 0) return;
            if (data.messages.length === 0) return;
            this.setState({ messages: data.messages });
        } catch {
            // 静默降级：保留已恢复的 session_id，空白开场，下次发送续接该会话。
        }
    }

    /** 「新会话」：清 localStorage 的 session_id、清空消息，下次发送重新生成新 session_id。 */
    private handleNewSession = () => {
        clearAgentChatSession(this.agentChannelId());
        // 作废在途历史拉取，避免旧会话历史回灌到新会话。
        this.historyLoadToken++;
        this.setState({ messages: [], sessionId: '' });
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
        const {
            topic, appliedTemplateLabel, customTemplateLimit, mode, templates, selectedChats, showChatSelector, submitting, agentSubmitting, scheduleConfig, showScheduleConfig, showMoreTemplates,
            editingTemplate, creatingCustomTemplate,
            editingTemplateLabel, editingTemplateDescription, savingTemplate,
            messages,
        } = this.state;
        const { t } = this.context;
        // 模板在 render() 用当前 locale 解析，切语言即时刷新（不在 state 烘焙）。
        const resolvedTemplates = templates.map((tpl) => resolveTemplate(tpl, t));
        const builtinTemplates = resolvedTemplates.filter((tpl) => !tpl.is_custom);
        const primaryBuiltinTemplates = builtinTemplates.slice(0, 4);
        const moreBuiltinTemplates = builtinTemplates.slice(4);
        const customTemplates = resolvedTemplates.filter((tpl) => tpl.is_custom);
        const canCreateCustomTemplate = customTemplates.length < customTemplateLimit;
        const isCustomEditor = creatingCustomTemplate || !!editingTemplate?.is_custom;
        const templateEditorVisible = creatingCustomTemplate || !!editingTemplate;

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
                                    useStream={true}
                                    onUserMessage={this.handleAgentUserMessage}
                                    onAssistantMessage={this.handleAgentAssistantMessage}
                                    sessionId={this.state.sessionId}
                                    profile="summary"
                                    messages={messages}
                                    onSend={this.handleAgentSend}
                                    sending={agentSubmitting}
                                    welcome={t('summary.create.agentChatWelcome')}
                                    onSaveAsSummary={this.handleSaveAsSummary}
                                    savingSummary={this.state.savingSummary}
                                    onNewSession={this.handleNewSession}
                                />
                            </div>
                        ) : (
                            <>
                                <div className="chat-summary-modal-input-wrap">
                                    <textarea
                                        ref={this.inputRef}
                                        className="chat-summary-modal-input"
                                        placeholder={t('summary.create.topicPlaceholderInChat')}
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
                                    {/* D6 决策 B: normal 模式带 VoiceInputButton;agent 模式改走 AgentChatPanel 分支 */}
                                    <VoiceInputButton
                                        inputRef={this.inputRef}
                                        onTranscribed={this.handleVoiceTranscribed}
                                        getCurrentText={() => this.state.topic}
                                        showModeMenu
                                        size="sm"
                                        className="wk-vib--textarea-corner"
                                    />
                                </div>
                                {topic.trim() && appliedTemplateLabel && (
                                    <div className="summary-template-applied-bar">
                                        <span className="summary-template-applied-text">
                                            {t('summary.templates.custom.applied', { values: { name: appliedTemplateLabel } })}
                                        </span>
                                        <button
                                            type="button"
                                            className="summary-template-applied-action"
                                            onClick={this.handleReselectTemplate}
                                        >
                                            {t('summary.templates.custom.reselect')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                        {!isAgent && !topic.trim() && (
                            <>
                                <div className="summary-template-section-header chat-summary-modal-templates-heading">
                                    <div className="chat-summary-modal-templates-label">{t('summary.create.templatesTitle')}</div>
                                    {moreBuiltinTemplates.length > 0 && (
                                        <button
                                            type="button"
                                            className="summary-template-more-button"
                                            onClick={() => this.setState({ showMoreTemplates: true })}
                                        >
                                            {t('summary.templates.custom.moreTemplates')}
                                        </button>
                                    )}
                                </div>
                                <div className="chat-summary-modal-templates">
                                    {primaryBuiltinTemplates.map((tpl) => (
                                        <TemplateCard
                                            key={tpl.id}
                                            template={tpl}
                                            onClick={this.handleTemplateClick}
                                            onEdit={this.handleTemplateEdit}
                                            editLabel={t('summary.templates.custom.edit')}
                                        />
                                    ))}
                                </div>
                                <div className="summary-template-custom-section">
                                    <div className="summary-template-custom-header">
                                        <div className="summary-template-custom-title">
                                            {t('summary.templates.custom.myTemplatesTitleWithCount', { values: { count: customTemplates.length, limit: customTemplateLimit } })}
                                        </div>
                                        <Button
                                            theme="borderless"
                                            size="small"
                                            icon={<IconPlus />}
                                            disabled={!canCreateCustomTemplate}
                                            onClick={this.handleCustomTemplateCreate}
                                        >
                                            {t('summary.templates.custom.new')}
                                        </Button>
                                    </div>
                                    {!canCreateCustomTemplate && (
                                        <div className="summary-template-limit-hint">
                                            {t('summary.templates.custom.limitReached')}
                                        </div>
                                    )}
                                    {customTemplates.length > 0 ? (
                                        <div className="summary-template-custom-list">
                                            {customTemplates.map((tpl) => (
                                                <TemplateCard
                                                    key={tpl.id}
                                                    template={tpl}
                                                    onClick={this.handleTemplateClick}
                                                    onEdit={this.handleTemplateEdit}
                                                    onDelete={this.requestCustomTemplateDelete}
                                                    editLabel={t('summary.templates.custom.edit')}
                                                    deleteLabel={t('summary.templates.custom.delete')}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="summary-template-custom-empty"
                                            disabled={!canCreateCustomTemplate}
                                            onClick={this.handleCustomTemplateCreate}
                                        >
                                            <span className="summary-template-custom-empty-title">
                                                {t('summary.templates.custom.emptyTitle')}
                                            </span>
                                            <span className="summary-template-custom-empty-desc">
                                                {t('summary.templates.custom.emptyDesc')}
                                            </span>
                                        </button>
                                    )}
                                </div>
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
                    showGenerationInstruction={false}
                />

                <Modal
                    visible={showMoreTemplates}
                    title={t('summary.templates.custom.moreTemplatesTitle')}
                    onCancel={() => this.setState({ showMoreTemplates: false })}
                    footer={null}
                    width={560}
                    className="summary-more-template-modal"
                >
                    <div className="summary-more-template-grid">
                        {moreBuiltinTemplates.map((tpl) => (
                            <TemplateCard
                                key={tpl.id}
                                template={tpl}
                                onClick={this.handleMoreTemplateClick}
                                onEdit={this.handleTemplateEdit}
                                editLabel={t('summary.templates.custom.edit')}
                            />
                        ))}
                    </div>
                </Modal>

                <Modal
                    visible={templateEditorVisible}
                    title={t(creatingCustomTemplate
                        ? 'summary.templates.custom.createTitle'
                        : isCustomEditor
                        ? 'summary.templates.custom.editCustomTitle'
                        : 'summary.templates.custom.editTitle')}
                    onCancel={this.closeTemplateEdit}
                    footer={null}
                    width={560}
                    maskClosable={!savingTemplate}
                >
                    <div className="summary-template-edit-field">
                        <label className="summary-template-edit-label">
                            {t('summary.templates.custom.nameLabel')}
                        </label>
                        <input
                            className="summary-template-edit-input"
                            value={editingTemplateLabel}
                            maxLength={100}
                            disabled={savingTemplate}
                            placeholder={t('summary.templates.custom.namePlaceholder')}
                            onChange={(e) => this.setState({ editingTemplateLabel: e.target.value.slice(0, 100) })}
                        />
                    </div>
                    <div className="summary-template-edit-field">
                        <label className="summary-template-edit-label">
                            {t('summary.templates.custom.descriptionLabel')}
                        </label>
                        <textarea
                            className="summary-template-edit-input summary-template-edit-desc"
                            value={editingTemplateDescription}
                            maxLength={200}
                            disabled={savingTemplate}
                            placeholder={t('summary.templates.custom.descriptionPlaceholder')}
                            onChange={(e) => this.setState({ editingTemplateDescription: e.target.value.slice(0, 200) })}
                        />
                    </div>
                    <div className="summary-template-edit-hint">
                        {t('summary.templates.custom.editHint')}
                    </div>
                    <div className="summary-editor-actions summary-template-edit-actions">
                        {editingTemplate?.is_custom && (
                            <Button type="danger" onClick={() => this.requestCustomTemplateDelete()} disabled={savingTemplate}>
                                {t('summary.templates.custom.delete')}
                            </Button>
                        )}
                        {editingTemplate && !editingTemplate.is_custom && (
                            <Button onClick={this.handleTemplateReset} disabled={savingTemplate}>
                                {t('summary.templates.custom.reset')}
                            </Button>
                        )}
                        <Button onClick={this.closeTemplateEdit} disabled={savingTemplate}>
                            {t('summary.common.cancel')}
                        </Button>
                        <Button
                            theme="solid"
                            loading={savingTemplate}
                            disabled={!editingTemplateLabel.trim() || !editingTemplateDescription.trim() || savingTemplate}
                            onClick={this.handleTemplateSave}
                        >
                            {t('summary.common.save')}
                        </Button>
                    </div>
                </Modal>
            </>
        );
    }
}
