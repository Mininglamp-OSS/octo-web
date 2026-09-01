import React, { useState } from "react";
import { Dropdown, Modal, Tooltip } from "@douyinfe/semi-ui";
import { MoreHorizontal, AlertTriangle, Bot, Clock, FileText, UsersRound, X } from "lucide-react";
import { useI18n, Dap } from "@octo/base";
import WKApp from "@octo/base/src/App";
import { ParticipantStatus, TaskStatus, TriggerType, type SummaryListItem } from "../types/summary";
import { formatDateOnly, getStatusLabel, getSummaryTypeKind, getSummaryTypeLabel } from "../utils/summaryHelpers";
import { deriveSummaryDisplayContent } from "../utils/templateResolver";
import { summaryTestIds } from "../utils/testIds";

interface SummaryCardProps {
    task: SummaryListItem;
    active?: boolean;
    onClick: (taskId: number) => void;
    onDelete: (taskId: number) => void;
    onRespond?: (taskId: number, action: "accept" | "reject") => void;
    onLeave?: (taskId: number) => void;
    onRetry?: (taskId: number) => void;
    onRegenerate?: (taskId: number) => void;
    onContinueOptimize?: (taskId: number) => void;
    onEdit?: (taskId: number) => void;
    onCancel?: (taskId: number) => void;
    /** Capability 开启后启用统一入口下的 Agent 专属菜单；Legacy 保持原菜单。 */
    unifiedAgentActions?: boolean;
}


/** 相对时间格式化 */
function formatRelativeTime(dateStr: string, t: (key: string, opts?: any) => string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return t("summary.summaryCard.justNow");
    if (diff < 3600) return t("summary.summaryCard.minutesAgo", { values: { count: Math.floor(diff / 60) } });
    if (diff < 86400) return t("summary.summaryCard.hoursAgo", { values: { count: Math.floor(diff / 3600) } });
    // 超过十天回落到具体日期（issue #1440）：「45天前」这类相对值对定位
    // 总结已没有参考价值。阈值按 issue 取「超过」十天，与 dmworkbase
    // relativeTime.ts 的「超过 N 天回落绝对日期」模式一致。
    if (diff > 10 * 86400) return formatDateOnly(dateStr);
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
        case TaskStatus.COMPLETED:
            return "var(--wk-color-success)";
        case TaskStatus.CANCELLED:
            return "rgba(28, 28, 35, 0.4)";
        default:
            return null;
    }
}

