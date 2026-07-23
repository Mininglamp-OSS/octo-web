import React, { Component } from "react";
import {
    Button,
    Dropdown,
    Spin,
    Toast,
    Banner,
    Tooltip,
} from "@douyinfe/semi-ui";
import { IconSearch, IconPlus } from "@douyinfe/semi-icons";
import { X, ChevronDown } from "lucide-react";
import { I18nContext, t, WKApp } from "@octo/base";
import * as api from "../api/summaryApi";
import type {
    SummaryListItem,
    ListSummariesParams,
    TaskStatusType,
} from "../types/summary";
import { TaskStatus } from "../types/summary";
import { getStatusLabel } from "../utils/summaryHelpers";
import SummaryCard from "../components/SummaryCard";
import SummaryCreatePage from "./SummaryCreatePage";
import SummaryDetailPage from "./SummaryDetailPage";

interface SummaryListPageProps {
    channelId?: string;
    /** Called when the user clicks the close button (panel mode only). */
    onClose?: () => void;
    /** Called when the user clicks "new summary" in panel mode. */
    onCreateNew?: () => void;
    /** Called when a card is clicked in panel mode (instead of routeRight.push). */
    onViewDetail?: (taskId: number) => void;
}

interface SummaryListPageState {
    items: SummaryListItem[];
    total: number;
    page: number;
    pageSize: number;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    error: string | null;
    statusFilter: TaskStatusType | undefined;
    keyword: string;
    activeTaskId: number | null;
}

export const getStatusOptions = () => [
    { value: "", label: t("summary.list.allStatus") },
    { value: TaskStatus.PENDING, label: getStatusLabel(TaskStatus.PENDING) },
    { value: TaskStatus.PROCESSING, label: getStatusLabel(TaskStatus.PROCESSING) },
    { value: TaskStatus.COMPLETED, label: getStatusLabel(TaskStatus.COMPLETED) },
    { value: TaskStatus.FAILED, label: getStatusLabel(TaskStatus.FAILED) },
    { value: TaskStatus.CANCELLED, label: getStatusLabel(TaskStatus.CANCELLED) },
];

