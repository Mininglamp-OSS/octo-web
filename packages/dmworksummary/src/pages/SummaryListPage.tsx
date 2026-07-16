import React, { Component } from "react";
import {
    Button,
    Input,
    Select,
    Spin,
    Pagination,
    Toast,
    Banner,
    Tooltip,
} from "@douyinfe/semi-ui";
import { IconSearch, IconPlus, IconRefresh } from "@douyinfe/semi-icons";
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

interface SummaryListPageState {
    items: SummaryListItem[];
    total: number;
    page: number;
    pageSize: number;
    loading: boolean;
    error: string | null;
    statusFilter: TaskStatusType | undefined;
    keyword: string;
}

const getStatusOptions = () => [
    { value: "", label: t("summary.list.allStatus") },
    { value: TaskStatus.PENDING, label: getStatusLabel(TaskStatus.PENDING) },
    { value: TaskStatus.WAITING_CONFIRM, label: getStatusLabel(TaskStatus.WAITING_CONFIRM) },
    { value: TaskStatus.PROCESSING, label: getStatusLabel(TaskStatus.PROCESSING) },
    { value: TaskStatus.COMPLETED, label: getStatusLabel(TaskStatus.COMPLETED) },
    { value: TaskStatus.FAILED, label: getStatusLabel(TaskStatus.FAILED) },
    { value: TaskStatus.CANCELLED, label: getStatusLabel(TaskStatus.CANCELLED) },
];

export default class SummaryListPage extends Component<{}, SummaryListPageState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryListPageState = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        loading: false,
        error: null,
        statusFilter: undefined,
        keyword: "",
    };

    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    private batchPollTimer: ReturnType<typeof setInterval> | null = null;
    private isBatchPolling = false;
    private attentionCount = 0;
    private attentionRefreshLoading = false;

    private handleSpaceChanged_ = () => this.loadData();

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
        window.addEventListener("summary-task-regenerated", this.handleTaskRegenerated_);
        window.addEventListener("summary-read", this.handleSummaryRead_);
    }

    componentWillUnmount() {
        window.dispatchEvent(new CustomEvent("summary-list-unmount"));
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.stopBatchPoll();
        WKApp.mittBus.off("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
        WKApp.mittBus.off("summary-attention-count-refreshed" as any, this.handleAttentionCountRefreshed_);
        window.removeEventListener("summary-task-regenerated", this.handleTaskRegenerated_);
        window.removeEventListener("summary-read", this.handleSummaryRead_);
    }

    async loadData() {
        this.setState({ loading: true, error: null });
        try {
            const { page, pageSize, statusFilter, keyword } = this.state;
            const params: ListSummariesParams = {
                page,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
            };
            const resp = await api.listSummaries(params);
            this.attentionCount = resp.attention_count ?? 0;
            this.setState({ items: resp.items, total: resp.total, loading: false }, () => {
                this.maybeStartBatchPoll();
                this.emitBadgeUpdate(resp.attention_count);
            });
        } catch (err: any) {
            this.setState({ error: err.message || t("summary.common.loadingFailed"), loading: false });
        }
    }

    handlePageChange = (page: number) => {
        this.setState({ page }, () => this.loadData());
    };

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
            WKApp.routeRight.popToRoot();
            WKApp.routeRight.push(
                <SummaryCreatePage onCreated={() => this.loadData()} />
            );
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.deleteFailed"));
        }
    };

    handleCardClick = (taskId: number) => {
        WKApp.routeRight.popToRoot();
        WKApp.routeRight.push(<SummaryDetailPage taskId={taskId} />);
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

    handleCreate = () => {
        WKApp.routeRight.popToRoot();
        WKApp.routeRight.push(
            <SummaryCreatePage onCreated={() => this.loadData()} />
        );
    };

    render() {
        const { items, total, page, pageSize, loading, error, statusFilter, keyword } = this.state;
        const { locale, t: translate } = this.context;
        const statusOptions = getStatusOptions();

        return (
            <div className="summary-list-page">
                <div className="summary-list-header">
                    <h2 className="summary-list-title">{translate("summary.list.title")}</h2>
                    <Tooltip content={translate("summary.list.createTooltip")} position="bottom">
                        <Button
                            icon={<IconPlus />}
                            theme="borderless"
                            onClick={this.handleCreate}
                        />
                    </Tooltip>
                </div>

                <div className="summary-list-toolbar">
                    <Input
                        className="summary-list-search"
                        prefix={<IconSearch />}
                        placeholder={translate("summary.list.searchPlaceholder")}
                        value={keyword}
                        onChange={this.handleKeywordChange}
                        showClear
                    />
                    <Select
                        className="summary-list-status-filter"
                        key={locale}
                        value={statusFilter ?? ""}
                        onChange={this.handleStatusChange}
                    >
                        {statusOptions.map((opt) => (
                            <Select.Option key={String(opt.value)} value={opt.value}>
                                {opt.label}
                            </Select.Option>
                        ))}
                    </Select>
                    <Button
                        className="summary-list-refresh"
                        icon={<IconRefresh />}
                        theme="borderless"
                        onClick={() => this.loadData()}
                    />
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
                        <div className="summary-list-empty-icon">📄</div>
                        <div className="summary-list-empty-title">{translate("summary.list.emptyTitle")}</div>
                        <div className="summary-list-empty-desc">
                            {translate("summary.list.emptyDesc")}
                        </div>
                        <Button theme="solid" onClick={this.handleCreate} style={{ marginTop: 16 }}>
                            {translate("summary.list.createFirst")}
                        </Button>
                    </div>
                )}

                {!loading && items.length > 0 && (
                    <>
                        <div className="summary-list-content">
                            {items.map((item) => (
                                <SummaryCard
                                    key={item.task_id}
                                    task={item}
                                    onClick={this.handleCardClick}
                                    onDelete={this.handleDelete}
                                    onRespond={this.handleRespond}
                                    onLeave={this.handleLeave}
                                />
                            ))}
                        </div>
                        {total > pageSize && (
                            <div className="summary-list-pagination">
                                <Pagination
                                    currentPage={page}
                                    pageSize={pageSize}
                                    total={total}
                                    onPageChange={this.handlePageChange}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }
}
