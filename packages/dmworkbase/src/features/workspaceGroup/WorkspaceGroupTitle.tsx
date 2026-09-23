import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkspaceGroup } from "../../bridge/workspaceGroup/useWorkspaceGroup";
import { useI18n } from "../../i18n";
import WorkspaceGroupEntry from "../../ui/WorkspaceGroupEntry";

export function WorkspaceGroupTitle({
  channelId, channelType, children,
}: { channelId: string; channelType: number; children: ReactNode }): JSX.Element {
  const group = useWorkspaceGroup(channelId, channelType);
  const { t } = useI18n();
  const owner = useMemo(() => ({}), [channelId, channelType]);
  const [pendingOwner, setPendingOwner] = useState<object | null>(null);
  const pending = !group.context && Boolean(group.failure || group.refreshing);
  useEffect(() => {
    if (!pending) { setPendingOwner(null); return; }
    // Fast unlinked reads should not flash an unrelated control in every group title.
    const timer = setTimeout(() => setPendingOwner(owner), 400);
    return () => clearTimeout(timer);
  }, [owner, pending]);
  if (!group.context && (!pending || pendingOwner !== owner)) return <>{children}</>;
  const errorKeys = {
    load: "base.workspaceGroup.loadFailed",
    open: "base.workspaceGroup.openFailed",
    manage: "base.workspaceGroup.manageFailed",
  };
  return (
    <span className="wk-workspace-group-title-row">
      <span className="wk-workspace-group-title">{children}</span>
      <WorkspaceGroupEntry
        key={`${channelType}:${channelId}:${group.context?.projectId ?? ""}`}
        workspace={group.context}
        busy={group.busy}
        refreshing={group.refreshing}
        error={group.failure ? t(errorKeys[group.failure]) : undefined}
        onOpen={group.open}
        onManage={group.manage}
        onRetry={group.refresh}
      />
    </span>
  );
}
