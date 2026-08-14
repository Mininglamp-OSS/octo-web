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
import { setPendingInvitationBadge } from "../utils/summaryMenuBadge";
import type {
    SummaryListItem,
    ListSummariesParams,
    TaskStatusType,
} from "../types/summary";
import { TaskStatus } from "../types/summary";
import { getStatusLabel, isTerminalStatus } from "../utils/summaryHelpers";
import { summaryTestIds } from "../utils/testIds";
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
    // Monotonic sequence bumped on every loadData() entry. An in-flight
    // loadData captures the value pre-await; if it advanced during the
    // request (user changed filter/keyword/space, or another loadData fired),
    // the response is stale and we drop it instead of overwriting newer
    // user-driven state. loadMore also captures pre-await and drops its
    // batch on mismatch — closes loadMore-starts-first, loadData-bumps-after.
    private loadDataSeq = 0;
    // Synchronous "is a loadData in flight" flag. React 18 batching means
    // this.state.loading is not visible immediately after setState from a
    // promise continuation, so loadMore reading state.loading would miss a
    // just-started loadData. Setting/clearing a plain field is synchronous
    // and closes the loadData-starts-first, loadMore-scrolls-after ordering.
    // Kept alongside loadDataSeq — the pair covers both interleavings.
    private isLoadingData = false;
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

    async loadData(opts: { silent?: boolean } = {}) {
        // Bump-and-capture sequence: this loadData's response is only allowed
        // to commit if no newer loadData/filter change has started meanwhile.
        // Extended in round-7 so loadMore also captures pre-await and drops
        // its batch on mismatch. Round-8 added isLoadingData below because
        // this sequence alone is asymmetric — a loadMore that starts AFTER
        // loadData already bumped captures the already-bumped value and
        // would still commit.
        const seq = ++this.loadDataSeq;
        const requestSpaceId = WKApp.shared.currentSpaceId;
        this.isLoadingData = true;
        // Only toggle loading. Do NOT pre-set page:1 / hasMore:true here —
        // if the request fails in silent mode we would leave items at the
        // old depth with page reset to 1, and the next loadMore would
        // duplicate rows (round-6). Commit page/hasMore atomically with
        // items on success instead.
        // Silent refresh keeps the existing error banner if any (round-8
        // yujiawei P2-2): a user-visible error the user already saw must
        // not be erased by an automatic background refresh.
        this.setState(opts.silent ? { loading: true } : { loading: true, error: null });
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
            if (seq !== this.loadDataSeq) return;
            // Post-await mount check (round-8 yujiawei P2-3): the entry
            // isMounted_ guard cannot cover the await window; React 18 will
            // drop setState on an unmounted fiber but the callback would
            // still be scheduled. Also bind the response to the Space that
            // issued it so an unmounted/late list cannot commit stale data.
            if (!this.isMounted_ || WKApp.shared.currentSpaceId !== requestSpaceId) return;
            // #1359 只有全局列表拥有写 NavRail badge 的职责。后端 count 虽然是
            // Space 级，但聊天侧栏是嵌入式 channel 实例，不应改写全局导航状态。
            if (!this.props.channelId) {
                setPendingInvitationBadge(resp.pending_invitation_count ?? 0);
            }
            this.setState({
                items: resp.items,
                page: 1,
                total: resp.total,
                loading: false,
                // Round-9 yujiawei P2-3: a silent refresh that succeeds
                // must clear a pre-existing error banner too. Otherwise a
                // failed user-driven load leaves a non-dismissable banner
                // that sits above a perfectly fresh list.
                error: null,
                hasMore: resp.items.length < resp.total,
            }, () => {
                if (this.isMounted_) this.maybeStartBatchPoll();
            });
        } catch (err: any) {
            if (seq !== this.loadDataSeq) return;
            if (!this.isMounted_) return;
            // Background refresh (silent=true) must not surface a network
            // banner to an idle user — just clear loading and leave the last
            // good list visible. A user-triggered loadData still shows the
            // banner + Retry so they can act on the failure.
            if (opts.silent) {
                this.setState({ loading: false });
                return;
            }
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        } finally {
            // Sequence-owned clear (round-9 yujiawei P2-2): with two
            // overlapping loadData calls, the older stale one returning
            // early at the seq check would otherwise clear the flag while
            // the newer one is still in flight. Only the current loadData
            // is allowed to release the guard.
            if (seq === this.loadDataSeq) this.isLoadingData = false;
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
        // isLoadingData is a synchronous flag set at loadData entry: closes
        // the "loadData started first, scroll fires before React commits
        // loading:true" ordering that reading state.loading would miss.
        if (this.state.loadingMore || !this.state.hasMore
            || this.state.loading || this.isLoadingData) return;
        // Also capture loadDataSeq: if any loadData starts and bumps it
        // while our request is in flight, the list will be reset under us
        // and our appended batch would splice a hole. Discard on mismatch.
        // The pair (isLoadingData at entry + seq at commit) closes both
        // orderings — loadData-first, loadMore-first — deterministically.
        const seq = this.loadDataSeq;
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
            if (seq !== this.loadDataSeq) {
                this.setState({ loadingMore: false });
                return;
            }
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
                // 因此终态变化触发一次全量刷新(委派给 loadData · 见 refreshListSilently)。
                // 会短暂显示 spinner + 塌回 page 1—这是 loadData 的必然副作用,
                // 换来 correct-by-construction 的过滤/space/loadMore 语义。
                //
                // 终态分支不落 local status 补丁(round-9 yujiawei P1):
                // 早期版本先 patch 到 items 再 refresh · 但若 refresh 失败(silent
                // 分支静默 return · 或被 isRefreshing 丢),items 已经写成 COMPLETED
                // 会让 maybeStartBatchPoll 看到 active tasks 为空 → stopBatchPoll →
                // 永远无法自动 retry · 卡片保留 stale 标题/预览。
                // 保留 items 里的 non-terminal 状态,下次 poll tick 依然 detect
                // change → 自动 retry refresh。渲染层因 loading:true 会 unmount
                // 列表容器,用户看不到瞬时的 "still-non-terminal" 状态。
                const hasTerminal = changedIds.some(id => {
                    const u = updateMap.get(id);
                    return !!u && isTerminalStatus(u.status);
                });
                if (hasTerminal) {
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
     * 终态完成后刷新列表(#290)。委派给 loadData —— #290 原方案就是用 loadData()。
     * 我们绕过它想避免 spinner + page collapse,但四轮 review 后结论是:
     * offset-paged list 上做静默 refresh + merge/replace 都会在某个 route 破坏
     * filter/space/loadMore 语义。loadData 是 "correct by construction" 姿势 ——
     * spinner 一闪是合理的用户反馈,而且 loadData 恢复了旧 replace 模型的正确性:
     * filter 变化时 fall-out 行会被丢掉、space 切换清空、loadMore 的分页游标
     * 由 loadData 重置为 1(loadMore 的 stale-response guard 会 discard 过期 append)。
     *
     * `isRefreshing` 防重入(2s 轮询 tick 撞到 refresh 在跑就跳过);
     * `isMounted_` 在进入 loadData 前短路。
     *
     * `silent: true` 让 loadData 在失败时不设 error banner(见 #290 review):
     * 自动 refresh 不该给 idle 的用户弹网络错误。
     */
    private async refreshListSilently() {
        if (this.isRefreshing) return;
        if (!this.isMounted_) return;
        this.isRefreshing = true;
        try {
            await this.loadData({ silent: true });
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
                        <SummaryCreatePage onCreated={() => this.loadData()} source="summary_list" />
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
            <SummaryCreatePage onCreated={() => this.loadData()} source="summary_list" />
        );
    };

    render() {
        const { items, total, pageSize, loading, loadingMore, hasMore, error, statusFilter, keyword, activeTaskId } = this.state;
        const { channelId, onClose } = this.props;
        const { locale, t: translate } = this.context;
        const statusOptions = getStatusOptions();
        const isPanel = Boolean(channelId);

        return (
            <div data-testid={summaryTestIds.list} className={`summary-list-page${isPanel ? " summary-list-page--panel" : ""}`}>
                <div className="summary-list-header">
                    <h2 className="summary-list-title">
                        {isPanel ? translate("summary.chatSummary.panelTitle") : translate("summary.list.title")}
                    </h2>
                    <div className="summary-list-header-actions">
                        {isPanel && (
                            <Tooltip content={translate("summary.chatSummary.createNew")} position="bottom">
                                <Button
                                    className="summary-list-create-icon-btn"
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
                                    data-testid={summaryTestIds.listCreate}
                                    className="summary-list-create-icon-btn"
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
                            data-testid={summaryTestIds.listSearch}
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
                        <div data-testid={summaryTestIds.listStatusFilter} className="summary-list-status-trigger">
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
                                <Button data-testid={summaryTestIds.createEntry} theme="solid" onClick={this.handleCreate} style={{ marginTop: 16 }}>
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
                                <Button data-testid={summaryTestIds.createEntry} theme="solid" onClick={this.handleCreate} style={{ marginTop: 16 }}>
                                    {translate("summary.list.createFirst")}
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {!loading && items.length > 0 && (
                    <div data-testid={summaryTestIds.listContent} className="summary-list-content" onScroll={this.handleScroll}>
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
