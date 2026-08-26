import React, { useRef, useEffect } from "react"
import { Tooltip } from "@douyinfe/semi-ui"
import { GripVertical, MoreHorizontal } from "lucide-react"
import { useI18n } from "../../i18n"
import "./index.css"

export interface CategoryHeaderProps {
    name: string
    groupCount?: number
    unreadCount?: number
    hasMention?: boolean
    isCollapsed: boolean
    isEmpty?: boolean
    onToggle: () => void
    onContextMenu?: (e: React.MouseEvent) => void
    onMoreClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
    // 右键菜单打开时高亮
    isActive?: boolean
    // 行内重命名
    isEditing?: boolean
    onRenameConfirm?: (newName: string) => void
    onRenameCancel?: () => void
    // 拖拽 handle props（由 useSortable 传入）
    dragHandleRef?: React.RefCallback<HTMLElement>
    dragHandleAttributes?: React.HTMLAttributes<HTMLSpanElement>
    dragHandleListeners?: Record<string, React.EventHandler<any>>
}

const CategoryHeader: React.FC<CategoryHeaderProps> = ({
    name,
    groupCount,
    unreadCount,
    hasMention,
    isCollapsed,
    isEmpty,
    onToggle,
    onContextMenu,
    onMoreClick,
    isActive,
    isEditing,
    onRenameConfirm,
    onRenameCancel,
    dragHandleRef,
    dragHandleAttributes,
    dragHandleListeners,
}) => {
    const { t } = useI18n()
    const inputRef = useRef<HTMLInputElement>(null)
    const isConfirmed = useRef(false)

    useEffect(() => {
        if (isEditing && inputRef.current) {
            isConfirmed.current = false
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            const val = inputRef.current?.value.trim()
            if (val) {
                isConfirmed.current = true
                onRenameConfirm?.(val)
            }
        }
        if (e.key === "Escape") {
            isConfirmed.current = true  // 标记已处理，onBlur 跳过
            onRenameCancel?.()
        }
    }

    const handleConfirm = () => {
        const val = inputRef.current?.value.trim()
        if (val) {
            isConfirmed.current = true
            onRenameConfirm?.(val)
        }
    }

    const handleCancel = () => {
        isConfirmed.current = true
        onRenameCancel?.()
    }

    if (isEditing) {
        return (
            <div className="wk-category-header wk-category-header--editing" onClick={e => e.stopPropagation()}>
                <div className="wk-category-header__rename-wrap">
                    <input
                        ref={inputRef}
                        className="wk-category-header__rename-input"
                        defaultValue={name}
                        onKeyDown={handleKeyDown}
                        onBlur={e => {
                            if (isConfirmed.current) {
                                isConfirmed.current = false
                                return
                            }
                            const val = e.target.value.trim()
                            if (val && val !== name) onRenameConfirm?.(val)
                            else onRenameCancel?.()
                        }}
                        onClick={e => e.stopPropagation()}
                    />
                    {/* ✓ 确认 */}
                    <button
                        className="wk-category-header__rename-btn wk-category-header__rename-btn--ok"
                        onMouseDown={e => e.preventDefault()}
                        onClick={handleConfirm}
                    >
                        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                    {/* ✗ 取消 */}
                    <button
                        className="wk-category-header__rename-btn wk-category-header__rename-btn--cancel"
                        onMouseDown={e => e.preventDefault()}
                        onClick={handleCancel}
                    >
                        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div
            className={[
                "wk-category-header",
                isEmpty ? "wk-category-header--empty" : "",
                isActive ? "wk-category-header--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={onToggle}
            onContextMenu={onContextMenu}
        >
            {/* 拖拽 handle（由父组件传入 useSortable setActivatorNodeRef + attributes/listeners） */}
            {dragHandleRef && (
                <span
                    ref={dragHandleRef}
                    className="wk-category-header__drag-handle"
                    {...dragHandleAttributes}
                    {...dragHandleListeners}
                    onClick={e => e.stopPropagation()}
                >
                    <GripVertical size={14} aria-hidden="true" />
                </span>
            )}
            <span className={`wk-category-header__arrow${isCollapsed ? " wk-category-header__arrow--collapsed" : ""}`}>
                <svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 6l4 5 4-5z" fill="currentColor" /></svg>
            </span>
            <span className="wk-category-header__name">
                {name}
                {isEmpty ? (
                    <span className="wk-category-header__count wk-category-header__count--empty">
                        {" "}{t("base.categoryHeader.empty")}
                    </span>
                ) : isCollapsed && groupCount !== undefined ? (
                    <span className="wk-category-header__count"> ({groupCount})</span>
                ) : null}
            </span>
            {/* 分组折叠时才显示角标，展开时隐藏 */}
            {isCollapsed && !isEmpty && !!unreadCount && unreadCount > 0 && (
                <span className="wk-category-header__badges">
                    <span className="wk-category-header__badge">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                    {hasMention && (
                        <span className="wk-category-header__badge wk-category-header__badge--mention">@</span>
                    )}
                </span>
            )}
            {onMoreClick && (
                <Tooltip content={t("base.threadPanel.moreActions")} position="top">
                    <button
                        type="button"
                        className="wk-category-header__more"
                        aria-label={t("base.threadPanel.moreActions")}
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onMoreClick(e)
                        }}
                    >
                        <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                </Tooltip>
            )}
        </div>
    )
}

export default CategoryHeader
