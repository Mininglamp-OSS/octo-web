import React, { useState } from "react";
import { Dropdown, Modal } from "@douyinfe/semi-ui";
import { MoreHorizontal, AlertTriangle, X } from "lucide-react";
import { useI18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
import type { SummaryListItem } from "../types/summary";
import { ParticipantStatus, TaskStatus } from "../types/summary";
import { getStatusLabel } from "../utils/summaryHelpers";
import { deriveSummaryDisplayContent } from "../utils/templateResolver";

interface SummaryCardProps {
    task: SummaryListItem;
    active?: boolean;
    onClick: (taskId: number) => void;
    onDelete: (taskId: number) => void;
    onRespond?: (taskId: number, action: "accept" | "reject") => void;
    onLeave?: (taskId: number) => void;
    onRetry?: (taskId: number) => void;
    onRegenerate?: (taskId: number) => void;
    onEdit?: (taskId: number) => void;
    onCancel?: (taskId: number) => void;
}

/** 相对时间格式化 */
function formatRelativeTime(dateStr: string, t: (key: string, opts?: any) => string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return t("summary.summaryCard.justNow");
    if (diff < 3600) return t("summary.summaryCard.minutesAgo", { values: { count: Math.floor(diff / 60) } });
    if (diff < 86400) return t("summary.summaryCard.hoursAgo", { values: { count: Math.floor(diff / 3600) } });
    return t("summary.summaryCard.daysAgo", { values: { count: Math.floor(diff / 86400) } });
}

/** 从 sources 派生源信息文本 */
function getSourceInfo(task: SummaryListItem, t: (key: string, opts?: any) => string): string | null {
    const sources = task.sources;
    if (!sources || sources.length === 0) return null;
    const firstName = sources[0].source_name || sources[0].source_id;
    if (sources.length === 1) {
        return t("summary.summaryCard.sourceFrom", { values: { name: firstName } });
    }
    return t("summary.summaryCard.sourceFromMultiple", { values: { name: firstName, count: sources.length } });
}

/** 状态文字颜色 */
function getStatusColor(status: number): string | null {
    switch (status) {
        case TaskStatus.PENDING:
        case TaskStatus.WAITING_CONFIRM:
            return "#FF8800";
        case TaskStatus.PROCESSING:
            return "#FF8800";
        case TaskStatus.FAILED:
            return "#F65E58";
        case TaskStatus.CANCELLED:
            return "rgba(28, 28, 35, 0.4)";
        default:
            return null; // COMPLETED 不显示状态文字
    }
}

const SummaryCard: React.FC<SummaryCardProps> = ({ task, active, onClick, onDelete, onRespond, onLeave, onRetry, onRegenerate, onEdit, onCancel }) => {
    const { t } = useI18n();
    const [confirmType, setConfirmType] = useState<'delete' | 'leave' | null>(null);
    const [menuVisible, setMenuVisible] = useState(false);
    const currentUid = WKApp.loginInfo.uid;
    const myParticipant = task.participants?.find((p) => p.user_id === currentUid);
    const isMultiParticipant = (task.participants?.length ?? 0) > 1;
    const isPendingInvite = isMultiParticipant && myParticipant != null && myParticipant.status === ParticipantStatus.PENDING;
    const displaysWaiting = task.has_pending_invitation === true
        || (isMultiParticipant && task.has_pending_submission === true)
        || isPendingInvite;

    const displayTitle = deriveSummaryDisplayContent(task.topic || task.title || task.task_no);
    const displayStatus = displaysWaiting ? TaskStatus.PENDING : task.status;
    const statusColor = getStatusColor(displayStatus);
    const statusText = displayStatus !== TaskStatus.COMPLETED ? getStatusLabel(displayStatus) : null;

    const isGenerating = task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING;
    const sourceInfo = getSourceInfo(task, t);
    const relativeTime = formatRelativeTime(task.created_at, t);
    const isCreator = task.creator_id != null && task.creator_id === currentUid;
    const isParticipant = myParticipant != null;

    const timeText = isCreator
        ? t("summary.summaryCard.youStartedAt", { values: { time: relativeTime } })
        : t("summary.summaryCard.startedAt", { values: { name: task.creator_name || t("summary.common.unknown"), time: relativeTime } });

    

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmType('delete');
    };

    const handleLeaveClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmType('leave');
    };

    const handleConfirm = () => {
        if (confirmType === 'delete') onDelete(task.task_id);
        else if (confirmType === 'leave') onLeave?.(task.task_id);
        setConfirmType(null);
    };

    return (
        <div
            className={`summary-card${active ? " summary-card--active" : ""}`}
            onClick={() => onClick(task.task_id)}
        >
            {task.needs_attention && <span className="summary-card-attention-dot" />}
            {/* Generating 状态：顶部显示 AI 分析中文案 */}
            {isGenerating && (
                <div className="summary-card-generating">
                    <span className="summary-card-generating-text">
                        {t("summary.summaryCard.generating")}
                    </span>
                    <span className="summary-card-generating-spinner" />
                </div>
            )}
            {/* 源信息 + 状态文字（非 generating 时显示） */}
            {!isGenerating && sourceInfo && (
                <div className="summary-card-top">
                    <span className="summary-card-source">{sourceInfo}</span>
                    {statusText && (
                        <span className="summary-card-status" style={{ color: statusColor ?? undefined }}>
                            {statusText}
                        </span>
                    )}
                </div>
            )}

            {/* 标题 + 描述 */}
            <div className="summary-card-body">
                <div className="summary-card-title">{displayTitle}</div>
                {task.topic && task.topic !== displayTitle && (
                    <div className="summary-card-desc">{task.topic}</div>
                )}
            </div>

            {/* 底部：时间 + 操作菜单 */}
            <div className="summary-card-bottom">
                <span className="summary-card-time">{timeText}</span>
                {(isCreator || (isParticipant && onLeave)) && (
                    <Dropdown
                        trigger="click"
                        position="bottomRight"
                        renderInPortal
                        visible={menuVisible}
                        onVisibleChange={setMenuVisible}
                        render={
                            <Dropdown.Menu className="summary-card-menu">
                                {isCreator && (
                                    <>
                                        {/* Generating / Waiting: 取消任务 */}
                                        {isGenerating && (
                                            <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onCancel?.(task.task_id); }}>
                                                {t("summary.summaryCard.cancelTask")}
                                            </Dropdown.Item>
                                        )}
                                        {displayStatus === TaskStatus.WAITING_CONFIRM && (
                                            <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onCancel?.(task.task_id); }}>
                                                {t("summary.summaryCard.cancelTask")}
                                            </Dropdown.Item>
                                        )}
                                        {/* Failed: 重试 + 编辑 */}
                                        {task.status === TaskStatus.FAILED && (
                                            <>
                                                <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onRetry?.(task.task_id); }}>
                                                    {t("summary.summaryCard.retry")}
                                                </Dropdown.Item>
                                                <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onEdit?.(task.task_id); }}>
                                                    {t("summary.summaryCard.edit")}
                                                </Dropdown.Item>
                                            </>
                                        )}
                                        {/* Completed: 重新生成 + 编辑 */}
                                        {task.status === TaskStatus.COMPLETED && (
                                            <>
                                                <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onRegenerate?.(task.task_id); }}>
                                                    {t("summary.summaryCard.regenerate")}
                                                </Dropdown.Item>
                                                <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onEdit?.(task.task_id); }}>
                                                    {t("summary.summaryCard.edit")}
                                                </Dropdown.Item>
                                            </>
                                        )}
                                        {/* 删除（红色，所有状态都有） */}
                                        <Dropdown.Item
                                            type="danger"
                                            onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); handleDeleteClick(e as any); }}
                                        >
                                            {t("summary.common.delete")}
                                        </Dropdown.Item>
                                    </>
                                )}
                                {!isCreator && isParticipant && onLeave && (
                                    <Dropdown.Item
                                        type="danger"
                                        onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); handleLeaveClick(e as any); }}
                                    >
                                        {t("summary.summaryCard.leave")}
                                    </Dropdown.Item>
                                )}
                            </Dropdown.Menu>
                        }
                    >
                        <button
                            type="button"
                            className="summary-card-more"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="more"
                        >
                            <MoreHorizontal size={16} />
                        </button>
                    </Dropdown>
                )}
            </div>

            {/* 待确认邀请 */}
            {isPendingInvite && onRespond && (
                <div
                    className="summary-card-respond"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="summary-card-respond-btn summary-card-respond-btn--accept"
                        onClick={() => onRespond(task.task_id, "accept")}
                    >
                        {t("summary.action.accept")}
                    </button>
                    <button
                        className="summary-card-respond-btn summary-card-respond-btn--reject"
                        onClick={() => onRespond(task.task_id, "reject")}
                    >
                        {t("summary.action.reject")}
                    </button>
                </div>
            )}

            {/* Confirm PopConfirm dialog */}
            <Modal
                visible={confirmType !== null}
                onCancel={() => setConfirmType(null)}
                header={null}
                footer={null}
                width={480}
                className="summary-confirm"
                centered
                maskClosable
            >
                <div className="summary-confirm-body">
                    <div className="summary-confirm-main">
                        <span className="summary-confirm-icon">
                            <AlertTriangle size={24} />
                        </span>
                        <div className="summary-confirm-caption">
                            <div className="summary-confirm-title">
                                {confirmType === 'delete'
                                    ? t("summary.summaryCard.confirmDeleteTitle")
                                    : t("summary.summaryCard.confirmLeaveTitle")}
                            </div>
                            <div className="summary-confirm-desc">
                                {confirmType === 'delete'
                                    ? t("summary.summaryCard.confirmDeleteDesc")
                                    : t("summary.summaryCard.confirmLeaveDesc")}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="summary-confirm-close"
                        onClick={() => setConfirmType(null)}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="summary-confirm-footer">
                    <button
                        type="button"
                        className="summary-confirm-btn summary-confirm-btn--cancel"
                        onClick={() => setConfirmType(null)}
                    >
                        {t("summary.common.cancel")}
                    </button>
                    <button
                        type="button"
                        className="summary-confirm-btn summary-confirm-btn--danger"
                        onClick={handleConfirm}
                    >
                        {confirmType === 'delete'
                            ? t("summary.common.delete")
                            : t("summary.common.confirm")}
                    </button>
                </div>
            </Modal>
        </div>
    );
};

export default SummaryCard;
