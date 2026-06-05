import React, { Component, createRef } from 'react';
import { Modal, Toast, Tag, Button } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';
import { WKApp, I18nContext } from '@octo/base';
import type { TopicTemplate, ChatCandidate } from '../types/summary';
import { SourceType } from '../types/summary';
import { getSourceType } from '../utils/channelType';
import { channelToChatCandidate } from '../utils/channelConvert';
import { resolveTemplate, computeTemplateSelection, type ResolvableTemplate } from '../utils/templateResolver';
import * as summaryApi from '../api/summaryApi';
import { getTopicTemplates } from '../api/summaryApi';
import { TOPIC_TEMPLATES } from '../constants/templates';
import { MAX_CHAT_SELECT } from '../constants/limits';
import TemplateCard from './TemplateCard';
import ChatSelectorModal from './ChatSelectorModal';
import './ChatSummaryNewModal.css';

interface ChatSummaryNewModalProps {
    visible: boolean;
    channel: { channelID: string; channelType: number };
    onClose: () => void;
    onSubmit: (taskId: number) => void;
}

interface ChatSummaryNewModalState {
    topic: string;
    templates: ResolvableTemplate[];
    selectedChats: ChatCandidate[];
    showChatSelector: boolean;
    submitting: boolean;
    templatePlaceholderRange: [number, number] | null;
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
            templates: TOPIC_TEMPLATES,
            selectedChats: [],
            showChatSelector: false,
            submitting: false,
            templatePlaceholderRange: null,
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
                selectedChats: [defaultChat],
                showChatSelector: false,
                submitting: false,
                templatePlaceholderRange: null,
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

    private handleSubmit = async () => {
        const { topic, selectedChats } = this.state;
        const { channel, onSubmit } = this.props;

        if (!topic.trim()) return;

        const sourceType = getSourceType(channel);
        if (sourceType === null) return;

        this.setState({ submitting: true });
        try {
            const sources = selectedChats.length > 0
                ? selectedChats.map((c) => ({
                    source_type: (c.chat_type === 'group'
                        ? SourceType.GROUP_CHAT
                        : c.chat_type === 'thread'
                        ? SourceType.THREAD
                        : SourceType.DIRECT_MESSAGE),
                    source_id: c.chat_id,
                    source_name: c.name,
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
        const { topic, templates, selectedChats, showChatSelector, submitting } = this.state;
        const { t } = this.context;
        // 模板在 render() 用当前 locale 解析，切语言即时刷新（不在 state 烘焙）。
        const resolvedTemplates = templates.map((tpl) => resolveTemplate(tpl, t));

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
            </>
        );
    }
}
