import React, { Component } from 'react';
import axios from 'axios';
import { Toast } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import * as summaryApi from '../api/summaryApi';
import type { SummaryListItem } from '../types/summary';
import { TaskStatus } from '../types/summary';
import SummaryCard from './SummaryCard';
import { containsAllTaskIds } from '../utils/heartbeatCoverage';

interface ChatSummaryHistoryProps {
    channel: { channelID: string; channelType: number };
    onCreateNew: () => void;
    onViewDetail: (taskId: number) => void;
    paused?: boolean;
}

interface ChatSummaryHistoryState {
    items: SummaryListItem[];
    loading: boolean;
}

// Mirrors SummaryDetailPage's 15s grace window so a heartbeat from any peer
// (SummaryListPage or another ChatSummaryHistory instance) suppresses our
// 5s tick for one window. After 15s of silence we treat the peer as gone
// and resume self-polling on the next tick.
const COVERING_HEARTBEAT_WINDOW_MS = 15_000;

export default class ChatSummaryHistory extends Component<
    ChatSummaryHistoryProps,
    ChatSummaryHistoryState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private abortController: AbortController | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private isPolling = false;
    // #334: bring this component into the summary-batch-heartbeat protocol.
    private peerActive = false;
    private lastCoveringEventTime = 0;
    // Set true for the duration of one synchronous window.dispatchEvent call
    // when WE are the dispatcher, so our own listener can ignore the echo.
    private isDispatchingOwnHeartbeat = false;

    constructor(props: ChatSummaryHistoryProps) {
        super(props);
        this.state = { items: [], loading: true };
    }

    componentDidMount() {
        void this.loadHistory();
        window.addEventListener('chat-summary-created', this.handleChange as EventListener);
        window.addEventListener('chat-summary-deleted', this.handleChange as EventListener);
        window.addEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat as EventListener);
        window.addEventListener('summary-status-change', this.handleStatusChangeEvent as EventListener);
        window.addEventListener('summary-list-unmount', this.handleListUnmount as EventListener);
    }

    componentWillUnmount() {
        this.abortController?.abort();
        this.stopPoll();
        window.removeEventListener('chat-summary-created', this.handleChange as EventListener);
        window.removeEventListener('chat-summary-deleted', this.handleChange as EventListener);
        window.removeEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat as EventListener);
        window.removeEventListener('summary-status-change', this.handleStatusChangeEvent as EventListener);
        window.removeEventListener('summary-list-unmount', this.handleListUnmount as EventListener);
    }

    componentDidUpdate(prevProps: ChatSummaryHistoryProps) {
        if (prevProps.paused !== this.props.paused) {
            if (this.props.paused) {
                // 详情打开时暂停列表轮询，避免对同一任务重复请求状态
                this.stopPoll();
            } else {
                // 返回列表后刷新一次以同步详情期间的状态变化，并恢复轮询
                void this.loadHistory();
            }
        }
    }

    private getActiveTaskIds(): number[] {
        return this.state.items
            .filter(item =>
                item.status === TaskStatus.PENDING ||
                item.status === TaskStatus.WAITING_CONFIRM ||
                item.status === TaskStatus.PROCESSING
            )
            .map(item => item.task_id);
    }

    private maybeStartPoll() {
        this.stopPoll();
        if (this.props.paused) return;
        if (this.getActiveTaskIds().length === 0) return;
        this.pollTimer = setInterval(() => {
            const ids = this.getActiveTaskIds();
            if (ids.length === 0) {
                this.stopPoll();
                return;
            }
            // #334: a peer's heartbeat covered our active set within the
            // freshness window — skip this tick, do NOT stop the timer.
            if (
                this.peerActive &&
                Date.now() - this.lastCoveringEventTime <= COVERING_HEARTBEAT_WINDOW_MS
            ) {
                return;
            }
            void this.doPoll(ids);
        }, 5000);
    }

    private stopPoll() {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private async doPoll(taskIds: number[]) {
        if (this.isPolling) return;
        this.isPolling = true;
        try {
            const updates = await summaryApi.batchStatus(taskIds);
            // #334: let peers (SummaryListPage / SummaryDetailPage fallback /
            // another ChatSummaryHistory instance) skip their next own tick.
            // Self-echo guard: window.dispatchEvent is synchronous; the flag
            // suppresses our own handleBatchHeartbeat on the re-entry stack.
            this.isDispatchingOwnHeartbeat = true;
            try {
                window.dispatchEvent(
                    new CustomEvent('summary-batch-heartbeat', { detail: { taskIds } }),
                );
            } finally {
                this.isDispatchingOwnHeartbeat = false;
            }
            const updateMap = new Map(updates.map(u => [u.id, u]));
            let changed = false;
            const newItems = this.state.items.map(item => {
                const update = updateMap.get(item.task_id);
                if (update && update.status !== item.status) {
                    changed = true;
                    return { ...item, status: update.status };
                }
                return item;
            });
            if (changed) {
                this.setState({ items: newItems }, () => this.maybeStartPoll());
            }
        } catch {
            // ignore
        } finally {
            this.isPolling = false;
        }
    }

    private handleChange = (e: CustomEvent<{ channelId: string }>) => {
        if (e.detail?.channelId === this.props.channel.channelID) {
            void this.loadHistory();
        }
    };

    // #334: a covering heartbeat from a peer means we can skip our next own
    // poll tick. We do NOT stop the timer — the tick callback consults the
    // flag + freshness window and self-skips. See containsAllTaskIds for the
    // exact subset semantics.
    //
    // Self-echo guard: window.dispatchEvent is synchronous, so our own
    // dispatch in doPoll re-enters this listener on the same call stack.
    // Without the guard we would set peerActive=true from our own heartbeat
    // and starve our own next tick → 5s cadence would silently degrade to
    // ~15s when we are the sole poller. The isDispatchingOwnHeartbeat flag
    // is set true in doPoll right before dispatch and cleared immediately
    // after; we ignore any event observed while it is true.
    private handleBatchHeartbeat = (event: Event) => {
        if (this.isDispatchingOwnHeartbeat) return;
        const taskIds: number[] | undefined = (event as CustomEvent).detail?.taskIds;
        if (!containsAllTaskIds(taskIds, this.getActiveTaskIds())) return;
        this.peerActive = true;
        this.lastCoveringEventTime = Date.now();
    };

    // #334: a peer surfaced a status flip for at least one of our visible
    // items — refresh from server so the UI shows the new status without
    // waiting for our own 5s tick. Ignored when the flip is for unrelated
    // tasks (different channel / different page in SummaryListPage).
    //
    // Name choice: `handleStatusChangeEvent` mirrors SummaryDetailPage's
    // identically-named handler (DetailPage:303) and avoids confusion with
    // SummaryListPage's `handleStatusChange` (a filter-dropdown callback on
    // a different class — unrelated despite the bare name).
    private handleStatusChangeEvent = (event: Event) => {
        // #334: panel is hidden in detail view — even if a peer's status flip
        // is for one of our items, the user can't see this list right now.
        // maybeStartPoll already short-circuits on paused; mirror that here
        // so we don't waste a network round-trip + setState while invisible.
        if (this.props.paused) return;
        const taskIds: number[] | undefined = (event as CustomEvent).detail?.taskIds;
        if (!taskIds || taskIds.length === 0) return;
        const mine = new Set(this.state.items.map(item => item.task_id));
        const intersects = taskIds.some(id => mine.has(id));
        if (!intersects) return;
        void this.loadHistory();
    };

    // #334: a peer left the heartbeat protocol (e.g. SummaryListPage
    // unmounted). Clear suppression so the next 5s tick polls — we may
    // now be the only poller covering our active-task set.
    private handleListUnmount = () => {
        this.peerActive = false;
    };

    private async loadHistory() {
        this.abortController?.abort();
        const controller = new AbortController();
        this.abortController = controller;

        try {
            const res = await summaryApi.listSummaries(
                {
                    origin_channel_id: this.props.channel.channelID,
                    page: 1,
                    page_size: 50,
                    sort_by: 'created_at',
                    sort_order: 'desc',
                },
                { signal: controller.signal },
            );
            if (!controller.signal.aborted) {
                this.setState({ items: res.items || [], loading: false }, () => this.maybeStartPoll());
            }
        } catch (err: unknown) {
            if (!axios.isCancel(err)) {
                this.setState({ loading: false });
            }
        }
    }

    private handleDelete = async (taskId: number) => {
        try {
            await summaryApi.deleteSummary(taskId);
            // Reuse the existing event mechanism so this list refreshes itself.
            window.dispatchEvent(new CustomEvent('chat-summary-deleted', {
                detail: { channelId: this.props.channel.channelID },
            }));
        } catch {
            // Surface the failure; the item stays in the list if deletion fails.
            Toast.error(this.context.t('summary.common.deleteFailed'));
        }
    };

    render() {
        const { onCreateNew, onViewDetail } = this.props;
        const { items, loading } = this.state;
        const { t } = this.context;

        return (
            <div className="chat-summary-history" style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--wk-text-primary, #1C1F23)' }}>
                    {t('summary.chatSummary.panelTitle')}
                </div>

                <div
                    onClick={onCreateNew}
                    style={{
                        padding: '14px',
                        border: '1px dashed var(--wk-border-default, #E5E6EB)',
                        borderRadius: 8,
                        textAlign: 'center',
                        cursor: 'pointer',
                        marginBottom: 12,
                        color: 'var(--wk-text-secondary, #646A73)',
                        fontSize: 14,
                        transition: 'border-color 0.15s, background-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderStyle = 'solid';
                        e.currentTarget.style.backgroundColor = '#F0F7FF';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderStyle = 'dashed';
                        e.currentTarget.style.backgroundColor = '';
                    }}
                >
                    + {t('summary.chatSummary.createNew')}
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', color: 'var(--wk-text-tertiary, #8F959E)', paddingTop: 40 }}>
                        {t('summary.common.loading')}
                    </div>
                ) : items.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--wk-text-tertiary, #8F959E)', paddingTop: 40 }}>
                        {t('summary.list.emptyTitle')}
                    </div>
                ) : (
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {items.map((item) => (
                            <SummaryCard
                                key={item.task_id}
                                task={item}
                                onClick={onViewDetail}
                                onDelete={this.handleDelete}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
}
