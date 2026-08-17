import React, { Component } from 'react';
import { Modal, Input, List, Empty, Spin, Toast } from '@douyinfe/semi-ui';
import { IconClose, IconLink } from '@douyinfe/semi-icons';
import { listSummaries } from '../api/summaryApi';
import type { SummaryListItem } from '../types/summary';
import { TriggerType, TaskStatus } from '../types/summary';
import { I18nContext, type I18nCtx, Dap } from '@octo/base';
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

/**
 * Picker 翻页常量（R4 yj P1-1 / ms P1 / jx 🟡：50 行窗口回归）。
 * 后端无 referenceable 服务端过滤（SUM-19 只加逐行字段），非 legacy 模式
 * 必须翻页收集可引用项，否则繁忙 space 里可引用总结被挤出首页。
 * - PICKER_PAGE_SIZE=100：后端 page_size 上限，减少请求数
 * - PICKER_MAX_PAGES=5：硬上限，最多扫 500 条，防止异常数据下无限翻页
 * - PICKER_TARGET_COUNT=50：收集满即停，与原首页配额对齐
 */
const PICKER_PAGE_SIZE = 100;
const PICKER_MAX_PAGES = 5;
const PICKER_TARGET_COUNT = 50;

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

    /**
     * 单调请求序号（R4 yj P2-6 / ms P2：乱序响应守卫）。
     * 打开弹窗、keyword debounce、legacy 翻转 re-fetch 三路都可能并发发起
     * fetchList；每次进入递增 seq，异步续点发现 seq 过期即丢弃，过期响应
     * 不会覆盖新结果。与 SummaryListPage 的 loadDataSeq 同一模式。
     */
    private fetchSeq = 0;

    private fetchList = async (keyword: string) => {
        const seq = ++this.fetchSeq;
        this.setState({ loading: true, error: '' });
        try {
            // 列出当前 space 可引用的总结。
            //
            // 兼容策略（与 isReferenceable 保持一致）：
            // - 后端已部署 referenceable 字段时，不再传 trigger_type，由后端返回所有类型，
            //   前端按 status + referenceable 客户端复核。
            // - 后端未部署 referenceable 时（字段缺失），仍传 trigger_type=AGENT 保持
            //   与改动前等价的服务端收窄。
            //
            // 无论哪种模式，都传 status=COMPLETED 让服务端过滤未完成项，避免浪费配额。
            //
            // 翻页收集（R4 yj P1-1 / ms P1 / jx 🟡）：后端 ListSummaries 没有
            // referenceable 服务端过滤，非 legacy 模式下不可引用项会占满首页，
            // 把可引用项挤出 50 行窗口——繁忙 space 里原本可引用的总结从选择器
            // 消失，严格差于改动前。因此翻页拉取直到收集满 PICKER_TARGET_COUNT
            // 个可引用项、或遇到短页（最后一页）、或达到 PICKER_MAX_PAGES 硬上限。
            // legacy 模式下服务端已按 AGENT 收窄，通常第一页即停，行为与改动前等价。
            const useLegacyNarrowing = this.state.legacyMode;
            const collected: SummaryListItem[] = [];
            const seenIds = new Set<number>();

            for (let page = 1; page <= PICKER_MAX_PAGES; page++) {
                if (seq !== this.fetchSeq) return; // 被更新的请求取代
                const resp = await listSummaries({
                    page,
                    page_size: PICKER_PAGE_SIZE,
                    status: TaskStatus.COMPLETED,
                    trigger_type: useLegacyNarrowing ? TriggerType.AGENT : undefined,
                    keyword: keyword.trim() || undefined,
                });
                if (seq !== this.fetchSeq) return; // 过期响应，丢弃
                const sampled = resp?.items || [];

                // 检测后端是否已部署 referenceable 字段：如果首页非空响应中没有任何项
                // 带 referenceable 字段，则进入 legacy 模式（后续请求继续带 trigger_type）。
                // P1-2: 只从非空响应推断 legacy —— 空列表无法说明后端是否支持该字段。
                if (page === 1 && sampled.length > 0) {
                    const hasReferenceable = sampled.some(t => t.referenceable !== undefined);
                    if (!hasReferenceable && !this.state.legacyMode) {
                        // P1-3: 翻转 legacy 并 re-fetch，让用户立刻看到 Agent 总结
                        // 而不是空列表。re-fetch 会拿到新 seq，本页循环自动作废。
                        this.setState({ legacyMode: true }, () => this.fetchList(keyword));
                        return;
                    }
                    if (hasReferenceable && this.state.legacyMode) {
                        // 后端已部署 referenceable 且之前在 legacy 模式：退出 legacy 并
                        // re-fetch（R4 yj P2-7：与 true 分支对称，不再静默保留收窄窗口的旧数据）。
                        this.setState({ legacyMode: false }, () => this.fetchList(keyword));
                        return;
                    }
                }

                // 收集本页中已完成且可引用的项（含 legacy 兼容），按 task_id 去重
                // （后端分页窗口理论上不重叠，防御性去重防异常数据重复渲染）。
                for (const t of sampled) {
                    if (
                        t.task_id != null && !seenIds.has(t.task_id) &&
                        t.title != null &&
                        t.status === TaskStatus.COMPLETED &&
                        this.isReferenceable(t)
                    ) {
                        seenIds.add(t.task_id);
                        collected.push(t);
                    }
                }

                // 停止条件：收集满目标数量，或本页不满 page_size（最后一页）。
                if (collected.length >= PICKER_TARGET_COUNT) break;
                if (sampled.length < PICKER_PAGE_SIZE) break;
            }

            if (seq !== this.fetchSeq) return;
            this.setState({ items: collected, loading: false });
        } catch (err: any) {
            if (seq !== this.fetchSeq) return; // 过期请求的错误不覆盖新状态
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
        // 埋点 301:agent 总结里选中一条历史总结作为引用（隐私 props 恒空）。
        Dap.shared.track("smart_summary_agent_reference_added", {});
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
                                                // R4 yj P2-4: getSummaryTypeKind's default branch means
                                                // label is never empty today; the guard is kept as
                                                // defensive dead code in case a future kind yields no label.
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
