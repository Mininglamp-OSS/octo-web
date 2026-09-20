import React, { useEffect, useRef, useState } from "react";
import { Popover, Tooltip } from "@douyinfe/semi-ui";
import { ChevronDown, LayoutGrid, Link2, Lock, X } from "lucide-react";
import WKButton from "../../Components/WKButton";
import { useI18n } from "../../i18n";
import "./index.css";

let nextEntryId = 0;

export interface WorkspaceGroupEntryModel {
  projectName: string;
  linkedByName: string;
  manageDisabledReason?: "workspace_membership" | "group_role" | "system_group" | "denied" | "unavailable";
  source: "created_in_project" | "linked_existing" | "unknown";
  canOpen: boolean;
  canManage: boolean;
  isAllMemberGroup: boolean;
}

export interface WorkspaceGroupEntryProps {
  workspace: WorkspaceGroupEntryModel | null;
  busy?: "open" | "manage" | null;
  refreshing?: boolean;
  error?: string;
  defaultOpen?: boolean;
  onOpen: () => void;
  onManage: () => void;
  onRetry: () => void;
}

export function WorkspaceGroupEntry({
  workspace, busy, refreshing, error, defaultOpen = false, onOpen, onManage, onRetry,
}: WorkspaceGroupEntryProps): JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [id] = useState(() => `workspace-group-${++nextEntryId}`);
  const toggleRef = useRef<HTMLSpanElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const close = () => {
    setOpen(false);
    toggleRef.current?.querySelector("button")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => detailsRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  if (!workspace) return null;
  const disabled = Boolean(busy || refreshing);
  const source = workspace.isAllMemberGroup ? "allMembers" : workspace.source;
  const canManage = workspace.canManage && !workspace.isAllMemberGroup;
  const permissionNotice = workspace.isAllMemberGroup ? "systemManaged"
    : workspace.manageDisabledReason === "unavailable" ? "permissionUnavailable"
    : workspace.manageDisabledReason === "denied" ? "permissionDenied" : "readOnly";
  const content = (
    <section
      ref={detailsRef}
      tabIndex={-1}
      className="wk-workspace-group-popover"
      role="dialog"
      aria-labelledby={`${id}-title`}
      id={`${id}-details`}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
      }}
    >
      <div className="wk-workspace-group-popover__header">
        <h3 id={`${id}-title`}>{t("base.workspaceGroup.title")}</h3>
        <WKButton variant="ghost" size="sm" iconOnly icon={<X size={14} />}
          aria-label={t("base.common.close")} onClick={close} />
      </div>
      <dl className="wk-workspace-group-popover__details">
        <dt>{t("base.workspaceGroup.workspace")}</dt><dd>{workspace.projectName}</dd>
        <dt>{t("base.workspaceGroup.linkedBy")}</dt>
        <dd className={!workspace.linkedByName ? "wk-workspace-group-popover__empty" : undefined}>
          {workspace.linkedByName || t("base.workspaceGroup.unknown")}
        </dd>
        <dt>{t("base.workspaceGroup.source")}</dt>
        <dd className={source === "unknown" ? "wk-workspace-group-popover__empty" : undefined}>
          {t(`base.workspaceGroup.source.${source}`)}
        </dd>
      </dl>
      {!workspace.canOpen && (
        <p className="wk-workspace-group-popover__notice"><Lock size={14} />{t("base.workspaceGroup.noAccess")}</p>
      )}
      {!canManage && (
        <p className="wk-workspace-group-popover__notice">
          {t(`base.workspaceGroup.${permissionNotice}`)}
        </p>
      )}
      {error && (
        <div className="wk-workspace-group-popover__error" role="alert">
          <span>{error}</span>
          <WKButton size="sm" variant="ghost" disabled={disabled} onClick={onRetry}>
            {t("base.workspaceGroup.retry")}
          </WKButton>
        </div>
      )}
      {refreshing && <p className="wk-workspace-group-popover__notice" role="status">{t("base.workspaceGroup.refreshing")}</p>}
      {canManage && (
        <div className="wk-workspace-group-popover__footer">
          <WKButton size="sm" variant="ghost" icon={<Link2 size={14} />}
            loading={busy === "manage"} disabled={disabled || Boolean(error)} onClick={() => {
              setOpen(false);
              onManage();
            }}>
            {t("base.workspaceGroup.manage")}
          </WKButton>
        </div>
      )}
    </section>
  );

  return (
    <div className="wk-workspace-group-entry" data-desktop-chrome="control" onClick={(event) => event.stopPropagation()}>
      <Tooltip content={t(workspace.canOpen ? "base.workspaceGroup.open" : "base.workspaceGroup.noAccess",
        { values: { name: workspace.projectName } })}>
        <span className="wk-workspace-group-entry__name">
          <WKButton variant="ghost" size="sm" className="wk-workspace-group-entry__jump"
            icon={<LayoutGrid size={14} strokeWidth={1.7} aria-hidden="true" />} loading={busy === "open"}
            disabled={!workspace.canOpen || disabled || Boolean(error)}
            aria-label={t("base.workspaceGroup.open", { values: { name: workspace.projectName } })}
            onClick={onOpen}>
            <span className="wk-workspace-group-entry__label">{workspace.projectName}</span>
          </WKButton>
        </span>
      </Tooltip>
      <Popover trigger="custom" visible={open} position="bottomLeft" showArrow={false}
        content={content} onClickOutSide={() => setOpen(false)}>
        <span ref={toggleRef} className="wk-workspace-group-entry__disclosure">
          <Tooltip content={t("base.workspaceGroup.details")}>
            <span className="wk-workspace-group-entry__toggle-anchor">
            <WKButton variant="ghost" size="sm" iconOnly className="wk-workspace-group-entry__toggle"
              icon={<ChevronDown size={12} strokeWidth={1.7} aria-hidden="true" />} aria-label={t("base.workspaceGroup.details")}
              aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-details` : undefined}
              onClick={() => setOpen(!open)} />
            </span>
          </Tooltip>
        </span>
      </Popover>
    </div>
  );
}

export default WorkspaceGroupEntry;
