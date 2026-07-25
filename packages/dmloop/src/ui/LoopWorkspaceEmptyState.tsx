import React from "react";
import { FolderPlus } from "lucide-react";

export interface LoopWorkspaceEmptyStateProps {
  title: string;
  desc: string;
}

export default function LoopWorkspaceEmptyState({
  title,
  desc,
}: LoopWorkspaceEmptyStateProps) {
  return (
    <div className="loop-page">
      <div className="loop-empty">
        <FolderPlus size={44} className="loop-empty__icon" />
        <div className="loop-empty__title">{title}</div>
        <div className="loop-empty__desc">{desc}</div>
      </div>
    </div>
  );
}
