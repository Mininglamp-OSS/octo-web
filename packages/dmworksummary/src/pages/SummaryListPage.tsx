import React, { Component } from "react";
import { Button, Dropdown, Spin, Toast, Banner } from "@douyinfe/semi-ui";
import { IconSearch, IconPlus } from "@douyinfe/semi-icons";
import { X, ChevronDown } from "lucide-react";
import { I18nContext, t, WKApp, Dap } from "@octo/base";
import * as api from "../api/summaryApi";
import { fetchSummaryListPrefix, SummaryPaginationDriftError } from "../api/summaryListPagination";
import { requestSummaryScheduleOpen, requestSummaryDetailAction } from "../utils/summaryDetailIntent";
import {
  abandonSummaryAttentionRead,
  beginSummaryAttentionRead,
  commitSummaryAttentionBadge,
} from "../utils/summaryAttentionBadge";
import type {
    SummaryListItem,
    ListSummariesParams,
    TaskStatusType,
} from "../types/summary";
import { TaskStatus, TriggerType } from "../types/summary";
import { getStatusLabel, isTerminalStatus } from "../utils/summaryHelpers";
import { summaryTestIds } from "../utils/testIds";
import SummaryCard from "../components/SummaryCard";
import SummaryWorkbenchEntry from "../features/summaryWorkbench/Entry";
import SummaryWorkbenchCreateEntry from "../features/summaryWorkbench/SummaryWorkbenchCreateEntry";
import SummaryCreatePage from "./SummaryCreatePage";
import SummaryDetailPage from "./SummaryDetailPage";

type SummaryCreateEntryMode = "pending" | "unified" | "legacy";
type SummaryReadPatch = (items: SummaryListItem[]) => SummaryListItem[];

const MAX_ACTIVATION_REFRESH_ROWS = 100;
const LOAD_MORE_RETRY_COOLDOWN_MS = 3000;

interface SummaryListPageProps {
    channelId?: string;
  /** Compact list styling for a host-owned workspace pane. */
  embedded?: boolean;
  /** Host-owned refresh signal for a controlled workspace. */
  refreshKey?: number;
  /** Host invalidation that keeps the retained list and pagination visible. */
  backgroundRefreshKey?: number;
    /** Called when the user clicks the close button (panel mode only). */
    onClose?: () => void;
    /** Called when the user clicks "new summary" in panel mode. */
    onCreateNew?: (mode?: "normal" | "agent" | "unified") => void;
    /** Called when a card is clicked in panel mode (instead of routeRight.push). */
    onViewDetail?: (taskId: number) => void;
    /** Opens continue-optimization inside the host panel when provided. */
    onContinueOptimize?: (task: SummaryListItem) => void;
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
  {
    value: TaskStatus.PROCESSING,
    label: getStatusLabel(TaskStatus.PROCESSING),
  },
    { value: TaskStatus.COMPLETED, label: getStatusLabel(TaskStatus.COMPLETED) },
    { value: TaskStatus.FAILED, label: getStatusLabel(TaskStatus.FAILED) },
    { value: TaskStatus.CANCELLED, label: getStatusLabel(TaskStatus.CANCELLED) },
];

export default class SummaryListPage extends Component<
  SummaryListPageProps,
  SummaryListPageState
