import React, { Component } from 'react';
import { WKApp, I18nContext } from '@octo/base';
import {
    SUMMARY_DEFAULT_WIDTH,
    clampSummaryWidth,
    restoreSummaryWidth,
    persistSummaryWidth,
} from '@octo/base/src/Components/WKLayout/layoutWidth';
import { X, ChevronLeft } from 'lucide-react';
import SummaryListPage from '../pages/SummaryListPage';
import SummaryCreatePage from '../pages/SummaryCreatePage';
import SummaryDetailPage from '../pages/SummaryDetailPage';

interface ChatSummaryPanelProps {
    visible: boolean;
    channel: { channelID: string; channelType: number };
    onClose: () => void;
    /** Initial view: 'history' shows the list, 'new' shows the create form. */
    summaryPanelView?: 'history' | 'new';
}

interface ChatSummaryPanelState {
    view: 'list' | 'detail' | 'create';
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
        const initialView = props.summaryPanelView === 'new' ? 'create' : 'list';
        this.state = { view: initialView, selectedTaskId: null, isDragging: false };
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
            prev.channelType !== next.channelType ||
            prevProps.summaryPanelView !== this.props.summaryPanelView
        ) {
            // 切换会话或面板视图请求变化时，重置到对应初始视图
            const initialView = this.props.summaryPanelView === 'new' ? 'create' : 'list';
            this.setState({ view: initialView, selectedTaskId: null });
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
        this.setState({ view: 'create', selectedTaskId: null });
    };

    private handleViewDetail = (taskId: number) => {
        this.setState({ view: 'detail', selectedTaskId: taskId });
    };

    private handleBack = () => {
        this.setState({ view: 'list' });
    };

    private handleBackToList = () => {
        this.setState({ view: 'list' });
    };

    private handleCreateSubmit = (taskId: number) => {
        this.setState({ view: 'list' });
        setTimeout(() => {
            WKApp.mittBus.emit("summary-list-refresh-requested" as any);
        }, 800);
    };

    render() {
        const { channel, onClose } = this.props;
        const { view, selectedTaskId, isDragging } = this.state;
        const { t } = this.context;
        const isDetail = view === 'detail' && selectedTaskId != null;
        const isCreate = view === 'create';

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

                {/* 列表视图：复用 SummaryListPage（传 channelId 过滤当前聊天） */}
                <div
                    style={{
                        display: isDetail || isCreate ? 'none' : 'flex',
                        flex: 1,
                        minHeight: 0,
                        flexDirection: 'column',
                    }}
                >
                    <SummaryListPage
                        channelId={channel.channelID}
                        onClose={onClose}
                        onCreateNew={this.handleCreateNew}
                        onViewDetail={this.handleViewDetail}
                    />
                </div>

                {/* 创建视图：返回按钮 + 内嵌创建表单（复用 SummaryCreatePage embedded） */}
                {isCreate && (
                    <div className="wk-summary-panel-detail">
                        <div className="wk-summary-panel-detail-back">
                            <button
                                type="button"
                                className="wk-summary-panel-detail-back-btn"
                                onClick={this.handleBackToList}
                            >
                                <ChevronLeft size={18} />
                                <span>{t('summary.chatSummary.back')}</span>
                            </button>
                        </div>
                        <div className="wk-summary-panel-detail-body" style={{ overflow: 'auto', flex: 1 }}>
                            <SummaryCreatePage
                                channel={channel}
                                embedded={true}
                                onClose={this.handleBackToList}
                                onSubmit={this.handleCreateSubmit}
                            />
                        </div>
                    </div>
                )}

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
                            <SummaryDetailPage taskId={selectedTaskId} onAfterMutate={() => this.setState({ view: 'list', selectedTaskId: null })} />
                        </div>
                    </div>
                )}

                {/* 拖动遮罩：避免内部内容/选区抢鼠标 */}
                {isDragging && <div className="wk-thread-panel-drag-overlay" />}
            </div>
        );
    }
}
