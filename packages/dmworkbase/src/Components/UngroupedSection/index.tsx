import React from "react"
import { useDroppable } from "@dnd-kit/core"
import "./index.css"

export interface UngroupedSectionProps {
    children?: React.ReactNode
    /** 是否启用 drop 接收（未分组区，接受 group 类型的 drop = 移出分组） */
    droppable?: boolean
}

const UngroupedSectionInner: React.FC<UngroupedSectionProps> = ({ children }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: 'drop::ungrouped',
        data: { type: 'ungrouped-drop' },
    })

    return (
        <div
            ref={setNodeRef}
            className={`wk-ungrouped-section${isOver ? ' wk-ungrouped-section--drop-over' : ''}`}
        >
            <div className="wk-ungrouped-section__header">
                <span className="wk-ungrouped-section__title">默认分组</span>
            </div>
            <div>{children}</div>
        </div>
    )
}

const UngroupedSectionStatic: React.FC<UngroupedSectionProps> = ({ children }) => (
    <div className="wk-ungrouped-section">
        <div className="wk-ungrouped-section__header">
            <span className="wk-ungrouped-section__title">默认分组</span>
        </div>
        <div>{children}</div>
    </div>
)

/**
 * 「未分组群聊」区块。
 * droppable=true 时作为 dnd-kit droppable 区域（接受 group drop = 移出分组）。
 */
const UngroupedSection: React.FC<UngroupedSectionProps> = (props) => {
    if (props.droppable) return <UngroupedSectionInner {...props} />
    return <UngroupedSectionStatic {...props} />
}

export default UngroupedSection