> {
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
    // 「+」每次新建的序号：并入 push 元素的 key，保证连续两次选同一模式也强制重挂载
    // （见 handleCreate 注释）。key 只按 mode 时，同模式重选会命中 React 复用分支。
    private createEntrySeq = 0;
    // Synchronous "is a loadData in flight" flag. React 18 batching means
    // this.state.loading is not visible immediately after setState from a
    // promise continuation, so loadMore reading state.loading would miss a
    // just-started loadData. Setting/clearing a plain field is synchronous
    // and closes the loadData-starts-first, loadMore-scrolls-after ordering.
    // Kept alongside loadDataSeq — the pair covers both interleavings.
    private isLoadingData = false;
    private isLoadingMore = false;
    private activationRefreshPending = false;
    private loadMoreRetryAt = 0;
    private paginationErrorVisible = false;
    // Replay only reads received during each request, then release its patches.
    private pendingReadPatches = new Set<SummaryReadPatch[]>();
    // Cleared by componentWillUnmount so any in-flight refresh's setState
    // becomes a no-op instead of restarting maybeStartBatchPoll on a
    // torn-down component.
    private isMounted_ = false;

    private handleSpaceChanged_ = () => this.loadData();

    private handleListRefreshRequested_ = () => this.loadData();

    private handleTaskRegenerated_ = () => this.loadData();

    private handleSummaryRead_ = (event: Event) => {
    const detail = (
      event as CustomEvent<{
            taskId: number;
            isUnread?: boolean;
            needsAttention?: boolean;
            hasPendingSubmission?: boolean;
      }>
    ).detail;
        const taskId = detail?.taskId;
        if (!detail || !taskId) return;
        const patch: SummaryReadPatch = (items) => items.map((item) => {
                if (item.task_id !== taskId) return item;
                // 看过 ≠ 已提交（owner 2026-08-26）：标读不清除待提交红点。
                //
                // 红点信号只信服务端刚回的 needsAttention / hasPendingSubmission，
                // 不用旧 item 的待提交值参与 needs_attention，避免把陈旧字段重新钉回红点。
                // 但卡片字段本身保留旧值作为老后端兼容：旧接口不返回该字段时，维持
                // 线上既有的等待态展示；新接口返回值时则以新值覆盖。
                const pendingSubmission = detail.hasPendingSubmission;
                return {
                    ...item,
                    is_unread: detail.isUnread ?? false,
          has_pending_submission:
            pendingSubmission ?? item.has_pending_submission,
                    // 两个信号分开处理：
                    // ・邀请：新后端的 needsAttention 已包含它；旧后端省略字段时回退到卡片标记。
                    // ・待提交：新后端的 needs_attention 已含它，这里的 OR 是冗余安全网；
                    //   旧后端下 pendingSubmission 为 undefined，OR 不会凭空造出红点。
          needs_attention:
            (detail.needsAttention ?? Boolean(item.has_pending_invitation)) ||
            Boolean(pendingSubmission),
                };
            });
        this.pendingReadPatches.forEach((patches) => patches.push(patch));
        this.setState(({ items }) => ({ items: patch(items) }));
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
    this.setState((state) =>
      state.activeTaskId === taskId ? { activeTaskId: null } : null
    );
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
    WKApp.mittBus.on(
      "summary-list-refresh-requested" as any,
      this.handleListRefreshRequested_
    );
    window.addEventListener(
      "summary-task-regenerated",
      this.handleTaskRegenerated_
    );
        window.addEventListener("summary-read", this.handleSummaryRead_);
        window.addEventListener("summary-detail-active", this.handleDetailActive_);
    window.addEventListener(
      "summary-detail-inactive",
      this.handleDetailInactive_
    );
    }

    componentDidUpdate(prevProps: SummaryListPageProps) {
    if (
      prevProps.channelId !== this.props.channelId ||
      prevProps.refreshKey !== this.props.refreshKey
    ) {
            this.loadData();
        } else if (prevProps.backgroundRefreshKey !== this.props.backgroundRefreshKey) {
            this.activationRefreshPending = true;
            this.flushActivationRefresh();
        }
    }

    private flushActivationRefresh = () => {
        if (!this.isMounted_ || !this.activationRefreshPending ||
            this.isLoadingData || this.isLoadingMore) return;
        this.activationRefreshPending = false;
        void this.loadData({ silent: true, retainView: true });
    };

    private flushActivationAfterCommit() {
        if (!this.isMounted_ || !this.activationRefreshPending) return;
        // React may still be committing the foreground load's new page depth.
        this.setState({}, this.flushActivationRefresh);
    }

    componentWillUnmount() {
        this.isMounted_ = false;
        this.activationRefreshPending = false;
        this.pendingReadPatches.clear();
        window.dispatchEvent(new CustomEvent("summary-list-unmount"));
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.stopBatchPoll();
        WKApp.mittBus.off("summary-space-changed", this.handleSpaceChanged_);
        WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.off(
      "summary-list-refresh-requested" as any,
      this.handleListRefreshRequested_
    );
    window.removeEventListener(
      "summary-task-regenerated",
      this.handleTaskRegenerated_
    );
        window.removeEventListener("summary-read", this.handleSummaryRead_);
    window.removeEventListener(
      "summary-detail-active",
      this.handleDetailActive_
    );
    window.removeEventListener(
      "summary-detail-inactive",
      this.handleDetailInactive_
    );
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

    async loadData(opts: { silent?: boolean; retainView?: boolean } = {}): Promise<number | undefined> {
        // Bump-and-capture sequence: this loadData's response is only allowed
        // to commit if no newer loadData/filter change has started meanwhile.
        // Extended in round-7 so loadMore also captures pre-await and drops
        // its batch on mismatch. Round-8 added isLoadingData below because
        // this sequence alone is asymmetric — a loadMore that starts AFTER
        // loadData already bumped captures the already-bumped value and
        // would still commit.
        const seq = ++this.loadDataSeq;
        const requestSpaceId = WKApp.shared.currentSpaceId;
        const { pageSize, statusFilter, keyword } = this.state;
        const channelId = this.props.channelId;
        // Bound automatic refresh cost; deeper pages are fetched lazily again.
        const pagesToReload = opts.retainView
            ? Math.min(this.state.page, Math.max(1, Math.floor(MAX_ACTIVATION_REFRESH_ROWS / pageSize)))
            : 1;
        const isCurrent = () => seq === this.loadDataSeq &&
            this.isMounted_ && WKApp.shared.currentSpaceId === requestSpaceId &&
            (!opts.retainView || (
                this.props.channelId === channelId &&
                this.state.statusFilter === statusFilter &&
                this.state.keyword === keyword
            ));
        const readPatches: SummaryReadPatch[] = [];
        this.pendingReadPatches.add(readPatches);
        if (!opts.retainView) {
            this.activationRefreshPending = false;
            this.loadMoreRetryAt = 0;
        }
        // 领一个待关注计数的读取号，必须在 await 之前：号码代表“这份数据是
        // 什么时候向服务端要的”。列表与 page_size=1 探测是两个并行写者，按发出
        // 时刻排序；否则一个先发后到、快照更旧的列表响应会盖掉用户刚触发的
        // 正确探测（读/提交/应答），红点卡在陈值。
        // 样本时刻同样在 await 之前取。列表端点【没有】那层 5s 缓存，所以不折算：
        // 发出时刻就是它反映的时刻。
        //
        // 显式传，而不是让 commit 走 `?? Date.now()` 的缺省：那个缺省会在 await
        // 【之后】求值，记下的是【到达】时刻，而其它写者记的都是【发出】时刻。列表
        // 又恰好是最慢的那个请求（它 join 参与者、逐行算 needs_attention，本 PR 加窄
        // 端点就是为了避开它）。一次 2s 的列表加载会把水位凭空抬高 2s，之后约
        // latency + ATTENTION_CACHE_TTL_MS 内发出的非 fresh 轮询读会被水位闸静默丢掉。
        const attentionIssuedAt = Date.now();
    const attentionTicket = this.props.channelId
      ? null
      : beginSummaryAttentionRead(attentionIssuedAt);
        // 票号是否已被成功消费。finally 里据此决定还不还号：成功 commit 后
        // 若把号还回去，等于给更早的陈旧快照开后门。
        let attentionCommitted = false;
        this.isLoadingData = true;
        // Only toggle loading. Do NOT pre-set page:1 / hasMore:true here —
        // if the request fails in silent mode we would leave items at the
        // old depth with page reset to 1, and the next loadMore would
        // duplicate rows (round-6). Commit page/hasMore atomically with
        // items on success instead.
        // Silent refresh keeps the existing error banner if any (round-8
        // yujiawei P2-2): a user-visible error the user already saw must
        // not be erased by an automatic background refresh.
        if (!opts.retainView) {
            if (!opts.silent) this.paginationErrorVisible = false;
            this.setState(
                opts.silent ? { loading: true } : { loading: true, error: null }
            );
        }
        try {
            const params: ListSummariesParams = {
                page: 1,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
                origin_channel_id: channelId || undefined,
            };
            const resp = opts.retainView
                ? await fetchSummaryListPrefix(params, pagesToReload * pageSize, isCurrent)
                : await api.listSummaries(params);
            if (!resp || !isCurrent()) return;
            this.loadMoreRetryAt = 0;
            this.paginationErrorVisible = false;
            const page = opts.retainView
                ? Math.max(1, Math.min(pagesToReload, Math.ceil(resp.total / pageSize)))
                : 1;
            // #1359 只有全局列表拥有写 NavRail badge 的职责。后端 count 虽然是
            // Space 级，但聊天侧栏是嵌入式 channel 实例，不应改写全局导航状态。
            // 用发请求前领的 ticket 提交：期间若有更新的读取发出，本次就是陈旧
            // 快照，丢弃即可——那个更新的读取会带回正确值。
            if (attentionTicket !== null) {
                // 号在这里就销掉（commit 或 abandon 二者之一），finally 不再重复处理。
                attentionCommitted = true;
                if (Number.isFinite(resp.attention_count)) {
          commitSummaryAttentionBadge(
            attentionTicket,
            resp.attention_count as number,
            attentionIssuedAt
          );
                } else {
                    // 不再 `?? 0`。那是 api/summaryApi.ts 的 assertAttentionCounts 这一轮
                    // 专门要消掉的静默归零模式：一个信封错位的响应（网关改包装、后端返回
                    // HTML 错误页、字段改名）会让 attention_count 取到 undefined，`?? 0`
                    // 把它当成正常样本落盘，红点静默清零——而且这条写入还会被广播出去，
                    // 把错误放大到全部标签页。窄端点与 404 兜底两条路都已经过校验，这里
                    // 是最后一个缺口。
                    //
                    // 按失败处理（还号 + 保持旧值），与那两条路「抛出去、上层退避」的策略
                    // 一致：没有红点和红点不对用户分辨不出来，也不会报 bug。
                    abandonSummaryAttentionRead(attentionTicket);
                }
            }
      this.setState(
        () => ({
                items: readPatches.reduce((items, patch) => patch(items), resp.items),
                page,
                total: resp.total,
                loading: false,
                // Round-9 yujiawei P2-3: a silent refresh that succeeds
                // must clear a pre-existing error banner too. Otherwise a
                // failed user-driven load leaves a non-dismissable banner
                // that sits above a perfectly fresh list.
                error: null,
                hasMore: resp.items.length < resp.total,
        }),
        () => {
                if (this.isMounted_) this.maybeStartBatchPoll();
        }
      );
      // DAP-271 finding 6：返回本次已提交的结果总数,供 handleKeywordChange 就近取 has_result
      //   (只有真正取得搜索结果才打点)。被更新请求超越/卸载/失败的分支返回 undefined → 不打点。
      return resp.total;
        } catch (err: any) {
            if (!isCurrent()) return;
            // Background refresh (silent=true) must not surface a network
            // banner to an idle user. Exhausted pagination repairs still
            // expose Retry so a persistently inconsistent list is actionable.
            if (opts.silent && !(err instanceof SummaryPaginationDriftError)) {
                this.setState({ loading: false });
                return undefined;
            }
            this.paginationErrorVisible = false;
      this.setState({
        error: err instanceof SummaryPaginationDriftError
            ? t("summary.common.loadingFailed")
            : err.message || t("summary.common.loadingFailed"),
        loading: false,
      });
      return undefined;
        } finally {
            this.pendingReadPatches.delete(readPatches);
            // Sequence-owned clear (round-9 yujiawei P2-2): with two
            // overlapping loadData calls, the older stale one returning
            // early at the seq check would otherwise clear the flag while
            // the newer one is still in flight. Only the current loadData
            // is allowed to release the guard.
            if (seq === this.loadDataSeq) {
                this.isLoadingData = false;
                this.flushActivationAfterCommit();
            }
            // Ticket liveness: this loadData took a ticket
            // but never committed it (superseded by a newer loadData,
            // unmounted, Space changed, or the request failed). Release the
            // number so it cannot strand an older in-flight read that still
            // carries the correct count. No-op once a newer read owns the
            // sequence; never runs after a successful commit.
            if (attentionTicket !== null && !attentionCommitted) {
                abandonSummaryAttentionRead(attentionTicket);
            }
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
    if (
      this.state.loadingMore ||
      this.isLoadingMore ||
      !this.state.hasMore ||
      this.state.loading ||
      this.isLoadingData ||
      Date.now() < this.loadMoreRetryAt
    )
      return;
        // Also capture loadDataSeq: if any loadData starts and bumps it
        // while our request is in flight, the list will be reset under us
        // and our appended batch would splice a hole. Discard on mismatch.
        // The pair (isLoadingData at entry + seq at commit) closes both
        // orderings — loadData-first, loadMore-first — deterministically.
        const seq = this.loadDataSeq;
        const requestSpaceId = WKApp.shared.currentSpaceId;
        const { page, pageSize, statusFilter, keyword, total, items } = this.state;
        const channelId = this.props.channelId;
        const isCurrent = () => seq === this.loadDataSeq && this.isMounted_ &&
            WKApp.shared.currentSpaceId === requestSpaceId && this.props.channelId === channelId &&
            this.state.statusFilter === statusFilter && this.state.keyword === keyword;
        const readPatches: SummaryReadPatch[] = [];
        this.pendingReadPatches.add(readPatches);
        this.isLoadingMore = true;
        this.setState({ loadingMore: true });
        try {
            const nextPage = page + 1;
            const params: ListSummariesParams = {
                page: nextPage,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
                origin_channel_id: channelId || undefined,
            };
            let resp = await api.listSummaries(params);
            if (!isCurrent()) return;
            const combined = [...items, ...resp.items];
            const uniqueCount = new Set(combined.map((item) => item.task_id)).size;
            const repairPrefix = resp.total !== total || uniqueCount !== combined.length ||
                items.length !== page * pageSize ||
                resp.items.length !== Math.min(pageSize, Math.max(0, resp.total - page * pageSize));
            if (repairPrefix) {
                // Counts and server offsets are different things after drift.
                // Repair the entire prefix instead of advancing past missing rows.
                const repaired = await fetchSummaryListPrefix(params, nextPage * pageSize, isCurrent);
                if (!repaired || !isCurrent()) return;
                resp = repaired;
            }
            this.loadMoreRetryAt = 0;
            const clearPaginationError = this.paginationErrorVisible;
            this.paginationErrorVisible = false;
      this.setState(
        (prev) => {
            const fresh = readPatches.reduce((rows, patch) => patch(rows), resp.items);
            const byId = new Map((repairPrefix ? fresh : [...prev.items, ...fresh])
                .map((item) => [item.task_id, item]));
            const nextItems = Array.from(byId.values());
            return {
                items: nextItems,
                total: resp.total,
                page: Math.max(1, Math.min(nextPage, Math.ceil(resp.total / pageSize))),
                loadingMore: false,
                ...(clearPaginationError ? { error: null } : {}),
                hasMore: nextItems.length < resp.total,
            };
        },
        () => { if (this.isMounted_) this.maybeStartBatchPoll(); }
      );
        } catch (err) {
            if (isCurrent()) {
                this.loadMoreRetryAt = Date.now() + LOAD_MORE_RETRY_COOLDOWN_MS;
                const showPaginationError = err instanceof SummaryPaginationDriftError &&
                    (!this.state.error || this.paginationErrorVisible);
                if (showPaginationError) this.paginationErrorVisible = true;
                this.setState({
                    loadingMore: false,
                    ...(showPaginationError
                        ? { error: t("summary.common.loadingFailed") }
                        : {}),
                });
            }
        } finally {
            this.pendingReadPatches.delete(readPatches);
            this.isLoadingMore = false;
            if (this.isMounted_) this.setState({ loadingMore: false });
            this.flushActivationAfterCommit();
        }
    }

    private maybeStartBatchPoll() {
        const activeIds = this.state.items
      .filter(
        (item) =>
                item.status === TaskStatus.PENDING ||
                item.status === TaskStatus.WAITING_CONFIRM ||
                item.status === TaskStatus.PROCESSING
            )
      .map((item) => item.task_id);

        if (activeIds.length === 0) {
            this.stopBatchPoll();
            return;
        }

        this.stopBatchPoll();
        this.batchPollTimer = setInterval(() => {
            const currentActiveIds = this.state.items
        .filter(
          (item) =>
                    item.status === TaskStatus.PENDING ||
                    item.status === TaskStatus.WAITING_CONFIRM ||
                    item.status === TaskStatus.PROCESSING
                )
        .map((item) => item.task_id);
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
      window.dispatchEvent(
        new CustomEvent("summary-batch-heartbeat", { detail: { taskIds } })
      );
      const updateMap = new Map(updates.map((u) => [u.id, u]));
            let changed = false;
            const changedIds: number[] = [];
      const newItems = this.state.items.map((item) => {
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
        const hasTerminal = changedIds.some((id) => {
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
        window.dispatchEvent(
          new CustomEvent("summary-status-change", {
            detail: { taskIds: changedIds },
          })
        );
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
        // 埋点 292:状态筛选切换。
        // DAP-266：补 status（所选状态枚举值,标识非内容；空串=全部→'all'）。
        Dap.shared.track("smart_summary_status_filtered", { status: value === "" ? "all" : value });
        const statusFilter = value === "" ? undefined : (value as TaskStatusType);
        this.setState({ statusFilter, page: 1 }, () => this.loadData());
    };

    handleKeywordChange = (value: string) => {
        this.setState({ keyword: value });
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            // 埋点 291:去抖后「发生了一次搜索」，仅在有关键词时发，绝不采关键词值。
            // DAP-271 finding 6：has_result 需在 loadData 拿到结果后才知——移到结果返回后采集。
            //   只在本次搜索关键词非空、且 loadData 返回了有效结果总数(未被更新请求超越/未失败)时打点;
            //   loadData 返回 undefined(超越/卸载/失败)则不打点(与 mcp/skillmarket 同口径,失败不伪装零命中)。
            const searched = value.trim();
            this.setState({ page: 1 }, () => {
                void this.loadData().then((total) => {
                    if (searched && total !== undefined) {
                        Dap.shared.track("smart_summary_searched", {
                            has_result: total > 0,
                        });
                    }
                });
            });
        }, 400);
    };

    handleDelete = async (taskId: number) => {
        try {
            // DAP-271 finding 6：source 受控枚举 'list'（列表页删除入口）。
            await api.deleteSummary(taskId, "list");
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
      this.setState(
        { activeTaskId: next.task_id, items: fresh.items, total: fresh.total },
        () => {
                if (this.props.onViewDetail) {
                    this.props.onViewDetail(next.task_id);
                } else {
                    WKApp.routeRight.popToRoot();
            WKApp.routeRight.push(
              <SummaryDetailPage taskId={next.task_id} emitSelection />
            );
                }
        }
      );
        } else {
            this.setState({ items: [], total: 0, activeTaskId: null }, () => {
                this.openCapabilityGatedCreate();
            });
        }
    };

    handleCardClick = (taskId: number) => {
        this.setState({ activeTaskId: taskId });
        if (this.props.onViewDetail) {
            this.props.onViewDetail(taskId);
        } else {
            WKApp.routeRight.popToRoot();
      WKApp.routeRight.push(
        <SummaryDetailPage taskId={taskId} emitSelection />
      );
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
      Toast.success(
        action === "accept"
          ? t("summary.action.accepted")
          : t("summary.action.rejected")
      );
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleRetry = async (taskId: number) => {
        try {
      const task = this.state.items.find((i) => i.task_id === taskId);
            if (task?.trigger_type === TriggerType.AGENT) {
                requestSummaryDetailAction(taskId, WKApp.shared?.currentSpaceId || "", "retry");
                this.handleCardClick(taskId);
                return;
            }
            // DAP-271 finding 6：prev_status 就近取自已查到的 task.status（重生成前状态）。
            await api.regenerateSummary(taskId, undefined, task?.status);
            Toast.success(t("summary.list.retrySuccess"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleCancel = async (taskId: number) => {
        try {
            // DAP-271 finding 6：source 受控枚举 'list'（列表页取消入口）。
            await api.cancelSummary(taskId, "list");
            Toast.success(t("summary.list.cancelSuccess"));
            this.loadData();
        } catch (err: any) {
            Toast.error(err.message || t("summary.common.operationFailed"));
        }
    };

    handleRegenerate = (taskId: number) => {
        requestSummaryDetailAction(taskId, WKApp.shared?.currentSpaceId || "", "regenerate");
        this.handleCardClick(taskId);
    };

    handleContinueOptimize = (taskId: number) => {
        const task = this.state.items.find(item => item.task_id === taskId);
        if (!task) return;
        if (this.props.onContinueOptimize) {
            this.props.onContinueOptimize(task);
            return;
        }
        window.dispatchEvent(
            new CustomEvent("summary-open-chat-with-reference", { detail: task })
        );
    };

    handleEdit = (taskId: number) => {
        requestSummaryDetailAction(taskId, WKApp.shared?.currentSpaceId || "", "edit");
        this.handleCardClick(taskId);
    };

    handleSchedule = (taskId: number) => {
        requestSummaryScheduleOpen(taskId, WKApp.shared?.currentSpaceId || "");
        this.handleCardClick(taskId);
    };

    handleCreate = (mode: "normal" | "agent" = "normal") => {
        // 「新建总结」意图:三处 create 控件都走这里(原先误用 GET /summary-templates 页面加载推断)。
        Dap.shared.track("smart_summary_create_clicked", {});
        // 从「+」下拉显式选择 Agent 总结属于一次模式选择行为：创建页内切换已随本功能
        // 上移到列表页「+」，补发模式事件以保留 smart_summary_mode_switched 埋点维度。
        if (mode === "agent") {
            // DAP-266：spec 键为 mode（此前误用 to）；对齐 result doc spec_props。
            Dap.shared.track("smart_summary_mode_switched", { mode: "agent" });
        }
        if (this.props.onCreateNew) {
            // 面板模式：把所选模式透传给宿主（ChatSummaryPanel）供其 create 视图预置 initialMode。
            this.props.onCreateNew(mode);
            return;
        }
        WKApp.routeRight.popToRoot();
        WKApp.routeRight.push(
            <SummaryCreatePage
                // key 绑定「模式 + 每次新建序号」：从列表页选模式 = 发起一次全新创建。
                // 只按模式做 key 时，连续两次选同模式（如 NavRail 默认创建页上再点
                // 「+ → 快速总结」）会命中 React 复用分支——WKViewQueue 按数组下标渲染，
                // 同类型同 key 组件不重挂载，state 不随新 initialMode 重读，界面无反馈。
                key={`${mode}-${++this.createEntrySeq}`}
                source="summary_list"
                initialMode={mode}
            />
        );
    };

    private openCapabilityGatedCreate = () => {
        if (this.props.onCreateNew) {
            this.props.onCreateNew("unified");
            return;
        }
        WKApp.routeRight.popToRoot();
        WKApp.routeRight.push(
            <SummaryWorkbenchCreateEntry
                key={`unified-${++this.createEntrySeq}`}
                source="summary_list"
            />
        );
    };

    handleUnifiedCreate = () => {
        Dap.shared.track("smart_summary_create_clicked", {});
        this.openCapabilityGatedCreate();
    };

    render() {
        const spaceId = String(WKApp.shared.currentSpaceId ?? "").trim();
        return (
            <SummaryWorkbenchEntry
                spaceId={spaceId}
                renderPending={() => this.renderList("pending")}
                renderNew={() => this.renderList("unified")}
                renderLegacy={() => this.renderList("legacy")}
            />
        );
    }

    private renderList(createEntryMode: SummaryCreateEntryMode) {
        const { items, total, pageSize, loading, loadingMore, hasMore, error, statusFilter, keyword, activeTaskId } = this.state;
        const { channelId, onClose } = this.props;
        const { locale, t: translate } = this.context;
        const statusOptions = getStatusOptions();
    const isPanel = Boolean(channelId) || this.props.embedded === true;

        return (
      <div
        data-testid={summaryTestIds.list}
        className={`summary-list-page${
          isPanel ? " summary-list-page--panel" : ""
        }`}
      >
                <div className="summary-list-header" data-desktop-chrome="header">
                    <h2 className="summary-list-title">
            {isPanel
              ? translate("summary.chatSummary.panelTitle")
              : translate("summary.list.title")}
                    </h2>
                    <div className="summary-list-header-actions">
                        {createEntryMode === "legacy" ? (
                            /* Legacy 保留原模式下拉；定时更新统一在总结详情页配置。 */
                            <Dropdown
                                trigger="click"
                                position="bottomRight"
                                render={(
                                    <Dropdown.Menu>
                                        <Dropdown.Item
                                            data-testid={summaryTestIds.listNormalTab}
                                            onClick={() => this.handleCreate("normal")}
                                        >
                                            {translate("summary.create.start")}
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            data-testid={summaryTestIds.listAgentTab}
                                            onClick={() => this.handleCreate("agent")}
                                        >
                                            {translate("summary.create.agentStart")}
                                        </Dropdown.Item>
                                    </Dropdown.Menu>
                                )}
                            >
                                <Button
                                    data-testid={summaryTestIds.listModeSwitch}
                                    className="summary-list-create-icon-btn"
                                    icon={<IconPlus />}
                                    theme="borderless"
                                    aria-label={translate("summary.list.createTooltip")}
                                    title={translate("summary.list.createTooltip")}
                                />
                            </Dropdown>
                        ) : (
                            <Button
                                data-testid={summaryTestIds.listModeSwitch}
                                className="summary-list-create-icon-btn"
                                icon={<IconPlus />}
                                theme="borderless"
                                disabled={createEntryMode === "pending"}
                                onClick={createEntryMode === "unified" ? this.handleUnifiedCreate : undefined}
                                aria-label={translate("summary.list.createTooltip")}
                                title={translate("summary.list.createTooltip")}
                            />
                        )}
                        {isPanel && onClose && (
                            <Button
                                icon={<X size={18} />}
                                theme="borderless"
                                type="tertiary"
                                onClick={onClose}
                            />
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
            <div
              data-testid={summaryTestIds.listStatusFilter}
              className="summary-list-status-trigger"
            >
              <span>
                {statusOptions.find((o) => o.value === (statusFilter ?? ""))
                  ?.label ?? statusOptions[0]?.label}
              </span>
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
              <Button size="small" onClick={() => this.loadData()}>
                {translate("summary.common.retry")}
              </Button>
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
                                <Button
                                    data-testid={summaryTestIds.createEntry}
                                    theme="solid"
                                    disabled={createEntryMode === "pending"}
                                    onClick={createEntryMode === "unified"
                                        ? this.handleUnifiedCreate
                                        : createEntryMode === "legacy"
                                        ? () => this.handleCreate("normal")
                                        : undefined}
                                    style={{ marginTop: 16 }}
                                >
                                    {translate("summary.chatSummary.createNew")}
                                </Button>
                            </>
                        ) : (
                            <>
                                <div className="summary-list-empty-icon">📄</div>
                <div className="summary-list-empty-title">
                  {translate("summary.list.emptyTitle")}
                </div>
                                <div className="summary-list-empty-desc">
                                    {translate("summary.list.emptyDesc")}
                                </div>
                                <Button
                                    data-testid={summaryTestIds.createEntry}
                                    theme="solid"
                                    disabled={createEntryMode === "pending"}
                                    onClick={createEntryMode === "unified"
                                        ? this.handleUnifiedCreate
                                        : createEntryMode === "legacy"
                                        ? () => this.handleCreate("normal")
                                        : undefined}
                                    style={{ marginTop: 16 }}
                                >
                                    {translate("summary.list.createFirst")}
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {!loading && items.length > 0 && (
          <div
            data-testid={summaryTestIds.listContent}
            className="summary-list-content"
            onScroll={this.handleScroll}
          >
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
                                onContinueOptimize={this.handleContinueOptimize}
                                onEdit={this.handleEdit}
                                onSchedule={this.handleSchedule}
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
