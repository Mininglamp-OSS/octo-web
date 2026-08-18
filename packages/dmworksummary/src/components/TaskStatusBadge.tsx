import React from "react";
import { Tag } from "@octo/ui";
import type { TaskStatusType } from "../types/summary";
import { getStatusLabel, getStatusColor } from "../utils/summaryHelpers";

interface TaskStatusBadgeProps {
    status: TaskStatusType;
}

const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({ status }) => {
    return (
        <Tag tone={getStatusColor(status)} size="small">
            {getStatusLabel(status)}
        </Tag>
    );
};

export default TaskStatusBadge;
