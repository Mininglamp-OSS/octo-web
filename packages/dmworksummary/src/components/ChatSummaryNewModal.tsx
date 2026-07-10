import React, { Component, createRef } from 'react';
import { Modal, Toast, Tag, Button } from '@douyinfe/semi-ui';
import { IconPlus, IconClock } from '@douyinfe/semi-icons';
import { WKApp, I18nContext } from '@octo/base';
import type { TopicTemplate, ChatCandidate, ScheduleConfig } from '../types/summary';
import { SourceType, SummaryMode } from '../types/summary';
import { getSourceType } from '../utils/channelType';
import { channelToChatCandidate } from '../utils/channelConvert';
import { resolveTemplate, computeTemplateSelection, getTemplateEditableFields, deriveSummaryTitle, type ResolvableTemplate } from '../utils/templateResolver';

import { describeSchedule, scheduleToParams } from '../utils/summaryHelpers';
import * as summaryApi from '../api/summaryApi';
import { getTopicTemplatesConfig } from '../api/summaryApi';
import { TOPIC_TEMPLATES } from '../constants/templates';
import { MAX_CHAT_SELECT } from '../constants/limits';
import TemplateCard from './TemplateCard';
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
    templates: ResolvableTemplate[];
    selectedChats: ChatCandidate[];
    showChatSelector: boolean;
    submitting: boolean;
    templatePlaceholderRange: [number, number] | null;
    scheduleConfig: ScheduleConfig | null;
    showScheduleConfig: boolean;
    showMoreTemplates: boolean;
    editingTemplate: TopicTemplate | null;
    creatingCustomTemplate: boolean;
    editingTemplateLabel: string;
    editingTemplateDescription: string;
    savingTemplate: boolean;
}

export default class ChatSummaryNewModal extends Component<
    ChatSummaryNewModalProps,
    ChatSummaryNewModalState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private inputRef = createRef<HTMLTextAreaElement>();

    constructor(props: ChatSummaryNewModalProps) {
        super(props);
        this.state = {
            topic: '',
            appliedTemplateLabel: '',
            customTemplateLimit: 30,
            templates: TOPIC_TEMPLATES,
            selectedChats: [],
            showChatSelector: false,
            submitting: false,
            templatePlaceholderRange: null,
            scheduleConfig: null,
            showScheduleConfig: false,
            showMoreTemplates: false,
            editingTemplate: null,
            creatingCustomTemplate: false,
            editingTemplateLabel: '',
            editingTemplateDescription: '',
            savingTemplate: false,
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
                selectedChats: [defaultChat],
                showChatSelector: false,
                submitting: false,
                templatePlaceholderRange: null,
                scheduleConfig: null,
                showScheduleConfig: false,
                showMoreTemplates: false,
                editingTemplate: null,
                creatingCustomTemplate: false,
                editingTemplateLabel: '',
                editingTemplateDescription: '',
                savingTemplate: false,
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
        } catch (err: unknown) {
            const msg = err instanceof Error
                ? err.message
                : this.context.t('summary.common.createFailedRetry');
            Toast.error(msg);
        } finally {
            this.setState({ submitting: false });
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
            topic, appliedTemplateLabel, customTemplateLimit, templates, selectedChats, showChatSelector, submitting, scheduleConfig, showScheduleConfig, showMoreTemplates,
            editingTemplate, creatingCustomTemplate,
            editingTemplateLabel, editingTemplateDescription, savingTemplate,
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

        const footer = (
            <div className="chat-summary-modal-footer">
                <Button
                    theme="solid"
                    size="default"
                    loading={submitting}
                    disabled={!topic.trim() || submitting}
                    onClick={() => void this.handleSubmit()}
                >
                    {submitting ? t('summary.create.submitting') : t('summary.create.start')}
                </Button>
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
                        {!topic.trim() && (
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
