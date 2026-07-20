import React, { Component, createRef } from "react";
import {
    Button,
    Toast,
    Typography,
    Tag,
    Avatar,
    Modal,
    Dropdown,
    SplitButtonGroup,
} from "@douyinfe/semi-ui";
import { IconPlus, IconClock, IconUserGroup, IconChevronDown } from "@douyinfe/semi-icons";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import * as api from "../api/summaryApi";
import { getTopicTemplatesConfig, getTopicTemplates } from "../api/summaryApi";
import { getOriginChannelType } from "../utils/channelType";
import SummaryDetailPage from "./SummaryDetailPage";
import ChatSelectorModal from "../components/ChatSelectorModal";
import MemberSelectorModal from "../components/MemberSelectorModal";
import ScheduleConfigModal from "../components/ScheduleConfigModal";
import TemplateCard from "../components/TemplateCard";
import AgentChatPanel from "../components/AgentChatPanel";
import SummaryReferencePicker from "../components/SummaryReferencePicker";
import SummaryPreviewModal from "../components/SummaryPreviewModal";
import SummaryReferenceSidePanel from "../components/SummaryReferenceSidePanel";
import { TOPIC_TEMPLATES } from "../constants/templates";
import { MAX_CHAT_SELECT } from "../constants/limits";
import type {
    CreateSummaryParams,
    ChatMessage,
    ChatCandidate,
    MemberCandidate,
    ScheduleConfig,
    TopicTemplate,
    SummaryListItem,
    CreateAgentSummaryParams,
} from "../types/summary";
import { SummaryMode, SourceType } from "../types/summary";
import { describeSchedule, scheduleToParams, genSessionId, readAgentChatSession, writeAgentChatSession, clearAgentChatSession, readAgentChatReferenced, writeAgentChatReferenced, clearAgentChatReferenced } from "../utils/summaryHelpers";
import { resolveTemplate, computeTemplateSelection, getTemplateEditableFields, deriveSummaryTitle, type ResolvableTemplate } from "../utils/templateResolver";

const { Text } = Typography;

interface SummaryCreatePageProps {
    onCreated?: () => void;
    /**
     * 从详情页「继续优化」入口打开时,预填的引用总结。
     * mount 时会自动切到 agent 模式 + 把此 task 填进 referencedTask,
     * 达到"用户手动打开 chat + 手动引用"的完成态。
     * 见 CHAT-REFERENCE-BASED-DESIGN-v1。
     */
    derivedFromTask?: SummaryListItem;
}

interface SummaryCreatePageState {
    topic: string;
    appliedTemplateLabel: string;
    customTemplateLimit: number;
    mode: 'normal' | 'agent';
    templates: ResolvableTemplate[];
    templatePlaceholderRange: [number, number] | null;
    selectedChats: ChatCandidate[];
    selectedMembers: MemberCandidate[];
    scheduleConfig: ScheduleConfig | null;
    showChatSelector: boolean;
    showMemberSelector: boolean;
    showScheduleConfig: boolean;
    showMoreTemplates: boolean;
    submitting: boolean;
    agentSubmitting: boolean;
    savingSummary: boolean;
    // Agent 多轮问答：气泡 UI + session_id。后端按 session_id 持久化记忆，同一会话复用即可续上下文。
    messages: ChatMessage[];
    sessionId: string;
    /**
     * chat 引用的已有总结(单选,v1)。仅首轮生效,选中后随 first message 发给后端。
     * 见 CHAT-REFERENCE-BASED-DESIGN-v1。
     */
    referencedTask: SummaryListItem | null;
    /** 引用选择器 Modal 打开状态 */
    showReferencePicker: boolean;
    /**
     * 预览 Modal 当前显示的 task_id。null = 未打开。
     * 见 CHAT-REFERENCE-PREVIEW-AND-RANGE-SAVE-v1 需求 1。
     *
     * 保留 Modal 状态用于未来其他触发点(比如详情页快照预览)。
     * 主 UI(chat 里点引用卡片)已改成右侧 SidePanel — 见 sidePanelOpen。
     */
    previewTaskId: number | null;
    /**
     * 右侧引用对照面板打开状态(CHAT-REFERENCE-PREVIEW-AND-RANGE-SAVE-v1 需求 1 · Q2 默认收起)
     * true = 显示 SummaryReferenceSidePanel · false = 不占布局
     * 点击引用卡片 toggle;移除引用时强制关闭;切引用时 SidePanel 内容跟着变
     */
    sidePanelOpen: boolean;
    error: string | null;
    editingTemplate: TopicTemplate | null;
    creatingCustomTemplate: boolean;
    editingTemplateLabel: string;
    editingTemplateDescription: string;
    savingTemplate: boolean;
}