const SummaryCard: React.FC<SummaryCardProps> = ({ task, active, onClick, onDelete, onRespond, onLeave, onRetry, onRegenerate, onContinueOptimize, onEdit, onCancel, unifiedAgentActions = false }) => {
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
    // Keep the description truthy so an empty topic does not render a
    // 4px-tall empty `.summary-card-desc`, and do NOT gate on length —
    // `.summary-card-desc` already uses `-webkit-line-clamp: 2; overflow:
    // hidden` (src/index.css:476-485), so a topic of any length clamps
    // visually instead of vanishing outright at the 81st character.
    const description = task.topic?.trim() || "";
    const showDescription = description !== "" && description !== displayTitle;
    const displayStatus = displaysWaiting ? TaskStatus.PENDING : task.status;
    const statusColor = getStatusColor(displayStatus);
    const statusText = getStatusLabel(displayStatus);

    const isGenerating = !displaysWaiting
        && (task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING);
    // 类型分类 — 单一 classifier 派生 label + icon + CSS class（R4 yj P2-2）。
    const typeKind = getSummaryTypeKind(task);
    const typeLabel = getSummaryTypeLabel(t, task);
    const sourceInfo = getSourceInfo(task, t);
    const relativeTime = formatRelativeTime(task.created_at, t);
    const isCreator = task.creator_id != null && task.creator_id === currentUid;
    const isParticipant = myParticipant != null;
    // Bot-created summaries (trigger_type=BOT) are marked with the acting bot's
    // name. The Bot tag keys off trigger_type so the summary stays visibly marked
    // regardless of field availability; the "由 <bot> 创建" copy is only used when
    // creator_bot_name is actually present. That field is added by the backend in
    // octo-smart-summary#188 — until it ships, trigger_type=BOT tasks (producible
    // since #181) carry no name, so we fall back to the normal creator/time copy
    // instead of rendering "未知" (the two services deploy independently).
    const isBotCreated = task.trigger_type === TriggerType.BOT || !!task.creator_bot_name;
    const hasBotName = isBotCreated && !!task.creator_bot_name;

    const timeText = hasBotName
        ? t("summary.summaryCard.botCreatedAt", { values: { name: task.creator_bot_name!, time: relativeTime } })
        : isCreator
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
            data-testid={summaryTestIds.card(task.task_id)}
            className={`summary-card${active ? " summary-card--active" : ""}`}
            onClick={() => {
                // 埋点 305:点开一张总结卡片进入详情（动态 testid 无法走委托，命令式）。
                Dap.shared.track("smart_summary_opened", {});
                onClick(task.task_id);
            }}
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
            {!isGenerating && (sourceInfo || statusText) && (
                <div className="summary-card-top">
                    {sourceInfo && <span className="summary-card-source">{sourceInfo}</span>}
                    {statusText && (
                        <span className="summary-card-status" style={{ color: statusColor ?? undefined }}>
                            {statusText}
                        </span>
                    )}
                </div>
            )}

            {/* 标题行：类型图标 + 标题；来源保持在上一行 */}
            <div className="summary-card-body">
                <div className="summary-card-title-row">
                    <Tooltip content={typeLabel} position="top">
                        <span
                            className={`summary-card-type-icon summary-card-type-icon--${typeKind}`}
                            role="img"
                            aria-label={typeLabel}
                            tabIndex={0}
                        >
                            {typeKind === 'agent' ? <Bot size={14} />
                                : typeKind === 'scheduled' ? <Clock size={14} />
                                : typeKind === 'multi' ? <UsersRound size={14} />
                                : <FileText size={14} />}
                        </span>
                    </Tooltip>
                    <div className="summary-card-title">{displayTitle}</div>
                </div>
                {showDescription && (
                    <div className="summary-card-desc">{description}</div>
                )}
            </div>

            {/* 底部：时间 + 操作菜单 */}
            <div className="summary-card-bottom">
                {isBotCreated && (
                    <span className="summary-card-bot-tag">
                        <Bot size={11} />
                        {t("summary.summaryCard.botTag")}
                    </span>
                )}
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
                                        {isGenerating && onCancel && (
                                            <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onCancel?.(task.task_id); }}>
                                                {t("summary.summaryCard.cancelTask")}
                                            </Dropdown.Item>
                                        )}
                                        {displayStatus === TaskStatus.WAITING_CONFIRM && onCancel && (
                                            <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onCancel?.(task.task_id); }}>
                                                {t("summary.summaryCard.cancelTask")}
                                            </Dropdown.Item>
                                        )}
                                        {/* Failed Agent summaries cannot enter the workflow editor. */}
                                        {task.status === TaskStatus.FAILED && (
                                            <>
                                                {onRetry && (
                                                    <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onRetry(task.task_id); }}>
                                                        {t("summary.summaryCard.retry")}
                                                    </Dropdown.Item>
                                                )}
                                                {onEdit && (!unifiedAgentActions || typeKind !== "agent") && (
                                                    <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onEdit?.(task.task_id); }}>
                                                        {t("summary.summaryCard.edit")}
                                                    </Dropdown.Item>
                                                )}
                                            </>
                                        )}
                                        {/* Completed Agent summaries refine in the unified assistant;
                                            Workflow summaries keep regenerate + edit. */}
                                        {task.status === TaskStatus.COMPLETED && (
                                            unifiedAgentActions && typeKind === "agent" ? (
                                                task.referenceable !== false && onContinueOptimize ? (
                                                    <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onContinueOptimize(task.task_id); }}>
                                                        {t("summary.detail.continueRefine")}
                                                    </Dropdown.Item>
                                                ) : null
                                            ) : (
                                                <>
                                                    {onRegenerate && (
                                                        <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onRegenerate(task.task_id); }}>
                                                            {t("summary.summaryCard.regenerate")}
                                                        </Dropdown.Item>
                                                    )}
                                                    {onEdit && (
                                                        <Dropdown.Item onClick={(e) => { e?.stopPropagation?.(); setMenuVisible(false); onEdit(task.task_id); }}>
                                                            {t("summary.summaryCard.edit")}
                                                        </Dropdown.Item>
                                                    )}
                                                </>
                                            )
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
                            data-testid={summaryTestIds.cardMenu(task.task_id)}
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
                        data-testid={summaryTestIds.cardAcceptBtn(task.task_id)}
                        className="summary-card-respond-btn summary-card-respond-btn--accept"
                        onClick={() => onRespond(task.task_id, "accept")}
                    >
                        {t("summary.action.accept")}
                    </button>
                    <button
                        data-testid={summaryTestIds.cardRejectBtn(task.task_id)}
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
