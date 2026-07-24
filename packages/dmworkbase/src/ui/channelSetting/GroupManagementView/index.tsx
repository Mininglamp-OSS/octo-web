import React from "react";
import { Switch } from "@douyinfe/semi-ui";
import { Trash2 } from "lucide-react";
import WKButton from "../../../Components/WKButton";
import "./index.css";

export type GroupManagementMemberRole = "owner" | "manager" | "botAdmin";

export interface GroupManagementMemberItem {
  id: string;
  name: React.ReactNode;
  avatar: React.ReactNode;
  role?: GroupManagementMemberRole;
  canRemove?: boolean;
}

export interface GroupManagementViewLabels {
  loading: React.ReactNode;
  ownerAndManagers: React.ReactNode;
  botAdmins: React.ReactNode;
  addManager: React.ReactNode;
  addBotAdmin: React.ReactNode;
  owner: React.ReactNode;
  manager: React.ReactNode;
  botAdmin: React.ReactNode;
  emptyManagers: React.ReactNode;
  emptyBotAdmins: React.ReactNode;
  memberManagement: React.ReactNode;
  memberManagementMeta?: React.ReactNode;
  allowNoMentionTitle: React.ReactNode;
  allowNoMentionLabel: React.ReactNode;
  allowNoMentionDesc: React.ReactNode;
  disbandAction: React.ReactNode;
  disbandDesc: React.ReactNode;
  removeMember: string;
}

export interface GroupManagementViewProps {
  loading: boolean;
  managers: GroupManagementMemberItem[];
  botAdmins: GroupManagementMemberItem[];
  allowNoMention: boolean;
  allowNoMentionSaving: boolean;
  canManageManagers: boolean;
  canManageBotAdmins: boolean;
  canDisband: boolean;
  labels: GroupManagementViewLabels;
  onAddManager: () => void;
  onAddBotAdmin: () => void;
  onRemoveManager: (item: GroupManagementMemberItem) => void;
  onRemoveBotAdmin: (item: GroupManagementMemberItem) => void;
  onToggleAllowNoMention: (next: boolean) => void;
  onDisband: () => void;
}

function GroupManagementRoleBadge({
  role,
  labels,
}: {
  role?: GroupManagementMemberRole;
  labels: GroupManagementViewLabels;
}) {
  if (!role) return null;

  const text =
    role === "owner"
      ? labels.owner
      : role === "manager"
        ? labels.manager
        : labels.botAdmin;

  return (
    <span className={`wk-group-management-role wk-group-management-role--${role}`}>
      <span>{text}</span>
    </span>
  );
}

function GroupManagementMemberRow({
  item,
  labels,
  onRemove,
}: {
  item: GroupManagementMemberItem;
  labels: GroupManagementViewLabels;
  onRemove: (item: GroupManagementMemberItem) => void;
}) {
  const labelText =
    typeof item.name === "string" ? item.name : labels.removeMember;

  return (
    <li className="wk-group-management-member">
      <span className="wk-group-management-member-avatar">{item.avatar}</span>
      <span className="wk-group-management-member-main">
        <span className="wk-group-management-member-name">{item.name}</span>
        <GroupManagementRoleBadge role={item.role} labels={labels} />
      </span>
      {item.canRemove && (
        <button
          type="button"
          className="wk-group-management-remove"
          onClick={() => onRemove(item)}
          aria-label={`${labels.removeMember} ${labelText}`}
          title={labels.removeMember}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

function GroupManagementMemberSection({
  title,
  members,
  empty,
  action,
  divided = false,
  labels,
  onRemove,
}: {
  title: React.ReactNode;
  members: GroupManagementMemberItem[];
  empty: React.ReactNode;
  action?: React.ReactNode;
  divided?: boolean;
  labels: GroupManagementViewLabels;
  onRemove: (item: GroupManagementMemberItem) => void;
}) {
  return (
    <section
      className={`wk-group-management-section${
        divided ? " wk-group-management-section--divided" : ""
      }`}
    >
      <div className="wk-group-management-section-header">
        <span className="wk-group-management-section-title">
          <span>{title}</span>
        </span>
        {action}
      </div>
      {members.length === 0 ? (
        <div className="wk-group-management-empty">{empty}</div>
      ) : (
        <ul className="wk-group-management-member-list">
          {members.map((item) => (
            <GroupManagementMemberRow
              key={item.id}
              item={item}
              labels={labels}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function GroupManagementView({
  loading,
  managers,
  botAdmins,
  allowNoMention,
  allowNoMentionSaving,
  canManageManagers,
  canManageBotAdmins,
  canDisband,
  labels,
  onAddManager,
  onAddBotAdmin,
  onRemoveManager,
  onRemoveBotAdmin,
  onToggleAllowNoMention,
  onDisband,
}: GroupManagementViewProps) {
  if (loading) {
    return (
      <div className="wk-group-management">
        <div className="wk-group-management-loading">{labels.loading}</div>
      </div>
    );
  }

  return (
    <div className="wk-group-management">
      <div className="wk-group-management-content">
        <GroupManagementMemberSection
          title={labels.ownerAndManagers}
          members={managers}
          empty={labels.emptyManagers}
          labels={labels}
          onRemove={onRemoveManager}
          action={
            canManageManagers ? (
              <WKButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAddManager}
              >
                {labels.addManager}
              </WKButton>
            ) : undefined
          }
        />

        <GroupManagementMemberSection
          title={labels.botAdmins}
          members={botAdmins}
          empty={labels.emptyBotAdmins}
          divided
          labels={labels}
          onRemove={onRemoveBotAdmin}
          action={
            canManageBotAdmins ? (
              <WKButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAddBotAdmin}
              >
                {labels.addBotAdmin}
              </WKButton>
            ) : undefined
          }
        />

        <section className="wk-group-management-section">
          <div className="wk-group-management-section-header">
            <span className="wk-group-management-section-title">
              <span>{labels.memberManagement}</span>
            </span>
            {labels.memberManagementMeta && (
              <span className="wk-group-management-section-meta">
                {labels.memberManagementMeta}
              </span>
            )}
          </div>
          <div className="wk-group-management-setting-row">
            <span className="wk-group-management-setting-main">
              <span className="wk-group-management-setting-title-row">
                <span className="wk-group-management-setting-title">
                  {labels.allowNoMentionLabel}
                </span>
                <span className="wk-group-management-switch-control">
                  <Switch
                    checked={allowNoMention}
                    loading={allowNoMentionSaving}
                    onChange={onToggleAllowNoMention}
                  />
                </span>
              </span>
              <span className="wk-group-management-setting-desc">
                {labels.allowNoMentionDesc}
              </span>
            </span>
          </div>
        </section>

        {canDisband && (
          <section className="wk-group-management-section wk-group-management-danger-section">
            <button
              type="button"
              className="wk-group-management-danger-row"
              onClick={onDisband}
            >
              <span className="wk-group-management-setting-main">
                <span className="wk-group-management-danger-title">
                  {labels.disbandAction}
                </span>
                <span className="wk-group-management-setting-desc">
                  {labels.disbandDesc}
                </span>
              </span>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

export { GroupManagementView };
