import React, { Component, createRef } from "react";
import {
    Button,
    Toast,
    Typography,
    Tag,
    Avatar,
} from "@douyinfe/semi-ui";
import { IconPlus } from "@douyinfe/semi-icons";
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
import { TOPIC_TEMPLATES } from "../constants/templates";
import { MAX_CHAT_SELECT } from "../constants/limits";
import type {
    CreateSummaryParams,
    ChatCandidate,
    MemberCandidate,
    ScheduleConfig,
    TopicTemplate,
} from "../types/summary";
import { SummaryMode, SourceType } from "../types/summary";
import { getWeekdayName, scheduleToCron } from "../utils/summaryHelpers";
import { resolveTemplate, computeTemplateSelection, type ResolvableTemplate } from "../utils/templateResolver";

const { Text } = Typography;

interface SummaryCreatePageProps {
    onCreated?: () => void;
}

interface SummaryCreatePageState {
    topic: string;
    templates: ResolvableTemplate[];
    templatePlaceholderRange: [number, number] | null;
    selectedChats: ChatCandidate[];
    selectedMembers: MemberCandidate[];
    scheduleConfig: ScheduleConfig | null;
    showChatSelector: boolean;
    showMemberSelector: boolean;
    showScheduleConfig: boolean;
    submitting: boolean;
    error: string | null;
}

export default class SummaryCreatePage extends Component<SummaryCreatePageProps, SummaryCreatePageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private textareaRef = createRef<HTMLTextAreaElement>();

    state: SummaryCreatePageState = {
        topic: "",
        templates: TOPIC_TEMPLATES,
        templatePlaceholderRange: null,
        selectedChats: [],
        selectedMembers: [],
        scheduleConfig: null,
        showChatSelector: false,
        showMemberSelector: false,
        showScheduleConfig: false,
        submitting: false,
        error: null,
    };

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
        if (cfg.period === "daily") {
            return t("summary.create.scheduleDaily", { values: { time: cfg.time } });
        }
        if (cfg.period === "weekly") {
            return t("summary.create.scheduleWeekly", {
                values: { day: getWeekdayName(cfg.dayOfWeek ?? 1), time: cfg.time },
            });
        }
        return t("summary.create.scheduleMonthly", {
            values: { day: cfg.dayOfMonth ?? 1, time: cfg.time },
        });
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
                params.sources = selectedChats.map((c) => ({
                    source_type: c.chat_type === "group" ? SourceType.GROUP_CHAT
                               : c.chat_type === "thread" ? SourceType.THREAD
                               : SourceType.DIRECT_MESSAGE,
                    source_id: c.chat_id,
                    source_name: c.name,
                }));
            }

            if (selectedMembers.length > 0) {
                params.participants = selectedMembers.map((m) => ({ user_id: m.user_id }));
                params.summary_mode = SummaryMode.BY_PERSON;
            }

            const result = await api.createSummary(params);

            // If schedule is configured, create schedule too
            if (scheduleConfig !== null) {
                const cronExpr = scheduleToCron(scheduleConfig);
                try {
                    await api.createSchedule({
                        title: topic.trim(),
                        summary_mode: params.summary_mode || SummaryMode.BY_PERSON,
                        cron_expr: cronExpr,
                        time_range_type: 2,
                        sources: params.sources || [],
                        participants: params.participants,
                    });
                } catch {
                    // non-fatal: schedule creation failed
                    Toast.warning(t("summary.create.scheduleFailed"));
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

    render() {
        const {
            topic,
            templates,
            selectedChats, selectedMembers, scheduleConfig,
            showChatSelector, showMemberSelector, showScheduleConfig,
            submitting, error,
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
                            placeholder={translate("summary.create.topicPlaceholder")}
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
                        </div>

                        <Button
                            theme="solid"
                            size="default"
                            loading={submitting}
                            disabled={!this.canSubmit()}
                            onClick={this.handleSubmit}
                        >
                            {translate("summary.create.start")}
                        </Button>
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
                    value={scheduleConfig ?? { period: "daily", time: "09:00" }}
                    onConfirm={(cfg) => this.setState({ scheduleConfig: cfg, showScheduleConfig: false })}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
                />
            </div>
        );
    }
}
