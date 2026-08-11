import React, { Component } from 'react';
import { Modal, Input, List, Empty, Spin, Toast } from '@douyinfe/semi-ui';
import { IconClose, IconLink } from '@douyinfe/semi-icons';
import { listSummaries } from '../api/summaryApi';
import type { SummaryListItem } from '../types/summary';
import { TriggerType } from '../types/summary';
import { I18nContext, type I18nCtx } from '@octo/base';
import { summaryTestIds } from '../utils/testIds';
import './SummaryReferencePicker.css';

/**
 * SummaryReferencePicker — chat 里"引用已有总结"的选择器。
 *
 * 交互(见 CHAT-REFERENCE-BASED-DESIGN-v1 决策 1/2/3):
 * - 触发方式: 由父组件放一个"引用总结"按钮,点击后打开本 Modal(visible)
 * - 数据源: listSummaries() — 当前 space,支持标题搜索,按更新时间倒序
 * - 单选: 点击列表某一行即选中并关闭 Modal(选择 = 提交,无二次确认)
 * - 首轮锁定: 由父组件根据 chat 是否已有 assistant 消息控制是否允许再次打开
 *
 * 输出: onSelect(task) 回调,父组件收到后自行渲染引用卡片。
 */

interface SummaryReferencePickerProps {
    visible: boolean;
    onCancel: () => void;
    onSelect: (task: SummaryListItem) => void;
    /** 当前已选中的 task_id,用于 UI 高亮(可选) */
    selectedTaskId?: number;
}

interface SummaryReferencePickerState {
    loading: boolean;
    keyword: string;
    items: SummaryListItem[];
    error: string;
}

export default class SummaryReferencePicker extends Component<
    SummaryReferencePickerProps,
    SummaryReferencePickerState
> {
    static contextType = I18nContext;
    context!: I18nCtx;

    constructor(props: SummaryReferencePickerProps) {
        super(props);
        this.state = {
            loading: false,
            keyword: '',
            items: [],
            error: '',
        };
    }

    componentDidUpdate(prevProps: SummaryReferencePickerProps) {
        // 打开 Modal 时拉一次数据
        if (this.props.visible && !prevProps.visible) {
            this.fetchList('');
        }
    }

    private fetchList = async (keyword: string) => {
        this.setState({ loading: true, error: '' });
        try {
            // 列出当前 space 所有总结（不再固定 trigger_type=3）。
            // 后端在列表项中返回 referenceable/reference_artifact_type/reference_unavailable_reason，
            // 前端据此筛选可引用候选并展示类型标签/不可用原因。
            const resp = await listSummaries({
                page: 1,
                page_size: 50,
                keyword: keyword.trim() || undefined,
            });
            // 只保留已完成且后端声明 referenceable=true 的项
            const items = (resp?.items || []).filter(
                (t: SummaryListItem) =>
                    t.task_id != null && t.title != null &&
                    t.status === 3 &&
                    t.referenceable === true,
            );
            this.setState({ items, loading: false });
        } catch (err: any) {
            console.error('[SummaryReferencePicker] fetchList failed', err);
            this.setState({
                loading: false,
                error: err?.message || String(err),
                items: [],
            });
        }
    };

    private handleKeywordChange = (v: string) => {
        this.setState({ keyword: v });
        // 简单 debounce: 300ms
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.fetchList(v);
        }, 300);
    };

    private debounceTimer: number | null = null;

    private getTypeLabel = (item: SummaryListItem): string => {
        const { t } = this.context;
        switch (item.trigger_type) {
            case TriggerType.AGENT:
                return t('summary.summaryCard.agentType');
            case TriggerType.SCHEDULED:
                return t('summary.summaryCard.scheduledType');
            case TriggerType.MANUAL:
                return item.summary_mode === 2
                    ? t('summary.summaryCard.multiPersonType')
                    : t('summary.summaryCard.quickType');
            default:
                return '';
        }
    };

    private handleSelect = (task: SummaryListItem) => {
        this.props.onSelect(task);
    };

    render() {
        const { visible, onCancel, selectedTaskId } = this.props;
        const { loading, keyword, items, error } = this.state;
        const { t } = this.context;

        return (
            <Modal
                title={t('summary.chatReference.pickerTitle')}
                visible={visible}
                onCancel={onCancel}
                footer={null}
                width={520}
                className="summary-reference-picker-modal"
            >
                <Input
                    data-testid={summaryTestIds.agentRefSearchInput}
                    prefix={<IconLink />}
                    value={keyword}
                    onChange={this.handleKeywordChange}
                    placeholder={t('summary.chatReference.searchPlaceholder')}
                    style={{ marginBottom: 12 }}
                />
                <div className="summary-reference-picker-list">
                    {loading && <Spin />}
                    {!loading && error && (
                        <div className="summary-reference-picker-error">
                            {t('summary.common.loadingFailed')}: {error}
                        </div>
                    )}
                    {!loading && !error && items.length === 0 && (
                        <Empty description={t('summary.chatReference.empty')} />
                    )}
                    {!loading && !error && items.length > 0 && (
                        <List
                            dataSource={items}
                            renderItem={(item: SummaryListItem) => (
                                <List.Item
                                    className={`summary-reference-picker-item ${
                                        item.task_id === selectedTaskId
                                            ? 'summary-reference-picker-item--selected'
                                            : ''
                                    }`}
                                    onClick={() => this.handleSelect(item)}
                                >
                                    <div className="summary-reference-picker-item-main">
                                        <div className="summary-reference-picker-item-title">
                                            {item.title || t('summary.common.untitled')}
                                        </div>
                                        <div className="summary-reference-picker-item-meta">
                                            <span className="summary-reference-picker-item-type">
                                                {this.getTypeLabel(item)}
                                            </span>
                                            <span className="summary-reference-picker-item-sep">·</span>
                                            <span>{item.task_no}</span>
                                            <span className="summary-reference-picker-item-sep">·</span>
                                            <span>{item.completed_at ? new Date(item.completed_at).toLocaleDateString() : t('summary.common.inProgress')}</span>
                                        </div>
                                    </div>
                                </List.Item>
                            )}
                        />
                    )}
                </div>
            </Modal>
        );
    }
}
