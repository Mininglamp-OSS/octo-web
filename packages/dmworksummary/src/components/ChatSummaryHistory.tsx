import React, { Component } from 'react';
import axios from 'axios';
import { Toast } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import * as summaryApi from '../api/summaryApi';
import type { SummaryListItem } from '../types/summary';
import { TaskStatus } from '../types/summary';
import SummaryCard from './SummaryCard';

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

export default class ChatSummaryHistory extends Component<
    ChatSummaryHistoryProps,
    ChatSummaryHistoryState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private abortController: AbortController | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private isPolling = false;
    /**
     * Fix #334: Track whether SummaryListPage is actively polling the same task IDs.
     * When the main summary list is running batch-status polls, the sidebar skips
     * its own redundant polling and relies on summary-status-change events instead.
     * Reset when SummaryListPage unmounts (summary-list-unmount event) so sidebar
     * resumes polling when the main list is no longer active.
     */
    private listPageActive_ = false;

    constructor(props: ChatSummaryHistoryProps) {
        super(props);
        this.state = { items: [], loading: true };
    }

    componentDidMount() {
        void this.loadHistory();
        window.addEventListener('chat-summary-created', this.handleChange as EventListener);
        window.addEventListener('chat-summary-deleted', this.handleChange as EventListener);
        // Fix #334: Coordinate with SummaryListPage polling to avoid duplicate batch-status calls.
        window.addEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat_ as EventListener);
        window.addEventListener('summary-status-change', this.handleStatusChange_ as EventListener);
        window.addEventListener('summary-list-unmount', this.handleListPageUnmount_ as EventListener);
    }

    componentWillUnmount() {
        this.abortController?.abort();
        this.stopPoll();
        window.removeEventListener('chat-summary-created', this.handleChange as EventListener);
        window.removeEventListener('chat-summary-deleted', this.handleChange as EventListener);
        window.removeEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat_ as EventListener);
        window.removeEventListener('summary-status-change', this.handleStatusChange_ as EventListener);
        window.removeEventListener('summary-list-unmount', this.handleListPageUnmount_ as EventListener);
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
        // Fix #334: Don't start polling when SummaryListPage is actively doing it.
        // The list page dispatches summary-list-unmount on cleanup, which resets
        // listPageActive_ so polling can resume.
        if (this.listPageActive_) return;
        this.pollTimer = setInterval(() => {
            const ids = this.getActiveTaskIds();
            if (ids.length === 0) {
                this.stopPoll();
                return;
            }
            // Fix #334: Skip this tick if list page is still active.
            if (this.listPageActive_) return;
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

    /**
     * Fix #334: When SummaryListPage sends a heartbeat for task IDs we're also tracking,
     * suppress our own redundant polling. We receive status updates via
     * summary-status-change events dispatched by the list page instead.
     */
    private handleBatchHeartbeat_ = (e: Event) => {
        const taskIds: number[] | undefined = (e as CustomEvent).detail?.taskIds;
        if (!taskIds) return;
        const myIds = this.getActiveTaskIds();
        const overlap = taskIds.some(id => myIds.includes(id));
        if (!overlap) return;
        this.listPageActive_ = true;
        this.stopPoll();
    };

    /**
     * Fix #334: When SummaryListPage unmounts (user navigates away from main summary
     * tab), reset the active flag and resume polling if we have active tasks.
     */
    private handleListPageUnmount_ = () => {
        this.listPageActive_ = false;
        this.maybeStartPoll();
    };

    /**
     * Fix #334: When SummaryListPage detects a status change for tasks we're tracking,
     * reload our history to reflect the updated statuses without making our own
     * batch-status API call.
     */
    private handleStatusChange_ = (e: Event) => {
        const taskIds: number[] | undefined = (e as CustomEvent).detail?.taskIds;
        if (!taskIds) return;
        const myIds = this.state.items.map(item => item.task_id);
        const overlap = taskIds.some(id => myIds.includes(id));
        if (!overlap) return;
        void this.loadHistory();
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
