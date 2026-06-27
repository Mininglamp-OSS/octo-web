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
    // GH #334: heartbeat coordination with SummaryListPage.
    // When the main summary list is already polling the same taskIds,
    // suppress this sidebar poll to avoid duplicate batch-status requests.
    private lastHeartbeatAt = 0;
    private heartbeatTaskIds: Set<number> = new Set();

    constructor(props: ChatSummaryHistoryProps) {
        super(props);
        this.state = { items: [], loading: true };
    }

    componentDidMount() {
        void this.loadHistory();
        window.addEventListener('chat-summary-created', this.handleChange as EventListener);
        window.addEventListener('chat-summary-deleted', this.handleChange as EventListener);
        window.addEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat);
    }

    componentWillUnmount() {
        this.abortController?.abort();
        this.stopPoll();
        window.removeEventListener('chat-summary-created', this.handleChange as EventListener);
        window.removeEventListener('chat-summary-deleted', this.handleChange as EventListener);
        window.removeEventListener('summary-batch-heartbeat', this.handleBatchHeartbeat);
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
        // GH #334: skip poll when another poller (SummaryListPage) already covers
        // the same taskIds via the heartbeat protocol. Heartbeat expires after 15s
        // of silence — if the main list unmounts or stops polling, sidebar resumes.
        if (
            this.heartbeatTaskIds.size > 0 &&
            taskIds.some(id => this.heartbeatTaskIds.has(id)) &&
            Date.now() - this.lastHeartbeatAt < 15000
        ) {
            return;
        }
        this.isPolling = true;
        try {
            const updates = await summaryApi.batchStatus(taskIds);
            // GH #334: emit heartbeat so SummaryDetailPage can suppress its
            // fallback poll when the sidebar is actively covering these taskIds.
            window.dispatchEvent(new CustomEvent('summary-batch-heartbeat', { detail: { taskIds } }));
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

    // GH #334: heartbeat listener — SummaryListPage emits this after each of its
    // polls. Record the covered taskIds + timestamp so doPoll can dedup.
    private handleBatchHeartbeat = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (!detail?.taskIds) return;
        this.heartbeatTaskIds = new Set(detail.taskIds as number[]);
        this.lastHeartbeatAt = Date.now();
    };

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