export default class SummaryCreatePage extends Component<SummaryCreatePageProps, SummaryCreatePageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private textareaRef = createRef<HTMLTextAreaElement>();

    state: SummaryCreatePageState = {
        topic: "",
        appliedTemplateLabel: "",
        customTemplateLimit: 30,
        mode: 'normal',
        templates: TOPIC_TEMPLATES,
        templatePlaceholderRange: null,
        selectedChats: [],
        selectedMembers: [],
        scheduleConfig: null,
        showChatSelector: false,
        showMemberSelector: false,
        showScheduleConfig: false,
        showMoreTemplates: false,
        submitting: false,
        agentSubmitting: false,
        savingSummary: false,
        messages: [],
        sessionId: '',
        referencedTask: null,
        showReferencePicker: false,
        previewTaskId: null,
        sidePanelOpen: false,
        error: null,
        editingTemplate: null,
        creatingCustomTemplate: false,
        editingTemplateLabel: "",
        editingTemplateDescription: "",
        savingTemplate: false,
    };

    // 同步实例锁：防快速双击/回车的竞态（React state 未刷新时仍能拦住第二次）。
    private agentSendInFlight = false;

    // 完整创建页无频道上下文：session_id 落到统一兜底 key（见 summaryHelpers）。
    // 单独抽成方法便于与 ChatSummaryNewModal（按 channelID 隔离）保持对称。
    private agentChannelId(): string | undefined {
        return undefined;
    }

    // 拉历史的竞态守卫：每次新的 hydrate 自增，异步返回时比对，丢弃过期请求。
    private historyLoadToken = 0;

    componentDidMount() {
        void this.loadTemplates();
        // 从详情页「继续优化」打开时:自动切 agent 模式 + 预填引用。
        // 见 CHAT-REFERENCE-BASED-DESIGN-v1 决策 1B(详情页显眼按钮入口)。
        if (this.props.derivedFromTask) {
            // #907 review (Jerry-Xin) P1 cross-session contamination:
            // 走「继续优化」= 用户明确要针对当前 task 开新一轮 · 复用工作台
            // 上一次残留的 session_id 语义完全不匹配(旧 chat 讨论的是别的
            // 总结 · 现在换了 reference)。如果只 overwrite referenced 不清
            // session · refresh-before-send 会 restore「旧 session_id + 新
            // reference」的错配组合 · loadAgentHistory 灌回旧 messages ·
            // 保存时血统被污染。所以进入时先原子清一遍 session · 再 write
            // 新 reference · 保证 storage 里的两条永远一致。
            clearAgentChatSession(this.agentChannelId());
            this.setState({
                mode: 'agent',
                referencedTask: this.props.derivedFromTask,
                sessionId: '',
                messages: [],
            });
            // 与 session_id 同生命周期持久化引用总结，避免 refresh/重进后
            // referencedTask 只活在 React state 里而丢失 → 保存时 400。
            writeAgentChatReferenced(this.agentChannelId(), {
                task_id: this.props.derivedFromTask.task_id,
                title: this.props.derivedFromTask.title ?? '',
            });
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
            editingTemplateLabel: "",
            editingTemplateDescription: "",
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
            editingTemplateLabel: "",
            editingTemplateDescription: "",
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
                const template = await api.createCustomTopicTemplate({ label, description });
                this.appendTemplateToState(template);
                Toast.success(t("summary.templates.custom.createSuccess"));
            } else if (editingTemplate?.is_custom) {
                const template = await api.updateCustomTopicTemplate(editingTemplate.id, { label, description });
                this.replaceTemplateInState(template);
                Toast.success(t("summary.templates.custom.saveSuccess"));
            } else if (editingTemplate) {
                const template = await api.updateMyTopicTemplate(editingTemplate.id, { label, description });
                this.replaceTemplateInState(template);
                Toast.success(t("summary.templates.custom.saveSuccess"));
            }
            this.clearTemplateEditor();
        } catch (err: any) {
            Toast.error(err?.message || t(creatingCustomTemplate
                ? "summary.templates.custom.createFailed"
                : "summary.templates.custom.saveFailed"));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private handleCustomTemplateDelete = async (template?: TopicTemplate) => {
        const target = template?.is_custom ? template : this.state.editingTemplate;
        if (!target?.is_custom) return;
        this.setState({ savingTemplate: true });
        try {
            await api.deleteCustomTopicTemplate(target.id);
            this.removeTemplateFromState(target.id);
            if (this.state.editingTemplate?.id === target.id) {
                this.clearTemplateEditor();
            }
            Toast.success(t("summary.templates.custom.deleteSuccess"));
        } catch (err: any) {
            Toast.error(err?.message || t("summary.templates.custom.deleteFailed"));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private requestCustomTemplateDelete = (template?: TopicTemplate) => {
        const target = template?.is_custom ? template : this.state.editingTemplate;
        if (!target?.is_custom) return;
        Modal.confirm({
            title: t("summary.templates.custom.deleteConfirmTitle"),
            content: t("summary.templates.custom.deleteConfirmContent", { values: { name: target.label } }),
            okText: t("summary.templates.custom.delete"),
            cancelText: t("summary.common.cancel"),
            okButtonProps: { type: "danger" },
            onOk: () => this.handleCustomTemplateDelete(target),
        });
    };

    private handleTemplateReset = async () => {
        const { editingTemplate } = this.state;
        if (!editingTemplate || editingTemplate.is_custom) return;
        this.setState({ savingTemplate: true });
        try {
            const template = await api.resetMyTopicTemplate(editingTemplate.id);
            this.replaceTemplateInState(template);
            this.clearTemplateEditor();
            Toast.success(t("summary.templates.custom.resetSuccess"));
        } catch (err: any) {
            Toast.error(err?.message || t("summary.templates.custom.resetFailed"));
        } finally {
            this.setState({ savingTemplate: false });
        }
    };

    private handleMoreTemplateClick = (template: TopicTemplate) => {
        this.setState({ showMoreTemplates: false }, () => this.handleTemplateClick(template));
    };

    private handleTemplateClick = (template: TopicTemplate) => {
        const { t: translate } = this.context;
        const { text, range } = computeTemplateSelection(template, {
            topic: translate("summary.templates.custom.promptTopic"),
            context: translate("summary.templates.custom.promptContext"),
        });

        if (range) {
            const [start, end] = range;
            this.setState({ topic: text, appliedTemplateLabel: template.label, templatePlaceholderRange: [start, end] }, this.autoResizeTextarea);

            setTimeout(() => {
                const input = this.textareaRef.current;
                if (!input) return;
                input.focus();
                input.setSelectionRange(start, end);
            }, 0);
        } else {
            this.setState({ topic: text, appliedTemplateLabel: template.label, templatePlaceholderRange: null }, this.autoResizeTextarea);

            setTimeout(() => {
                this.textareaRef.current?.focus();
            }, 0);
        }
    };

    private handleReselectTemplate = () => {
        this.setState({ topic: "", appliedTemplateLabel: "", templatePlaceholderRange: null }, this.autoResizeTextarea);
        setTimeout(() => {
            this.textareaRef.current?.focus();
        }, 0);
    };

    private handleInputFocus = () => {
        const { templatePlaceholderRange, topic } = this.state;
        if (!templatePlaceholderRange) return;
        const [start, end] = templatePlaceholderRange;
        const newTopic = topic.substring(0, start) + topic.substring(end);
        this.setState({ topic: newTopic, templatePlaceholderRange: null }, () => {
            this.textareaRef.current?.setSelectionRange(start, start);
        });
    };

    autoResizeTextarea = () => {
        const el = this.textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    };

    getScheduleLabel(cfg: ScheduleConfig): string {
        const { cron_expr, interval_days, interval_months, run_time, day_of_week, day_of_month } = scheduleToParams(cfg);
        return describeSchedule(cron_expr, interval_days, interval_months, run_time, day_of_week, day_of_month);
    }

    canSubmit(): boolean {
        return this.state.topic.trim().length > 0;
    }

    handleVoiceTranscribed = (text: string, mode: ReplaceMode, savedRange?: SelectionRange) => {
        if (mode === "all") {
            this.setState({ topic: text.slice(0, 1000) }, this.autoResizeTextarea);
        } else if (mode === "selection" && savedRange) {
            // Note: savedRange indices are from recording start; assumes input is read-only during recording
            this.setState((prev) => {
                const updated = prev.topic.slice(0, savedRange.from) + text + prev.topic.slice(savedRange.to);
                return { topic: updated.slice(0, 1000) };
            }, this.autoResizeTextarea);
        } else {
            this.setState((prev) => {
                const pos = savedRange?.from ?? prev.topic.length;
                const updated = prev.topic.slice(0, pos) + text + prev.topic.slice(pos);
                return { topic: updated.slice(0, 1000) };
            }, this.autoResizeTextarea);
        }
    };

    handleSubmit = async () => {
        const { topic, selectedChats, selectedMembers, scheduleConfig } = this.state;
        if (!this.canSubmit()) return;
        const summaryTitle = deriveSummaryTitle(topic);

        this.setState({ submitting: true, error: null });
        try {
            const params: CreateSummaryParams = {
                topic: topic.trim(),
                title: summaryTitle,
                summary_mode: SummaryMode.BY_PERSON,
            };

            if (selectedChats.length > 0) {
                // 不传 source_name：让后端按 source_id 现查 IM 库最新群名（带类型后缀）。
                // 避免把创建那一刻的群名冻结进定时配置，从而群改名后定时仍显示旧名。
                params.sources = selectedChats.map((c) => ({
                    source_type: c.chat_type === "group" ? SourceType.GROUP_CHAT
                               : c.chat_type === "thread" ? SourceType.THREAD
                               : SourceType.DIRECT_MESSAGE,
                    source_id: c.chat_id,
                }));
            }

            if (selectedMembers.length > 0) {
                params.participants = selectedMembers.map((m) => ({ user_id: m.user_id }));
                params.summary_mode = SummaryMode.BY_PERSON;
            }

            const result = await api.createSummary(params);

            // If schedule is configured, create it in ONE step bound to the new task.
            // 后端 create 接口在 scope='task' + task_id 下已在一个事务里原子完成
            //   校验 task 归属 → 建定时 → Update summary_task.schedule_id 绑定（一对一约束）。
            // 不再需要第二步 update 绑定，也不会产生游离定时，所以去掉 B2 回滚。
            if (scheduleConfig !== null) {
                const { cron_expr, interval_days, interval_months, day_of_week, day_of_month, run_time } = scheduleToParams(scheduleConfig);
                // V5/§6.1：多人（participants 非空）+ 定时默认 confirm_policy=1（一次性确认）；
                // 单人定时不传（走后端 AUTO 兜底）。
                const isMultiPerson = !!params.participants && params.participants.length > 0;
                try {
                    await api.createSchedule({
                        title: summaryTitle,
                        summary_mode: params.summary_mode || SummaryMode.BY_PERSON,
                        cron_expr,
                        interval_days,
                        interval_months,
                        day_of_week,
                        day_of_month,
                        run_time,
                        time_range_type: 2,
                        sources: params.sources || [],
                        participants: params.participants,
                        ...(isMultiPerson ? { confirm_policy: 1 } : {}),
                        scope: 'task',
                        task_id: result.task_id,
                    });
                } catch (scheduleErr: any) {
                    // 总结本身已创建成功；定时创建失败仅提示（后端返回中文 message）。
                    Toast.error(scheduleErr.message || t("summary.create.scheduleFailed"));
                }
            }

            Toast.success(t("summary.create.success"));
            WKApp.routeRight.popToRoot();
            WKApp.routeRight.push(<SummaryDetailPage taskId={result.task_id} />);
            this.props.onCreated?.();
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.createFailed") });
            Toast.error(err.message || t("summary.common.createFailed"));
        } finally {
            this.setState({ submitting: false });
        }
    };

    /**
     * Agent 多轮交互问答。
     *
     * 与 handleSubmit 的区别：不建 task / 不跳详情页 / 不调 createAgentSummary，
     * 只做「多轮气泡 UI + session_id」。同一会话复用同一 session_id，
     * 后端据此按会话持久化多轮记忆（滑窗保留最近若干轮），追问可续上下文。
     */
    handleAgentSend = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || this.state.agentSubmitting) return;
        // 同步锁：在读/生成 sessionId 之前拦并发，确保 sessionId 只生成一次。
        if (this.agentSendInFlight) return;
        this.agentSendInFlight = true;

        // 惰性生成 session_id，整会话复用。
        const sessionId = this.state.sessionId || genSessionId();
        // 持久化到 localStorage：关闭/刷新后再进来可按 session_id 拉回历史（「退出不丢」）。
        writeAgentChatSession(this.agentChannelId(), sessionId);

        this.setState((prev) => ({
            messages: [...prev.messages, { role: 'user', content: trimmed }],
            sessionId,
            agentSubmitting: true,
            error: null,
        }));

        try {
            const res = await api.agentChat({ message: trimmed, session_id: sessionId, profile: 'summary' });
            // 后端回传 session_id 非空则回填并持久化（与后端持久化的会话保持一致）。
            const nextSessionId = res.session_id || sessionId;
            writeAgentChatSession(this.agentChannelId(), nextSessionId);
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: res.reply }],
                sessionId: nextSessionId,
            }));
        } catch (err: any) {
            // 失败：Toast + 追一条 assistant 错误气泡（让失败在对话流里可见）。
            const msg = err?.message || t("summary.common.createFailed");
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

    /** SSE 模式：追加 user 消息(仅 UI,不发请求)。 */
    handleAgentUserMessage = (text: string, incomingSessionId?: string) => {
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
    handleAgentAssistantMessage = (text: string, sessionId?: string) => {
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
    handlePrimaryClick = () => {
        if (this.state.mode !== 'agent') {
            void this.handleSubmit();
        }
    };

    /** 下拉菜单选择模式：切到 agent 时从 localStorage 恢复 session_id 并回显历史。 */
    handleSelectMode = (mode: 'normal' | 'agent') => {
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
        // 恢复引用总结与 session 同生命周期：storage 里有 → 自动回填。
        // 无 → 保持 state 现值（可能是 mount 时 derivedFromTask 塞进来的）。
        const storedRef = readAgentChatReferenced(this.agentChannelId());
        this.setState((prev) => ({
            mode: 'agent',
            sessionId: stored || prev.sessionId,
            referencedTask: storedRef
                ? { task_id: storedRef.task_id, title: storedRef.title } as SummaryListItem
                : prev.referencedTask,
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
            const data = await api.getAgentChatHistory(sessionId);
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
    handleNewSession = () => {
        clearAgentChatSession(this.agentChannelId());
        // 引用总结跟 session 同生命周期 → 一起清。
        clearAgentChatReferenced(this.agentChannelId());
        // 作废在途历史拉取，避免旧会话历史回灌到新会话。
        this.historyLoadToken++;
        this.setState({
            messages: [],
            sessionId: '',
            referencedTask: null,
            showReferencePicker: false,
            error: null,
        });
    };

    /**
     * 渲染 chat header 里的"引用总结"入口 + 已选引用卡片。
     * - 未选中: 显示一个「+ 引用总结」按钮
     * - 已选中: 显示引用卡片(标题 + task_id + ✕ 移除)
     *
     * 引用**全程可增减**(不再首轮锁定) —— 后端每轮都会重新拼引用进 system,
     * 见 CHAT-REFERENCE-BASED-DESIGN-v1 多轮上下文修复。
     */
    private renderReferenceHeader = (translate: (k: string) => string): React.ReactNode => {
        const { referencedTask } = this.state;

        if (referencedTask) {
            return (
                <div
                    className="summary-workbench-ref-card"
                    onClick={() => this.setState((prev) => ({ sidePanelOpen: !prev.sidePanelOpen }))}
                    style={{ cursor: 'pointer' }}
                    title={translate('summary.chatReference.previewTitle')}
                >
                    <span className="summary-workbench-ref-card-label">
                        {translate('summary.chatReference.badge')}
                    </span>
                    <span className="summary-workbench-ref-card-title">
                        {referencedTask.title || `task_id=${referencedTask.task_id}`}
                    </span>
                    <span
                        className="summary-workbench-ref-card-remove"
                        onClick={(e) => {
                            // 阻止事件冒泡触发卡片 onClick (toggle SidePanel)
                            e.stopPropagation();
                            // 移除引用同时强制关闭 SidePanel(引用没了没意义再显示)
                            this.setState({ referencedTask: null, sidePanelOpen: false });
                            // 引用同步清持久化，避免 refresh 后又回填。
                            clearAgentChatReferenced(this.agentChannelId());
                        }}
                        title={translate('summary.chatReference.remove')}
                    >
                        ✕
                    </span>
                </div>
            );
        }
        return (
            <span
                className="summary-workbench-ref-btn"
                onClick={() => this.setState({ showReferencePicker: true })}
                title={translate('summary.chatReference.buttonTip')}
            >
                📎 {translate('summary.chatReference.button')}
            </span>
        );
    };

    /** 保存为总结（agent 模式）。将当前 session 的产出落库为可检索的交付物。返回成功/失败。 */
    handleSaveAsSummary = async (title: string): Promise<boolean> => {
        const { sessionId, selectedChats, selectedMembers } = this.state;
        const { t } = this.context;
        
        if (!sessionId) {
            Toast.warning(t('summary.create.noOutputToSave'));
            return false;
        }

        this.setState({ savingSummary: true });
        try {
            // origin_channel_id / origin_channel_type 不再由前端传入 —— 后端会从
            // session 的 tool_calls 反查 agent 实际读过的第一个 channel_id 作为
            // origin(见 handler/agent_summary.go)。整页入口 currentChannel 一定
            // 是 undefined,弹窗入口也不再依赖 channel prop,统一走后端反查。
            const params: CreateAgentSummaryParams = {
                session_id: sessionId,
                title,
            };

            if (selectedChats.length > 0) {
                params.sources = selectedChats.map((c) => ({
                    source_type: c.chat_type === "group" ? SourceType.GROUP_CHAT
                               : c.chat_type === "thread" ? SourceType.THREAD
                               : SourceType.DIRECT_MESSAGE,
                    source_id: c.chat_id,
                }));
            }

            if (selectedMembers.length > 0) {
                params.participants = selectedMembers.map((m) => ({ 
                    user_id: m.user_id,
                    user_name: m.name,
                }));
            }

            // 引用总结:如果用户在 chat 首轮引用了已有总结,把 task_id 附带过去,
            // 后端会记录到 SummaryTask.referenced_task_ids 供未来做衍生关系追溯。
            // 见 CHAT-REFERENCE-BASED-DESIGN-v1。
            if (this.state.referencedTask) {
                params.referenced_task_ids = [this.state.referencedTask.task_id];
            }

            const result = await api.createAgentSummary(params);

            Toast.success(t('summary.create.agentSummaryCreated'));

            // 保存成功 → 销毁 chat session 工作台:
            //   1. 清 localStorage 里的 session_id(不然下次进 agent 会误恢复空 session)
            //   2. 重置组件内 state(messages/sessionId/referencedTask)
            //   3. 后端会在保存事务里 DELETE agent_message 表对应行
            clearAgentChatSession(this.agentChannelId());
            // 引用总结跟 session 同生命周期 → 一起清。
            clearAgentChatReferenced(this.agentChannelId());
            this.historyLoadToken++;
            this.setState({
                messages: [],
                sessionId: '',
                referencedTask: null,
                showReferencePicker: false,
            });

            // dispatch 刷新事件。agent 整页入口下前端已不再持有具体 channel
            // (origin 由后端从 tool_calls 反查),下游刷新监听按 taskId 走即可,
            // channelId 传空串以保持事件字段结构不变、避免 undefined 引用崩溃。
            const event = new CustomEvent('chat-summary-created', {
                detail: { taskId: result.task_id, channelId: '' }
            });
            window.dispatchEvent(event);
            
            // 跳转到详情页
            WKApp.routeRight.popToRoot();
            WKApp.routeRight.push(<SummaryDetailPage taskId={result.task_id} />);
            this.props.onCreated?.();
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
                // 40001: origin_channel_id 反查失败(通常是引用总结退出重进后
                // referencedTask 丢失,前端没发 referenced_task_ids,后端 fallback
                // 借 origin 无路可走)。给友好文案指导用户下一步动作。
                // 见 SUM-161 fast-follow · CHAT-REFERENCE-BASED-DESIGN-v1。
                if (code === 40001) {
                    Toast.error(t('summary.create.savedReferenceLostRetry'));
                    return false;
                }
            }
            // 其他错误
            const message = err instanceof Error ? err.message : t('summary.common.createFailedRetry');
            Toast.error(message);
            return false;
        } finally {
            this.setState({ savingSummary: false });
        }
    };


    render() {
        const {
            topic,
            appliedTemplateLabel,
            customTemplateLimit,
            mode,
            templates,
            selectedChats, selectedMembers, scheduleConfig,
            showChatSelector, showMemberSelector, showScheduleConfig, showMoreTemplates,
            submitting, agentSubmitting, error, editingTemplate, creatingCustomTemplate,
            editingTemplateLabel, editingTemplateDescription, savingTemplate,
            messages,
        } = this.state;
        const { t: translate } = this.context;
        // 模板在 render() 用当前 locale 解析，切语言即时刷新（不在 state 烘焙）。
        const resolvedTemplates = templates.map((tpl) => resolveTemplate(tpl, translate));
        const builtinTemplates = resolvedTemplates.filter((tpl) => !tpl.is_custom);
        const primaryBuiltinTemplates = builtinTemplates.slice(0, 4);
        const moreBuiltinTemplates = builtinTemplates.slice(4);
        const customTemplates = resolvedTemplates.filter((tpl) => tpl.is_custom);
        const canCreateCustomTemplate = customTemplates.length < customTemplateLimit;
        const isCustomEditor = creatingCustomTemplate || !!editingTemplate?.is_custom;
        const templateEditorVisible = creatingCustomTemplate || !!editingTemplate;

        return (
            <div className="summary-workbench">
                {/* Header */}
                <div className="summary-workbench-header">
                    <div className="summary-workbench-icon">🤖</div>
                    <div>
                        <div className="summary-workbench-title">{translate("summary.create.title")}</div>
                        <div className="summary-workbench-desc">
                            {translate("summary.create.desc")}
                        </div>
                    </div>
                </div>

                {/* Main input */}
                <div className="summary-workbench-input-area">
                    {mode === 'agent' ? (
                        // Agent 交互式问答：面板自带输入框，隐藏顶部大 textarea + 4 模板卡片。
                        // SidePanel 打开时: 加 --with-side class → flex 左右分栏
                        //   左: main (AgentChatPanel 撑满剩余宽度)
                        //   右: SummaryReferenceSidePanel (400px 固定)
                        <div
                            className={
                                "summary-workbench-agent-chat" +
                                (this.state.sidePanelOpen && this.state.referencedTask
                                    ? " summary-workbench-agent-chat--with-side"
                                    : "")
                            }
                        >
                            <div className="summary-workbench-agent-chat-main">
                                <AgentChatPanel
                                    useStream={true}
                                    onUserMessage={this.handleAgentUserMessage}
                                    onAssistantMessage={this.handleAgentAssistantMessage}
                                    sessionId={this.state.sessionId}
                                    profile={this.state.referencedTask ? "summary_refine" : "summary"}
                                    messages={messages}
                                    onSend={this.handleAgentSend}
                                    sending={agentSubmitting}
                                    welcome={translate("summary.create.agentChatWelcome")}
                                    onSaveAsSummary={this.handleSaveAsSummary}
                                    savingSummary={this.state.savingSummary}
                                    onNewSession={this.handleNewSession}
                                    referencedTaskIds={
                                        this.state.referencedTask
                                            ? [this.state.referencedTask.task_id]
                                            : undefined
                                    }
                                    referenceHeader={this.renderReferenceHeader(translate)}
                                />
                            </div>
                            {/* 右侧引用对照面板 (Q1: 400px 固定 · Q2: 默认收起 · Q4: 切引用跟着变) */}
                            {this.state.sidePanelOpen && this.state.referencedTask && (
                                <SummaryReferenceSidePanel
                                    taskId={this.state.referencedTask.task_id}
                                    onClose={() => this.setState({ sidePanelOpen: false })}
                                />
                            )}
                            <SummaryReferencePicker
                                visible={this.state.showReferencePicker}
                                onCancel={() => this.setState({ showReferencePicker: false })}
                                onSelect={(task) => {
                                    this.setState({
                                        referencedTask: task,
                                        showReferencePicker: false,
                                    });
                                    // 用户选择新引用 → 同步持久化 → refresh 后仍在。
                                    writeAgentChatReferenced(this.agentChannelId(), {
                                        task_id: task.task_id,
                                        title: task.title ?? '',
                                    });
                                }}
                                selectedTaskId={this.state.referencedTask?.task_id}
                            />
                            {/* Modal 保留:未来其他触发点(比如详情页快照预览)可复用;主 UI 已改用 SidePanel */}
                            <SummaryPreviewModal
                                taskId={this.state.previewTaskId}
                                onClose={() => this.setState({ previewTaskId: null })}
                            />
                        </div>
                    ) : (
                        <>
                    <div style={{ position: "relative" }}>
                        <textarea
                            ref={this.textareaRef}
                            className="summary-workbench-textarea"
                            value={topic}
                            onChange={(e) => {
                                this.setState({ topic: e.target.value.slice(0, 1000), templatePlaceholderRange: null });
                                this.autoResizeTextarea();
                            }}
                            onFocus={this.handleInputFocus}
                            placeholder={mode === 'agent'
                                ? translate("summary.create.agentTopicPlaceholder")
                                : translate("summary.create.topicPlaceholder")}
                            rows={1}
                            maxLength={1000}
                        />
                        <VoiceInputButton
                            inputRef={this.textareaRef}
                            onTranscribed={this.handleVoiceTranscribed}
                            getCurrentText={() => this.state.topic}
                            showModeMenu
                            size="sm"
                            className="wk-vib--textarea-corner"
                        />
                    </div>
                    {topic.length >= 1000 && (
                        <div style={{ color: "var(--semi-color-warning)", fontSize: 12, marginTop: 4, padding: "0 16px 8px" }}>
                            {translate("summary.common.charLimitReached", { values: { count: 1000 } })}
                        </div>
                    )}
                    {topic.trim() && appliedTemplateLabel && (
                        <div className="summary-template-applied-bar">
                            <span className="summary-template-applied-text">
                                {translate("summary.templates.custom.applied", { values: { name: appliedTemplateLabel } })}
                            </span>
                            <button
                                type="button"
                                className="summary-template-applied-action"
                                onClick={this.handleReselectTemplate}
                            >
                                {translate("summary.templates.custom.reselect")}
                            </button>
                        </div>
                    )}

                    {/* Templates (nested inside the input panel, like the modal) */}
                    {!topic.trim() && (
                        <>
                            <div className="summary-template-section-header summary-workbench-templates-heading">
                                <div className="summary-workbench-templates-label">{translate("summary.create.templatesTitle")}</div>
                                {moreBuiltinTemplates.length > 0 && (
                                    <button
                                        type="button"
                                        className="summary-template-more-button"
                                        onClick={() => this.setState({ showMoreTemplates: true })}
                                    >
                                        {translate("summary.templates.custom.moreTemplates")}
                                    </button>
                                )}
                            </div>
                            <div className="summary-workbench-templates">
                                {primaryBuiltinTemplates.map((tpl) => (
                                    <TemplateCard
                                        key={tpl.id}
                                        template={tpl}
                                        onClick={this.handleTemplateClick}
                                        onEdit={this.handleTemplateEdit}
                                        editLabel={translate("summary.templates.custom.edit")}
                                    />
                                ))}
                            </div>
                            <div className="summary-template-custom-section">
                                <div className="summary-template-custom-header">
                                    <div className="summary-template-custom-title">
                                        {translate("summary.templates.custom.myTemplatesTitleWithCount", { values: { count: customTemplates.length, limit: customTemplateLimit } })}
                                    </div>
                                    <Button
                                        theme="borderless"
                                        size="small"
                                        icon={<IconPlus />}
                                        disabled={!canCreateCustomTemplate}
                                        onClick={this.handleCustomTemplateCreate}
                                    >
                                        {translate("summary.templates.custom.new")}
                                    </Button>
                                </div>
                                {!canCreateCustomTemplate && (
                                    <div className="summary-template-limit-hint">
                                        {translate("summary.templates.custom.limitReached")}
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
                                                editLabel={translate("summary.templates.custom.edit")}
                                                deleteLabel={translate("summary.templates.custom.delete")}
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
                                            {translate("summary.templates.custom.emptyTitle")}
                                        </span>
                                        <span className="summary-template-custom-empty-desc">
                                            {translate("summary.templates.custom.emptyDesc")}
                                        </span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                        </>
                    )}

                    {/* Action bar */}
                    <div className="summary-workbench-actions">
                        <div className="summary-workbench-actions-left">
                            {mode !== 'agent' && (
                                <>
                                {/* 选择聊天 */}
                                <Button
                                    theme="borderless"
                                    icon={<IconPlus />}
                                    size="small"
                                    onClick={() => this.setState({ showChatSelector: true })}
                                    style={{ color: selectedChats.length > 0 ? "var(--semi-color-primary)" : undefined }}
                                >
                                    {selectedChats.length > 0
                                        ? translate("summary.create.selectedChats", { values: { count: selectedChats.length } })
                                        : translate("summary.create.selectChat")}
                                </Button>
                                {/* 选择参与者：多人协作入口。打开 MemberSelectorModal 选 participants，
                                    与「选择聊天 / 定时」并列在创建页操作栏，确保多人入口在 UI 上可达。 */}
                                <Button
                                    theme="borderless"
                                    icon={<IconUserGroup />}
                                    size="small"
                                    onClick={() => this.setState({ showMemberSelector: true })}
                                    style={{ color: selectedMembers.length > 0 ? "var(--semi-color-primary)" : undefined }}
                                >
                                    {selectedMembers.length > 0
                                        ? translate("summary.create.selectedMembers", { values: { count: selectedMembers.length } })
                                        : translate("summary.create.selectMembers")}
                                </Button>
                                <Button
                                    theme="borderless"
                                    icon={<IconClock />}
                                    size="small"
                                    onClick={() => this.setState({ showScheduleConfig: true })}
                                    style={{ color: scheduleConfig ? "var(--semi-color-primary)" : undefined }}
                                >
                                    {scheduleConfig
                                        ? this.getScheduleLabel(scheduleConfig)
                                        : translate("summary.schedule.config.title")}
                                </Button>
                                </>
                            )}
                            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--semi-color-text-2)" }}>
                                {translate("summary.create.archivedNotice")}
                            </span>
                        </div>

                        <SplitButtonGroup className="chat-summary-modal-split">
                            {/* agent 模式下输入走面板底部输入框，隐藏主「开始」按钮；normal 保持不变。 */}
                            {mode !== 'agent' && (
                                <Button
                                    theme="solid"
                                    size="default"
                                    loading={submitting || agentSubmitting}
                                    disabled={!this.canSubmit() || submitting || agentSubmitting}
                                    onClick={this.handlePrimaryClick}
                                >
                                    {submitting ? translate("summary.create.submitting") : translate("summary.create.start")}
                                </Button>
                            )}
                            <Dropdown
                                trigger="click"
                                position="bottomRight"
                                render={(
                                    <Dropdown.Menu>
                                        <Dropdown.Item
                                            active={mode !== 'agent'}
                                            onClick={() => this.handleSelectMode('normal')}
                                        >
                                            {translate("summary.create.start")}
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            active={mode === 'agent'}
                                            onClick={() => this.handleSelectMode('agent')}
                                        >
                                            {translate("summary.create.agentStart")}
                                        </Dropdown.Item>
                                    </Dropdown.Menu>
                                )}
                            >
                                <Button
                                    theme="solid"
                                    size="default"
                                    disabled={submitting || agentSubmitting}
                                    icon={<IconChevronDown />}
                                    aria-label={translate("summary.create.switchMode")}
                                />
                            </Dropdown>
                        </SplitButtonGroup>
                    </div>
                </div>

                {/* Selected chats summary */}
                {selectedChats.length > 0 && (
                    <div className="summary-workbench-selected-chats">
                        {selectedChats.map((c) => (
                            <Tag
                                key={c.chat_id}
                                closable
                                onClose={() => this.setState({
                                    selectedChats: selectedChats.filter((x) => x.chat_id !== c.chat_id)
                                })}
                                style={{ marginRight: 6, marginBottom: 4 }}
                            >
                                {c.name}
                            </Tag>
                        ))}
                    </div>
                )}

                {/* Selected members summary */}
                {selectedMembers.length > 0 && (
                    <div className="summary-workbench-selected-members">
                        {selectedMembers.map((m) => (
                            <Avatar
                                key={m.user_id}
                                size="extra-small"
                                style={{ marginRight: 4, background: "var(--semi-color-primary)", cursor: "pointer" }}
                                title={m.name}
                                onClick={() => this.setState({
                                    selectedMembers: selectedMembers.filter((x) => x.user_id !== m.user_id)
                                })}
                            >
                                {m.name.slice(0, 1)}
                            </Avatar>
                        ))}
                    </div>
                )}

                {error && (
                    <Text type="danger" style={{ display: "block", marginTop: 8 }}>
                        {error}
                    </Text>
                )}

                {/* Modals */}
                <ChatSelectorModal
                    visible={showChatSelector}
                    selected={selectedChats}
                    maxSelect={MAX_CHAT_SELECT}
                    onConfirm={(chats) => this.setState({ selectedChats: chats, showChatSelector: false })}
                    onCancel={() => this.setState({ showChatSelector: false })}
                />
                <MemberSelectorModal
                    visible={showMemberSelector}
                    selected={selectedMembers}
                    onConfirm={(members) => this.setState({ selectedMembers: members, showMemberSelector: false })}
                    onCancel={() => this.setState({ showMemberSelector: false })}
                />
                <ScheduleConfigModal
                    visible={showScheduleConfig}
                    value={scheduleConfig ?? { unit: "week", every: 1, time: "09:00" }}
                    onConfirm={(cfg) => this.setState({ scheduleConfig: cfg, showScheduleConfig: false })}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                    showGenerationInstruction={false}
                />
                <Modal
                    visible={showMoreTemplates}
                    title={translate("summary.templates.custom.moreTemplatesTitle")}
                    onCancel={() => this.setState({ showMoreTemplates: false })}
                    footer={null}
                    width={720}
                    className="summary-more-template-modal"
                >
                    <div className="summary-more-template-grid">
                        {moreBuiltinTemplates.map((tpl) => (
                            <TemplateCard
                                key={tpl.id}
                                template={tpl}
                                onClick={this.handleMoreTemplateClick}
                                onEdit={this.handleTemplateEdit}
                                editLabel={translate("summary.templates.custom.edit")}
                            />
                        ))}
                    </div>
                </Modal>
                <Modal
                    visible={templateEditorVisible}
                    title={translate(creatingCustomTemplate
                        ? "summary.templates.custom.createTitle"
                        : isCustomEditor
                        ? "summary.templates.custom.editCustomTitle"
                        : "summary.templates.custom.editTitle")}
                    onCancel={this.closeTemplateEdit}
                    footer={null}
                    width={560}
                    maskClosable={!savingTemplate}
                >
                    <div className="summary-template-edit-field">
                        <label className="summary-template-edit-label">
                            {translate("summary.templates.custom.nameLabel")}
                        </label>
                        <input
                            className="summary-template-edit-input"
                            value={editingTemplateLabel}
                            maxLength={100}
                            disabled={savingTemplate}
                            placeholder={translate("summary.templates.custom.namePlaceholder")}
                            onChange={(e) => this.setState({ editingTemplateLabel: e.target.value.slice(0, 100) })}
                        />
                    </div>
                    <div className="summary-template-edit-field">
                        <label className="summary-template-edit-label">
                            {translate("summary.templates.custom.descriptionLabel")}
                        </label>
                        <textarea
                            className="summary-template-edit-input summary-template-edit-desc"
                            value={editingTemplateDescription}
                            maxLength={200}
                            disabled={savingTemplate}
                            placeholder={translate("summary.templates.custom.descriptionPlaceholder")}
                            onChange={(e) => this.setState({ editingTemplateDescription: e.target.value.slice(0, 200) })}
                        />
                    </div>
                    <div className="summary-template-edit-hint">
                        {translate("summary.templates.custom.editHint")}
                    </div>
                    <div className="summary-editor-actions summary-template-edit-actions">
                        {editingTemplate?.is_custom && (
                            <Button type="danger" onClick={() => this.requestCustomTemplateDelete()} disabled={savingTemplate}>
                                {translate("summary.templates.custom.delete")}
                            </Button>
                        )}
                        {editingTemplate && !editingTemplate.is_custom && (
                            <Button onClick={this.handleTemplateReset} disabled={savingTemplate}>
                                {translate("summary.templates.custom.reset")}
                            </Button>
                        )}
                        <Button onClick={this.closeTemplateEdit} disabled={savingTemplate}>
                            {translate("summary.common.cancel")}
                        </Button>
                        <Button
                            theme="solid"
                            loading={savingTemplate}
                            disabled={!editingTemplateLabel.trim() || !editingTemplateDescription.trim() || savingTemplate}
                            onClick={this.handleTemplateSave}
                        >
                            {translate("summary.common.save")}
                        </Button>
                    </div>
                </Modal>
            </div>
        );
    }
}
