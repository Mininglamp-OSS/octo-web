import React, { Component, createRef } from "react";
import {
    Button,
    Toast,
    Typography,
    Tag,
    Avatar,
    Modal,
} from "@douyinfe/semi-ui";
import { IconPlus, IconClock, IconUserGroup } from "@douyinfe/semi-icons";
import { I18nContext, t } from "@octo/base";
import WKApp from "@octo/base/src/App";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import * as api from "../api/summaryApi";
import { getTopicTemplatesConfig } from "../api/summaryApi";
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
import { describeSchedule, scheduleToParams } from "../utils/summaryHelpers";
import { resolveTemplate, computeTemplateSelection, getTemplateEditableFields, deriveSummaryTitle, type ResolvableTemplate } from "../utils/templateResolver";

const { Text } = Typography;

interface SummaryCreatePageProps {
    onCreated?: () => void;
}

interface SummaryCreatePageState {
    topic: string;
    appliedTemplateLabel: string;
    customTemplateLimit: number;
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
        error: null,
        editingTemplate: null,
        creatingCustomTemplate: false,
        editingTemplateLabel: "",
        editingTemplateDescription: "",
        savingTemplate: false,
    };

    componentDidMount() {
        void this.loadTemplates();
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

    render() {
        const {
            topic,
            appliedTemplateLabel,
            customTemplateLimit,
            templates,
            selectedChats, selectedMembers, scheduleConfig,
            showChatSelector, showMemberSelector, showScheduleConfig, showMoreTemplates,
            submitting, error, editingTemplate, creatingCustomTemplate,
            editingTemplateLabel, editingTemplateDescription, savingTemplate,
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
                    value={scheduleConfig ?? { unit: "week", every: 1, time: "09:00" }}
                    onConfirm={(cfg) => this.setState({ scheduleConfig: cfg, showScheduleConfig: false })}
                    onCancel={() => this.setState({ showScheduleConfig: false })}
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