export default class SummaryListPage extends Component<SummaryListPageProps, SummaryListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryListPageState = {
        items: [],
        total: 0,
        page: 1,
        pageSize: this.props?.channelId ? 50 : 20,
        loading: false,
        loadingMore: false,
        hasMore: true,
        error: null,
        statusFilter: undefined,
        keyword: "",
        activeTaskId: null,
    };

    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    private batchPollTimer: ReturnType<typeof setInterval> | null = null;
    private isBatchPolling = false;
    private attentionCount = 0;
    private attentionRefreshLoading = false;

    private handleSpaceChanged_ = () => this.loadData();

    private handleListRefreshRequested_ = () => this.loadData();

    private handleTaskRegenerated_ = () => this.loadData();

    private handleAttentionCountRefreshed_ = ({ count }: { count: number }) => {
        const nextCount = count ?? 0;
        if (nextCount === this.attentionCount || this.attentionRefreshLoading) return;
        this.attentionRefreshLoading = true;
        void this.loadData().finally(() => {
            this.attentionRefreshLoading = false;
        });
    };

    private handleSummaryRead_ = (event: Event) => {
        const detail = (event as CustomEvent<{
            taskId: number;
            isUnread?: boolean;
            needsAttention?: boolean;
        }>).detail;
        const taskId = detail?.taskId;
        if (!detail || !taskId) return;
        const current = this.state.items.find(item => item.task_id === taskId);
        const nextNeedsAttention = detail.needsAttention ?? Boolean(current?.has_pending_invitation);
        if (current?.needs_attention && !nextNeedsAttention) {
            // Keep the local count aligned with the successful mark-read
            // response so the next global poll does not trigger a redundant
            // full-list reload and lose the user's scroll position.
            this.attentionCount = Math.max(0, this.attentionCount - 1);
        }
        this.setState(({ items }) => ({
            items: items.map(item => item.task_id === taskId
                ? {
                    ...item,
                    is_unread: detail.isUnread ?? false,
                    needs_attention: detail.needsAttention ?? Boolean(item.has_pending_invitation),
                }
                : item),
        }));
        this.emitBadgeUpdate();
    };

    private handleDetailActive_ = (event: Event) => {
        const taskId = (event as CustomEvent<{ taskId: number }>).detail?.taskId;
        if (typeof taskId !== "number") return;
        this.setState({ activeTaskId: taskId });
    };

    private handleDetailInactive_ = (event: Event) => {
        const taskId = (event as CustomEvent<{ taskId: number }>).detail?.taskId;
        if (typeof taskId !== "number") return;
        // 只清「自己」——切 task 时旧详情卸载与新详情挂载的顺序不确定，
        // 仅当当前高亮正是这个 taskId 才清空，避免误清掉已切到的新卡片。
        this.setState((state) => (state.activeTaskId === taskId ? { activeTaskId: null } : null));
    };

    private handleNavMenuActivated_ = ({ menuId }: { menuId: string }) => {
        if (menuId === "summary") {
            this.loadData();
        }
    };

    componentDidMount() {
        this.loadData();
        WKApp.mittBus.on("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated_);
        WKApp.mittBus.on("summary-attention-count-refreshed" as any, this.handleAttentionCountRefreshed_);
        WKApp.mittBus.on("summary-list-refresh-requested" as any, this.handleListRefreshRequested_);
        window.addEventListener("summary-task-regenerated", this.handleTaskRegenerated_);
        window.addEventListener("summary-read", this.handleSummaryRead_);
        window.addEventListener("summary-detail-active", this.handleDetailActive_);
        window.addEventListener("summary-detail-inactive", this.handleDetailInactive_);
    }

    componentDidUpdate(prevProps: SummaryListPageProps) {
        if (prevProps.channelId !== this.props.channelId) {
            this.loadData();
        }
    }

    componentWillUnmount() {
        window.dispatchEvent(new CustomEvent("summary-list-unmount"));
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.stopBatchPoll();
        WKApp.mittBus.off("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
        WKApp.mittBus.off("summary-attention-count-refreshed" as any, this.handleAttentionCountRefreshed_);
        WKApp.mittBus.off("summary-list-refresh-requested" as any, this.handleListRefreshRequested_);
        window.removeEventListener("summary-task-regenerated", this.handleTaskRegenerated_);
        window.removeEventListener("summary-read", this.handleSummaryRead_);
        window.removeEventListener("summary-detail-active", this.handleDetailActive_);
        window.removeEventListener("summary-detail-inactive", this.handleDetailInactive_);
    }

    async fetchData(): Promise<{ items: SummaryListItem[]; total: number; attention_count: number }> {
        const { page, pageSize, statusFilter, keyword } = this.state;
        const { channelId } = this.props;
        const params: ListSummariesParams = {
            page,
            page_size: pageSize,
            status: statusFilter,
            keyword: keyword || undefined,
            origin_channel_id: channelId || undefined,
        };
        const resp = await api.listSummaries(params);
        this.attentionCount = resp.attention_count ?? 0;
        this.emitBadgeUpdate(resp.attention_count);
        return { items: resp.items, total: resp.total, attention_count: resp.attention_count ?? 0 };
    }

    async loadData() {
        this.setState({ loading: true, error: null, page: 1, hasMore: true });
        try {
            const { pageSize, statusFilter, keyword } = this.state;
            const params: ListSummariesParams = {
                page: 1,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
                origin_channel_id: this.props.channelId || undefined,
            };
            const resp = await api.listSummaries(params);
            this.attentionCount = resp.attention_count ?? 0;
            this.setState({
                items: resp.items,
                total: resp.total,
                loading: false,
                hasMore: resp.items.length < resp.total,
            }, () => {
                this.maybeStartBatchPoll();
                this.emitBadgeUpdate(resp.attention_count);
            });
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            this.loadMore();
        }
    };

    async loadMore() {
        if (this.state.loadingMore || !this.state.hasMore || this.state.loading) return;
        this.setState({ loadingMore: true });
        try {
            const nextPage = this.state.page + 1;
            const { pageSize, statusFilter, keyword } = this.state;
            const params: ListSummariesParams = {
                page: nextPage,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
                origin_channel_id: this.props.channelId || undefined,
            };
            const resp = await api.listSummaries(params);
            this.setState(prev => ({
                items: [...prev.items, ...resp.items],
                page: nextPage,
                loadingMore: false,
                hasMore: prev.items.length + resp.items.length < resp.total,
            }), () => this.maybeStartBatchPoll());
        } catch {
            this.setState({ loadingMore: false });
        }
    }

    private maybeStartBatchPoll() {
        const activeIds = this.state.items
            .filter(item =>
                item.status === TaskStatus.PENDING ||
                item.status === TaskStatus.WAITING_CONFIRM ||
                item.status === TaskStatus.PROCESSING
            )
            .map(item => item.task_id);

        if (activeIds.length === 0) {
            this.stopBatchPoll();
            return;
        }

        this.stopBatchPoll();
        this.batchPollTimer = setInterval(() => {
            const currentActiveIds = this.state.items
                .filter(item =>
                    item.status === TaskStatus.PENDING ||
                    item.status === TaskStatus.WAITING_CONFIRM ||
                    item.status === TaskStatus.PROCESSING
                )
                .map(item => item.task_id);
            if (currentActiveIds.length === 0) {
                this.stopBatchPoll();
                return;
            }
            this.doBatchPoll(currentActiveIds);
        }, 2000);
    }

    private async doBatchPoll(taskIds: number[]) {
        if (this.isBatchPolling) return;
        this.isBatchPolling = true;
        try {
            const updates = await api.batchStatus(taskIds);
            window.dispatchEvent(new CustomEvent("summary-batch-heartbeat", { detail: { taskIds } }));
            const updateMap = new Map(updates.map(u => [u.id, u]));
            let changed = false;
            const changedIds: number[] = [];
            const newItems = this.state.items.map(item => {
                const update = updateMap.get(item.task_id);
                if (update && update.status !== item.status) {
                    changed = true;
                    changedIds.push(item.task_id);
                    return { ...item, status: update.status };
                }
                return item;
            });
            if (changed) {
                this.setState({ items: newItems }, () => {
                    this.maybeStartBatchPoll();
                    this.emitBadgeUpdate();
                });
                window.dispatchEvent(new CustomEvent("summary-status-change", { detail: { taskIds: changedIds } }));
            }
        } catch {
            // ignore
        } finally {
            this.isBatchPolling = false;
        }
    }

    private stopBatchPoll() {
        if (this.batchPollTimer) {
            clearInterval(this.batchPollTimer);
            this.batchPollTimer = null;
        }
    }

    /**
     * Fire badge update event — badge = count of WAITING_CONFIRM tasks
     * (summary ready, waiting for user to confirm).
     * Uses a separate unfiltered query so badge is independent of list filter.
     */
    private emitBadgeUpdate(count?: number) {
        // Panel mode (channelId set): attention_count is channel-scoped, must not
        // overwrite the global nav badge. Only the full-page route owns the badge.
        if (this.props.channelId) return;
        if (count != null) {
            WKApp.mittBus.emit("summary-badge-update" as any, { count });
            return;
        }
        api.listSummaries({ page_size: 1 }).then(resp => {
            const count = resp.attention_count ?? 0;
            this.attentionCount = count;
            WKApp.mittBus.emit("summary-badge-update" as any, { count });
        }).catch(() => { /* ignore */ });
    }

    handleStatusChange = (value: string | number) => {
        const statusFilter = value === "" ? undefined : (value as TaskStatusType);
        this.setState({ statusFilter, page: 1 }, () => this.loadData());
    };

    handleKeywordChange = (value: string) => {
        this.setState({ keyword: value });
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            this.setState({ page: 1 }, () => this.loadData());
        }, 400);
    };

    handleDelete = async (taskId: number) => {
        try {
            await api.deleteSummary(taskId);
            Toast.success(t("summary.list.deleteSuccess"));
            // Always reload from page 1 after delete to avoid losing earlier pages
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.deleteFailed"));
        }
    };

    handleDelete_refetch = async () => {
        const fresh = await this.fetchData();
        if (fresh.items.length > 0) {
            const next = fresh.items[0];
            this.setState({ activeTaskId: next.task_id, items: fresh.items, total: fresh.total }, () => {
                if (this.props.onViewDetail) {
                    this.props.onViewDetail(next.task_id);
                } else {
                    WKApp.routeRight.popToRoot();
                    WKApp.routeRight.push(<SummaryDetailPage taskId={next.task_id} emitSelection />);
                }
            });
        } else {
            this.setState({ items: [], total: 0, activeTaskId: null }, () => {
                if (this.props.onCreateNew) {
                    this.props.onCreateNew();
                } else {
                    WKApp.routeRight.popToRoot();
                    WKApp.routeRight.push(
                        <SummaryCreatePage onCreated={() => this.loadData()} />
                    );
                }
            });
        }
    };

    handleCardClick = (taskId: number) => {
        this.setState({ activeTaskId: taskId });
        if (this.props.onViewDetail) {
            this.props.onViewDetail(taskId);
        } else {
            WKApp.routeRight.popToRoot();
            WKApp.routeRight.push(<SummaryDetailPage taskId={taskId} emitSelection />);
        }
    };

    handleLeave = async (taskId: number) => {
        try {
            await api.leaveSummary(taskId);
            Toast.success(t("summary.list.leaveSuccess"));
            // 退出后留在列表，重新加载（与删除不同，不跳创建页）。
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.list.leaveFailed"));
        }
    };

    handleRespond = async (taskId: number, action: "accept" | "reject") => {
        try {
            await api.respondToTask(taskId, action);
            Toast.success(action === "accept" ? t("summary.action.accepted") : t("summary.action.rejected"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleRetry = async (taskId: number) => {
        try {
            const task = this.state.items.find(i => i.task_id === taskId);
            await api.regenerateSummary(taskId, { topic: task?.title || "" });
            Toast.success(t("summary.list.retrySuccess"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleCancel = async (taskId: number) => {
        try {
            await api.cancelSummary(taskId);
            Toast.success(t("summary.list.cancelSuccess"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleRegenerate = (taskId: number) => {
        this.handleCardClick(taskId);
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("summary-detail-regenerate", { detail: { taskId } }));
        }, 300);
    };

    handleEdit = (taskId: number) => {
        this.handleCardClick(taskId);
        // 300ms delay allows detail page to mount and register event listener
        // before dispatching the edit action event
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("summary-detail-edit", { detail: { taskId } }));
        }, 300);
    };

    handleCreate = () => {
        if (this.props.onCreateNew) {
            this.props.onCreateNew();
            return;
        }
        WKApp.routeRight.popToRoot();
        WKApp.routeRight.push(
            <SummaryCreatePage onCreated={() => this.loadData()} />
        );
    };

    render() {
        const { items, total, pageSize, loading, loadingMore, hasMore, error, statusFilter, keyword, activeTaskId } = this.state;
        const { channelId, onClose } = this.props;
        const { locale, t: translate } = this.context;
        const statusOptions = getStatusOptions();
        const isPanel = Boolean(channelId);

        return (
            <div className={`summary-list-page${isPanel ? " summary-list-page--panel" : ""}`}>
                <div className="summary-list-header">
                    <h2 className="summary-list-title">
                        {isPanel ? translate("summary.chatSummary.panelTitle") : translate("summary.list.title")}
                    </h2>
                    <div className="summary-list-header-actions">
                        {isPanel && (
                            <Tooltip content={translate("summary.chatSummary.createNew")} position="bottom">
                                <Button
                                    icon={<IconPlus />}
                                    theme="borderless"
                                    onClick={this.handleCreate}
                                />
                            </Tooltip>
                        )}
                        {isPanel && onClose ? (
                            <Button
                                icon={<X size={18} />}
                                theme="borderless"
                                type="tertiary"
                                onClick={onClose}
                            />
                        ) : (
                            <Tooltip content={translate("summary.list.createTooltip")} position="bottom">
                                <Button
                                    icon={<IconPlus />}
                                    theme="borderless"
                                    onClick={this.handleCreate}
                                />
                            </Tooltip>
                        )}
                    </div>
                </div>

                <div className="summary-list-toolbar">
                    <div className="summary-list-search-wrap">
                        <IconSearch className="summary-list-search-icon" />
                        <input
                            className="summary-list-search-input"
                            placeholder={translate("summary.list.searchPlaceholder")}
                            value={keyword}
                            onChange={(e) => this.handleKeywordChange(e.target.value)}
                        />
                    </div>
                    <Dropdown
                        trigger="click"
                        position="bottomLeft"
                        render={
                            <Dropdown.Menu>
                                {statusOptions.map((opt) => (
                                    <Dropdown.Item
                                        key={String(opt.value)}
                                        active={statusFilter === opt.value}
                                        onClick={() => this.handleStatusChange(opt.value)}
                                    >
                                        {opt.label}
                                    </Dropdown.Item>
                                ))}
                            </Dropdown.Menu>
                        }
                    >
                        <div className="summary-list-status-trigger">
                            <span>{statusOptions.find((o) => o.value === (statusFilter ?? ""))?.label ?? statusOptions[0]?.label}</span>
                            <ChevronDown size={14} />
                        </div>
                    </Dropdown>
                </div>

                {error && (
                    <Banner
                        type="warning"
                        description={error}
                        closeIcon={null}
                        style={{ marginBottom: 16 }}
                        fullMode={false}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{translate("summary.list.networkError")}</span>
                            <Button size="small" onClick={() => this.loadData()}>{translate("summary.common.retry")}</Button>
                        </div>
                    </Banner>
                )}

                {loading && (
                    <div className="summary-list-loading">
                        <Spin size="large" />
                    </div>
                )}

                {!loading && !error && items.length === 0 && (
                    <div className="summary-list-empty">
                        {isPanel ? (
                            <>
                                <div className="summary-list-empty-title">{translate("summary.list.emptyTitle")}</div>
                                <div className="summary-list-empty-desc">{translate("summary.chatSummary.emptyDescription")}</div>
                                <Button theme="solid" onClick={this.handleCreate} style={{ marginTop: 16 }}>
                                    {translate("summary.chatSummary.createNew")}
                                </Button>
                            </>
                        ) : (
                            <>
                                <div className="summary-list-empty-icon">📄</div>
                                <div className="summary-list-empty-title">{translate("summary.list.emptyTitle")}</div>
                                <div className="summary-list-empty-desc">
                                    {translate("summary.list.emptyDesc")}
                                </div>
                                <Button theme="solid" onClick={this.handleCreate} style={{ marginTop: 16 }}>
                                    {translate("summary.list.createFirst")}
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {!loading && items.length > 0 && (
                    <div className="summary-list-content" onScroll={this.handleScroll}>
                        {items.map((item) => (
                            <SummaryCard
                                key={item.task_id}
                                task={item}
                                active={item.task_id === activeTaskId}
                                onClick={this.handleCardClick}
                                onDelete={this.handleDelete}
                                onRespond={this.handleRespond}
                                onLeave={this.handleLeave}
                                onRetry={this.handleRetry}
                                onRegenerate={this.handleRegenerate}
                                onEdit={this.handleEdit}
                                onCancel={this.handleCancel}
                            />
                        ))}
                        {loadingMore && (
                            <div className="summary-list-loading-more">
                                <Spin />
                            </div>
                        )}
                        {!hasMore && items.length > pageSize && (
                            <div className="summary-list-no-more">
                                {translate("summary.list.noMore")}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
}
