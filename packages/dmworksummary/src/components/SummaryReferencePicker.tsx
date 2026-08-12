import React, { Component } from 'react';
import { Modal, Input, List, Empty, Spin, Toast } from '@douyinfe/semi-ui';
import { IconClose, IconLink } from '@douyinfe/semi-icons';
import { listSummaries } from '../api/summaryApi';
import type { SummaryListItem } from '../types/summary';
import { TriggerType, TaskStatus } from '../types/summary';
import { I18nContext, type I18nCtx } from '@octo/base';
import { summaryTestIds } from '../utils/testIds';
import { getSummaryTypeLabel, isReferenceable as isItemReferenceable } from '../utils/summaryHelpers';
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
    /** 后端未部署 referenceable 字段时为 true，请求带 trigger_type=AGENT 收窄 */
    legacyMode: boolean;
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
            legacyMode: false,
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
            // 列出当前 space 可引用的总结。
            //
            // 兼容策略（与 isReferenceable 保持一致）：
            // - 后端已部署 referenceable 字段时，不再传 trigger_type，由后端返回所有类型中
            //   referenceable=true 的项；前端再按 status + referenceable 客户端复核。
            // - 后端未部署 referenceable 时（字段缺失），仍传 trigger_type=AGENT 保持
            //   与改动前等价的服务端收窄，避免在 >50 条总结的 space 中因全量拉取而
            //   把原本可见的 Agent 总结挤出首页。
            //
            // 无论哪种模式，都传 status=COMPLETED 让服务端过滤未完成项，避免浪费配额。
            //
            // NOTE: 当前仅取首页 50 条。若 space 中总结数量较多且可引用项落在首页之外，
            // 可引用项可能不显示。后续应由后端支持 referenceable 服务端筛选或前端实现
            // 分页/懒加载来覆盖全部可引用项。
            const useLegacyNarrowing = this.state.legacyMode;
            const resp = await listSummaries({
                page: 1,
                page_size: 50,
                status: TaskStatus.COMPLETED,
                trigger_type: useLegacyNarrowing ? TriggerType.AGENT : undefined,
                keyword: keyword.trim() || undefined,
            });
            // 检测后端是否已部署 referenceable 字段：如果返回的 items 中没有任何项
            // 带 referenceable 字段，则进入 legacy 模式（后续请求继续带 trigger_type）。
            const sampled = resp?.items || [];
            const hasReferenceable = sampled.some(t => t.referenceable !== undefined);
            if (!hasReferenceable && !this.state.legacyMode) {
                this.setState({ legacyMode: true });
            }
            // 只保留已完成且可引用的项（含 legacy 兼容）
            const items = sampled.filter(
                (t: SummaryListItem) =>
                    t.task_id != null && t.title != null &&
                    t.status === TaskStatus.COMPLETED &&
                    this.isReferenceable(t),
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

    private isReferenceable = (t: SummaryListItem): boolean => {
        return isItemReferenceable(t);
    };

    private getTypeLabel = (item: SummaryListItem): string => {
        return getSummaryTypeLabel(this.context.t, item);
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
                                            {(() => {
                                                const label = this.getTypeLabel(item);
                                                return label ? (
                                                    <>
                                                        <span className="summary-reference-picker-item-type">
                                                            {label}
                                                        </span>
                                                        <span className="summary-reference-picker-item-sep">·</span>
                                                    </>
                                                ) : null;
                                            })()}
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
