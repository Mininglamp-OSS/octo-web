import React, { Component } from 'react';
import { WKApp, I18nContext } from '@octo/base';
import {
    SUMMARY_DEFAULT_WIDTH,
    clampSummaryWidth,
    restoreSummaryWidth,
    persistSummaryWidth,
} from '@octo/base/src/Components/WKLayout/layoutWidth';
import { X, ChevronLeft } from 'lucide-react';
import ChatSummaryHistory from './ChatSummaryHistory';
import SummaryDetailPage from '../pages/SummaryDetailPage';

interface ChatSummaryPanelProps {
    visible: boolean;
    channel: { channelID: string; channelType: number };
    onClose: () => void;
}

interface ChatSummaryPanelState {
    view: 'list' | 'detail';
    selectedTaskId: number | null;
    isDragging: boolean;
}

export default class ChatSummaryPanel extends Component<
    ChatSummaryPanelProps,
    ChatSummaryPanelState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private rootRef = React.createRef<HTMLDivElement>();
    private dragStartX = 0;
    private dragStartWidth = 0;
    private lastPanelWidth = clampSummaryWidth(restoreSummaryWidth(), window.innerWidth);

    constructor(props: ChatSummaryPanelProps) {
        super(props);
        this.state = { view: 'list', selectedTaskId: null, isDragging: false };
    }

    componentDidMount() {
        // 还原持久化宽度：写容器 width + 祖先 CSS 变量（挤压聊天区）
        this.applyWidth(this.lastPanelWidth);
    }

    componentWillUnmount() {
        // 兜底解绑，避免拖动中卸载导致的内存泄漏
        document.removeEventListener('mousemove', this.onDragMove);
        document.removeEventListener('mouseup', this.onDragEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    componentDidUpdate(prevProps: ChatSummaryPanelProps) {
        const prev = prevProps.channel;
        const next = this.props.channel;
        if (
            prev.channelID !== next.channelID ||
            prev.channelType !== next.channelType
        ) {
            // 切换会话时回到列表视图，避免残留上个会话的详情
            this.setState({ view: 'list', selectedTaskId: null });
        }
    }

    // ── Splitter drag ──
    private applyWidth(width: number) {
        const root = this.rootRef.current;
        if (!root) return;
        const panel = root.closest('.wk-summary-panel') as HTMLElement | null;
        if (panel) {
            panel.style.width = width + 'px';
        }
        // CSS 变量要设在祖先 .wk-chat-content-right 上，兄弟节点
        // .wk-chat-content-chat 才能 var() 拿到，触发宽度挤压
        const ancestor = root.closest('.wk-chat-content-right') as HTMLElement | null;
        if (ancestor) {
            ancestor.style.setProperty('--wk-width-summary-panel', width + 'px');
        }
    }

    private onDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        this.dragStartX = e.clientX;
        this.dragStartWidth = this.lastPanelWidth;
        this.setState({ isDragging: true });
        document.addEventListener('mousemove', this.onDragMove);
        document.addEventListener('mouseup', this.onDragEnd);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    private onDragMove = (e: MouseEvent) => {
        // 面板在右侧，左边缘拖动：向左拖（clientX 变小）应变宽
        const delta = this.dragStartX - e.clientX;
        const newWidth = clampSummaryWidth(this.dragStartWidth + delta, window.innerWidth);
        this.lastPanelWidth = newWidth;
        // 直接改 style / CSS 变量，不走 setState，避免拖动卡顿
        this.applyWidth(newWidth);
    };

    private onDragEnd = () => {
        document.removeEventListener('mousemove', this.onDragMove);
        document.removeEventListener('mouseup', this.onDragEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this.setState({ isDragging: false });
        persistSummaryWidth(this.lastPanelWidth);
    };

    private handleResetWidth = () => {
        this.lastPanelWidth = SUMMARY_DEFAULT_WIDTH;
        this.applyWidth(SUMMARY_DEFAULT_WIDTH);
        persistSummaryWidth(SUMMARY_DEFAULT_WIDTH);
    };

    private handleCreateNew = () => {
        const { channel } = this.props;
        WKApp.mittBus.emit('wk:open-summary-modal', {
            channelId: channel.channelID,
            channelType: channel.channelType,
        });
    };

    private handleViewDetail = (taskId: number) => {
        this.setState({ view: 'detail', selectedTaskId: taskId });
    };

    private handleBack = () => {
        this.setState({ view: 'list' });
    };

    render() {
        const { channel, onClose } = this.props;
        const { view, selectedTaskId, isDragging } = this.state;
        const { t } = this.context;
        const isDetail = view === 'detail' && selectedTaskId != null;

        return (
            <div ref={this.rootRef} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* 左边缘分隔条：拖动调宽，双击重置默认宽度（复用 thread 面板样式） */}
                <div
                    className={`wk-thread-panel-splitter${isDragging ? ' wk-thread-panel-splitter-active' : ''}`}
                    onMouseDown={this.onDragStart}
                    onDoubleClick={this.handleResetWidth}
                >
                    <div className="wk-thread-panel-splitter-line" />
                </div>

                {/* 列表视图：常驻挂载，详情时隐藏以保留滚动位置 */}
                <div
                    style={{
                        display: isDetail ? 'none' : 'flex',
                        flex: 1,
                        minHeight: 0,
                        flexDirection: 'column',
                    }}
                >
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        padding: '8px 8px 0',
                    }}>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 4,
                                color: 'var(--wk-text-secondary, #646A73)',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <ChatSummaryHistory
                        channel={channel}
                        onCreateNew={this.handleCreateNew}
                        onViewDetail={this.handleViewDetail}
                        paused={isDetail}
                    />
                </div>

                {/* 详情视图：复用整页 SummaryDetailPage，外层加面板级返回栏 */}
                {isDetail && (
                    <div className="wk-summary-panel-detail">
                        <div className="wk-summary-panel-detail-back">
                            <button
                                type="button"
                                className="wk-summary-panel-detail-back-btn"
                                onClick={this.handleBack}
                            >
                                <ChevronLeft size={18} />
                                <span>{t('summary.chatSummary.back')}</span>
                            </button>
                        </div>
                        <div className="wk-summary-panel-detail-body">
                            <SummaryDetailPage taskId={selectedTaskId} />
                        </div>
                    </div>
                )}

                {/* 拖动遮罩：避免内部内容/选区抢鼠标 */}
                {isDragging && <div className="wk-thread-panel-drag-overlay" />}
            </div>
        );
    }
}
