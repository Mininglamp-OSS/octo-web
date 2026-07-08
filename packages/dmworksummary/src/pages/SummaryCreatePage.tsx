import React, { Component, createRef } from "react";
import {
    Button,
    Toast,
    Typography,
    Tag,
    Avatar,
    Dropdown,
    SplitButtonGroup,
} from "@douyinfe/semi-ui";
import { IconPlus, IconClock, IconUserGroup, IconChevronDown } from "@douyinfe/semi-icons";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import * as api from "../api/summaryApi";
import { getTopicTemplates } from "../api/summaryApi";
import SummaryDetailPage from "./SummaryDetailPage";
import ChatSelectorModal from "../components/ChatSelectorModal";
import MemberSelectorModal from "../components/MemberSelectorModal";
import ScheduleConfigModal from "../components/ScheduleConfigModal";
import TemplateCard from "../components/TemplateCard";
import AgentChatPanel from "../components/AgentChatPanel";
import { TOPIC_TEMPLATES } from "../constants/templates";
import { MAX_CHAT_SELECT } from "../constants/limits";
import type {
    CreateSummaryParams,
    ChatMessage,
    ChatCandidate,
    MemberCandidate,
    ScheduleConfig,
    TopicTemplate,
} from "../types/summary";
import { SummaryMode, SourceType } from "../types/summary";
import { describeSchedule, scheduleToParams, genSessionId } from "../utils/summaryHelpers";
import { resolveTemplate, computeTemplateSelection, type ResolvableTemplate } from "../utils/templateResolver";

const { Text } = Typography;

interface SummaryCreatePageProps {
    onCreated?: () => void;
}

interface SummaryCreatePageState {
    topic: string;
    mode: 'normal' | 'agent';
    templates: ResolvableTemplate[];
    templatePlaceholderRange: [number, number] | null;
    selectedChats: ChatCandidate[];
    selectedMembers: MemberCandidate[];
    scheduleConfig: ScheduleConfig | null;
    showChatSelector: boolean;
    showMemberSelector: boolean;
    showScheduleConfig: boolean;
    submitting: boolean;
    agentSubmitting: boolean;
    // Agent 多轮问答：气泡 UI + session_id。后端按 session_id 持久化记忆，同一会话复用即可续上下文。
    messages: ChatMessage[];
    sessionId: string;
    error: string | null;
}

export default class SummaryCreatePage extends Component<SummaryCreatePageProps, SummaryCreatePageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private textareaRef = createRef<HTMLTextAreaElement>();

    state: SummaryCreatePageState = {
        topic: "",
        mode: 'normal',
        templates: TOPIC_TEMPLATES,
        templatePlaceholderRange: null,
        selectedChats: [],
        selectedMembers: [],
        scheduleConfig: null,
        showChatSelector: false,
        showMemberSelector: false,
        showScheduleConfig: false,
        submitting: false,
        agentSubmitting: false,
        messages: [],
        sessionId: '',
        error: null,
    };

    // 同步实例锁：防快速双击/回车的竞态（React state 未刷新时仍能拦住第二次）。
    private agentSendInFlight = false;

    componentDidMount() {
        void this.loadTemplates();
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
            this.setState({ topic: text, templatePlaceholderRange: [start, end] }, this.autoResizeTextarea);

            setTimeout(() => {
                const input = this.textareaRef.current;
                if (!input) return;
                input.focus();
                input.setSelectionRange(start, end);
            }, 0);
        } else {
            this.setState({ topic: text, templatePlaceholderRange: null }, this.autoResizeTextarea);

            setTimeout(() => {
                this.textareaRef.current?.focus();
            }, 0);
        }
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

        this.setState({ submitting: true, error: null });
        try {
            const params: CreateSummaryParams = {
                topic: topic.trim(),
                title: topic.trim(),
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
                        title: topic.trim(),
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

        this.setState((prev) => ({
            messages: [...prev.messages, { role: 'user', content: trimmed }],
            sessionId,
            agentSubmitting: true,
            error: null,
        }));

        try {
            const res = await api.agentChat({ message: trimmed, session_id: sessionId });
            this.setState((prev) => ({
                messages: [...prev.messages, { role: 'assistant', content: res.reply }],
                // 后端回传 session_id 非空则回填（与后端持久化的会话保持一致）。
                sessionId: res.session_id || prev.sessionId,
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
    handlePrimaryClick = () => {
        if (this.state.mode !== 'agent') {
            void this.handleSubmit();
        }
    };

    /** 下拉菜单选择模式：只切换 mode。首次进入 agent 时惰性生成 session_id。 */
    handleSelectMode = (mode: 'normal' | 'agent') => {
        this.setState((prev) => ({
            mode,
            sessionId: mode === 'agent' && !prev.sessionId ? genSessionId() : prev.sessionId,
        }));
    };

    render() {
        const {
            topic,
            mode,
            templates,
            selectedChats, selectedMembers, scheduleConfig,
            showChatSelector, showMemberSelector, showScheduleConfig,
            submitting, agentSubmitting, error,
            messages,
        } = this.state;
        const { t: translate } = this.context;
        // 模板在 render() 用当前 locale 解析，切语言即时刷新（不在 state 烘焙）。
        const resolvedTemplates = templates.map((tpl) => resolveTemplate(tpl, translate));

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
                        <div className="summary-workbench-agent-chat">
                            <AgentChatPanel
                                messages={messages}
                                onSend={this.handleAgentSend}
                                sending={agentSubmitting}
                                welcome={translate("summary.create.agentChatWelcome")}
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

                    {/* Templates (nested inside the input panel, like the modal) */}
                    {!topic.trim() && (
                        <>
                            <div className="summary-workbench-templates-label">{translate("summary.create.templatesTitle")}</div>
                            <div className="summary-workbench-templates">
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

                    {/* Action bar */}
                    <div className="summary-workbench-actions">
                        <div className="summary-workbench-actions-left">
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
                />
            </div>
        );
    }
}
