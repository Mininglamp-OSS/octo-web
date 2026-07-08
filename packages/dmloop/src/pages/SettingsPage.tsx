import React, { useCallback, useEffect, useState } from "react";
import {
  Typography, Input, Button, Tabs, TabPane, Table, Tag, Select, Spin, Toast, Banner, Modal, Avatar,
} from "@douyinfe/semi-ui";
import { Save, UserPlus, Trash2, User } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Workspace, WorkspaceMember, Invitation } from "../api/types";
import {
  updateWorkspace, listWorkspaceMembers, inviteMember, updateMemberRole, removeMember,
  listWorkspaceInvitations, revokeInvitation,
} from "../api/workspaceApi";

const { Title, Text } = Typography;
const ROLES = ["admin", "member"];

/**
 * Loop 设置页（对标 multica）：通用（General，无 Danger Zone）+ 成员管理（Members）。
 */
export default function SettingsPage({
  workspace,
  onUpdated,
}: {
  workspace: Workspace | null;
  onUpdated?: () => void;
}) {
  const { t } = useI18n();

  if (!workspace) {
    return (
      <div className="loop-page">
        <div className="loop-page__head"><Title heading={4}>{t("loop.nav.settings")}</Title></div>
        <div className="loop-page__center"><Text type="tertiary">{t("loop.settings.noWorkspace")}</Text></div>
      </div>
    );
  }

  return (
    <div className="loop-page">
      <div className="loop-page__head"><Title heading={4}>{t("loop.nav.settings")}</Title></div>
      <div className="loop-page__body">
        <Tabs type="line">
          <TabPane tab={t("loop.settings.general")} itemKey="general">
            <GeneralTab workspace={workspace} onUpdated={onUpdated} />
          </TabPane>
          <TabPane tab={t("loop.settings.members")} itemKey="members">
            <MembersTab workspaceId={workspace.id} />
          </TabPane>
        </Tabs>
      </div>
    </div>
  );
}

/* ---------- 通用（General，无 Danger Zone） ---------- */
function GeneralTab({ workspace, onUpdated }: { workspace: Workspace; onUpdated?: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(workspace.name);
  const [desc, setDesc] = useState(workspace.description ?? "");
  const [prefix, setPrefix] = useState(workspace.issue_prefix ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace.name); setDesc(workspace.description ?? ""); setPrefix(workspace.issue_prefix ?? "");
  }, [workspace.id]);

  const save = async () => {
    if (!name.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    setSaving(true);
    try {
      await updateWorkspace(workspace.id, { name: name.trim(), description: desc, issue_prefix: prefix.trim() || undefined });
      Toast.success(t("loop.toast.saved"));
      onUpdated?.();
    } catch (e) { Toast.error((e as Error)?.message ?? "save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 560, paddingTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div className="loop-detail__section-title">{t("loop.settings.wsName")}</div>
        <Input value={name} onChange={setName} />
      </div>
      <div>
        <div className="loop-detail__section-title">{t("loop.settings.wsSlug")}</div>
        <Input value={workspace.slug} disabled />
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.settings.slugHint")}</Text>
      </div>
      <div>
        <div className="loop-detail__section-title">{t("loop.settings.issuePrefix")}</div>
        <Input value={prefix} onChange={setPrefix} placeholder="KOCT" style={{ width: 200 }} />
      </div>
      <div>
        <div className="loop-detail__section-title">{t("loop.field.description")}</div>
        <Input value={desc} onChange={setDesc} />
      </div>
      <div>
        <Button theme="solid" icon={<Save size={14} />} loading={saving} onClick={save}>{t("loop.action.save")}</Button>
      </div>
    </div>
  );
}

/* ---------- 成员管理（Members） ---------- */
function MembersTab({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      listWorkspaceMembers(workspaceId),
      listWorkspaceInvitations(workspaceId).catch(() => [] as Invitation[]),
    ])
      .then(([m, inv]) => { setMembers(m); setInvites(inv); })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, [workspaceId]);
  useEffect(reload, [reload]);

  const invite = async () => {
    if (!email.trim()) { Toast.warning(t("loop.settings.emailRequired")); return; }
    setInviting(true);
    try {
      await inviteMember(workspaceId, { email: email.trim(), role });
      setEmail("");
      Toast.success(t("loop.settings.invited"));
      reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "invite failed"); }
    finally { setInviting(false); }
  };

  const changeRole = async (m: WorkspaceMember, r: string) => {
    try { await updateMemberRole(workspaceId, m.id, r); Toast.success(t("loop.toast.saved")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "failed"); }
  };
  const remove = (m: WorkspaceMember) => {
    Modal.confirm({
      title: t("loop.settings.removeMember"),
      content: m.name || m.email,
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await removeMember(workspaceId, m.id); Toast.success(t("loop.toast.deleted")); reload(); }
        catch (e) { Toast.error((e as Error)?.message ?? "failed"); }
      },
    });
  };
  const revoke = (inv: Invitation) => {
    Modal.confirm({
      title: t("loop.settings.revokeInvite"),
      content: inv.invitee_email,
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await revokeInvitation(workspaceId, inv.id); Toast.success(t("loop.toast.deleted")); reload(); }
        catch (e) { Toast.error((e as Error)?.message ?? "failed"); }
      },
    });
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>;
  if (error) return <Banner type="danger" description={error} />;

  const memberCols = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: WorkspaceMember) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Avatar size="extra-small" color="light-blue"><User size={13} /></Avatar>
        <span><div>{v}</div><Text type="tertiary" style={{ fontSize: 12 }}>{r.email}</Text></span>
      </span>) },
    { title: t("loop.settings.role"), dataIndex: "role", width: 160, render: (v: string, r: WorkspaceMember) => (
      v === "owner"
        ? <Tag color="amber" size="small">owner</Tag>
        : <Select value={v} size="small" style={{ width: 120 }} onChange={(nv) => changeRole(r, nv as string)}>
            {ROLES.map((x) => <Select.Option key={x} value={x}>{x}</Select.Option>)}
          </Select>
    ) },
    { title: "", dataIndex: "id", width: 60, render: (_v: string, r: WorkspaceMember) => (
      r.role === "owner" ? null : <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => remove(r)} />
    ) },
  ];

  return (
    <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <div className="loop-settings-invite">
        <Input value={email} onChange={setEmail} placeholder={t("loop.settings.inviteEmail")} style={{ flex: 1 }} />
        <Select value={role} onChange={(v) => setRole(v as string)} style={{ width: 120 }}>
          {ROLES.map((x) => <Select.Option key={x} value={x}>{x}</Select.Option>)}
        </Select>
        <Button theme="solid" icon={<UserPlus size={14} />} loading={inviting} onClick={invite}>{t("loop.settings.invite")}</Button>
      </div>

      <div>
        <div className="loop-detail__section-title">{t("loop.settings.members")} ({members.length})</div>
        <Table rowKey="id" columns={memberCols} dataSource={members} pagination={false} size="small" />
      </div>

      {invites.length > 0 && (
        <div>
          <div className="loop-detail__section-title">{t("loop.settings.pendingInvites")} ({invites.length})</div>
          <div className="loop-comments">
            {invites.map((inv) => (
              <div key={inv.id} className="loop-comment" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text>{inv.invitee_email}</Text>
                <Tag size="small" color="grey">{inv.role}</Tag>
                <Button theme="borderless" type="danger" size="small" style={{ marginLeft: "auto" }} icon={<Trash2 size={13} />} onClick={() => revoke(inv)}>{t("loop.settings.revoke")}</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
