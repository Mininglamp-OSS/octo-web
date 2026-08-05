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
import { getStatusLabel, isTerminalStatus } from "../utils/summaryHelpers";
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
    private isRefreshing = false;
    // Cleared by componentWillUnmount so any in-flight refresh's setState
    // becomes a no-op instead of restarting maybeStartBatchPoll on a
    // torn-down component.
    private isMounted_ = false;

    private handleSpaceChanged_ = () => this.loadData();

    private handleListRefreshRequested_ = () => this.loadData();

    private handleTaskRegenerated_ = () => this.loadData();

    private handleSummaryRead_ = (event: Event) => {
        const detail = (event as CustomEvent<{
            taskId: number;
            isUnread?: boolean;
            needsAttention?: boolean;
        }>).detail;
        const taskId = detail?.taskId;
        if (!detail || !taskId) return;
        this.setState(({ items }) => ({
            items: items.map(item => item.task_id === taskId
                ? {
                    ...item,
                    is_unread: detail.isUnread ?? false,
                    needs_attention: detail.needsAttention ?? Boolean(item.has_pending_invitation),
                }
                : item),
        }));
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
        this.isMounted_ = true;
        this.loadData();
        WKApp.mittBus.on("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated_);
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
        this.isMounted_ = false;
        window.dispatchEvent(new CustomEvent("summary-list-unmount"));
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.stopBatchPoll();
        WKApp.mittBus.off("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
        WKApp.mittBus.off("summary-list-refresh-requested" as any, this.handleListRefreshRequested_);
        window.removeEventListener("summary-task-regenerated", this.handleTaskRegenerated_);
        window.removeEventListener("summary-read", this.handleSummaryRead_);
        window.removeEventListener("summary-detail-active", this.handleDetailActive_);
        window.removeEventListener("summary-detail-inactive", this.handleDetailInactive_);
    }

    async fetchData(): Promise<{ items: SummaryListItem[]; total: number }> {
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
        return { items: resp.items, total: resp.total };
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
            this.setState({
                items: resp.items,
                total: resp.total,
                loading: false,
                hasMore: resp.items.length < resp.total,
            }, () => {
                this.maybeStartBatchPoll();
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
                // #290：进入终态时，仅原地打 status 补丁不够——完成后 backend 才会
                // 填/改标题、结果预览等字段，且列表加载后新建的任务不在轮询集合里。
                // 因此终态变化触发一次「静默」全量刷新（不显示加载态、不重置分页深度）。
                const hasTerminal = changedIds.some(id => {
                    const u = updateMap.get(id);
                    return !!u && isTerminalStatus(u.status);
                });
                if (hasTerminal) {
                    // Apply the confirmed status patch immediately so cards
                    // do not render a stale non-terminal status (with Cancel
                    // affordance) for the refresh round-trip. Fire the silent
                    // refresh right after — do not defer it into the setState
                    // callback (that adds a React commit for no benefit), and
                    // do not call maybeStartBatchPoll here because the refresh
                    // itself calls it on completion.
                    this.setState({ items: newItems });
                    void this.refreshListSilently();
                } else {
                    // 非终态（如 PENDING→PROCESSING）保留廉价的原地状态补丁即可。
                    this.setState({ items: newItems }, () => {
                        this.maybeStartBatchPoll();
                    });
                }
                window.dispatchEvent(new CustomEvent("summary-status-change", { detail: { taskIds: changedIds } }));
            }
        } catch {
            // ignore
        } finally {
            this.isBatchPolling = false;
        }
    }

    /**
     * 静默全量刷新（#290）：拉取最新列表 · 把返回的行 **合并** 进 `state.items`
     * (按 task_id 覆盖 · 新任务前置)· 从不裁掉用户已加载的尾部 · 从不改
     * `state.page`。用 `page_size = min(pageSize × page, 100)` 只覆盖前缀,
     * 用户已滚过的行由 in-place merge 保留不动。与 loadData 的区别:不塌回
     * 第 1 页、不闪加载态、不缩短列表。出错则保留原状,下次交给终态事件重试。
     *
     * Concurrency invariants:
     * - `isRefreshing` short-circuits overlapping refresh calls.
     * - Captured `statusFilter` / `keyword` / `channelId`: if any changed
     *   during the fetch the response is scoped to stale filters, drop it.
     * - `isMounted_` guard: don't setState after unmount.
     *
     * Merge-not-replace closes the concurrent-writer question by construction:
     * we never overwrite `items[k]` past what the server just returned, so a
     * loadMore that appended rows during the fetch cannot lose them, and a
     * refresh that races another refresh cannot roll rows back. `page` is
     * refresh-invariant.
     */
    private async refreshListSilently() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;
        const capturedStatus = this.state.statusFilter;
        const capturedKeyword = this.state.keyword;
        const capturedChannel = this.props.channelId;
        try {
            const { pageSize, page } = this.state;
            // 覆盖已加载页前缀；防止后端对 page_size 有上限，clamp 到 100。
            // 尾部由 merge 保留，不再依赖此值覆盖全部已加载行。
            const coverSize = Math.min(pageSize * Math.max(1, page), 100);
            const params: ListSummariesParams = {
                page: 1,
                page_size: coverSize,
                status: capturedStatus,
                keyword: capturedKeyword || undefined,
                origin_channel_id: capturedChannel || undefined,
            };
            const resp = await api.listSummaries(params);
            if (!this.isMounted_) return;
            if (
                capturedStatus !== this.state.statusFilter ||
                capturedKeyword !== this.state.keyword ||
                capturedChannel !== this.props.channelId
            ) {
                return;
            }
            // Merge instead of replace: overlay fresh rows onto existing by
            // task_id (fresh wins for enriched fields like title / preview),
            // preserving user's loaded tail past coverSize. Brand-new tasks
            // in the fresh response that weren't loaded before come in at
            // the top (list is sorted newest-first).
            this.setState((prev) => {
                const freshById = new Map(resp.items.map((x: any) => [x.task_id, x]));
                const existingIds = new Set(prev.items.map((x: any) => x.task_id));
                const newFromFresh = resp.items.filter((x: any) => !existingIds.has(x.task_id));
                const overlaidExisting = prev.items.map((x: any) => freshById.get(x.task_id) ?? x);
                const merged = [...newFromFresh, ...overlaidExisting];
                return {
                    items: merged as any,
                    total: resp.total,
                    hasMore: merged.length < resp.total,
                };
            }, () => {
                if (this.isMounted_) this.maybeStartBatchPoll();
            });
        } catch {
            // Refresh failed. The local status patch applied before this
            // refresh already wrote the terminal status, so the next
            // doBatchPoll tick sees no change and will NOT re-fire the
            // refresh — a transient network blip degrades the list back to
            // the pre-fix behaviour (stale title / preview / new-task
            // invisibility) until some other event triggers a full load.
            // Not attempting an in-place retry keeps the failure mode
            // simple: no unbounded event storm, no stuck spinner.
        } finally {
            this.isRefreshing = false;
        }
    }

    private stopBatchPoll() {
        if (this.batchPollTimer) {
            clearInterval(this.batchPollTimer);
            this.batchPollTimer = null;
        }
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
