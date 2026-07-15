import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Typography, Button, Tabs, TabPane, Table, Select, Spin, Toast, Banner, Modal, Avatar,
} from "@douyinfe/semi-ui";
import { Save, UserPlus, Trash2, User } from "lucide-react";
import { useI18n, WKApp, SpaceService } from "@octo/base";
import type { SpaceMember } from "@octo/base";
import type { Workspace, WorkspaceMember, Invitation } from "../api/types";
import {
  updateWorkspace, listWorkspaceMembers, addOctoMember, updateMemberRole, removeMember,
  listWorkspaceInvitations, revokeInvitation,
} from "../api/workspaceApi";
import { invalidateDirectory } from "../api/directory";
import LoopTag from "../ui/LoopTag";
import LoopButton from "../ui/LoopButton";

const { Title, Text } = Typography;
const ROLES = ["admin", "member"];

/**
 * Loop 设置页（对齐产品设计）：通用（General，无 Danger Zone）+ 成员管理（Members）。
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
    <div className="loop-fields" style={{ maxWidth: 560, paddingTop: 12 }}>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.settings.wsName")}</div>
        <input className="loop-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("loop.workspace.namePlaceholder")} />
      </div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.settings.wsSlug")}</div>
        <input className="loop-field" value={workspace.slug} disabled />
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.settings.slugHint")}</Text>
      </div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.settings.issuePrefix")}</div>
        <input className="loop-field" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="KOCT" style={{ width: 200 }} />
      </div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.field.description")}</div>
        <input className="loop-field" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("loop.workspace.descPlaceholder")} />
      </div>
      <div className="loop-fields__row">
        <LoopButton icon={<Save size={14} />} loading={saving} onClick={save}>{t("loop.action.save")}</LoopButton>
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
  // roster(space 成员)单独的失败标记:与「space 确实没有可加成员」区分开——
  // 抓取失败时不能显示误导性的「暂无成员」并禁用添加(#581 评审 B2)。
  const [rosterError, setRosterError] = useState(false);
  // octo space 成员（仅人，robot===0）+ uid→身份 映射，供选择器候选与列表渲染复用。
  const [spaceHumans, setSpaceHumans] = useState<SpaceMember[]>([]);
  const seqRef = useRef(0); // reload 请求序号:切 workspace 时只让最新一次落地
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [role, setRole] = useState("member");
  const [adding, setAdding] = useState(false);

  const rosterByUid = useMemo(() => {
    const m: Record<string, SpaceMember> = {};
    for (const s of spaceHumans) m[s.uid] = s;
    return m;
  }, [spaceHumans]);

  // 当前 space 全量成员，只保留人（候选来源）。
  const loadSpaceMembers = useCallback(async (): Promise<SpaceMember[]> => {
    const members = await SpaceService.shared.getAllMembers(WKApp.shared.currentSpaceId);
    return members.filter((s) => s.robot === 0);
  }, []);

  const reload = useCallback(() => {
    const my = ++seqRef.current; // 切 workspace 时旧 in-flight 结果不得覆盖新的
    setLoading(true); setError(null); setRosterError(false);
    let rosterFailed = false;
    Promise.all([
      listWorkspaceMembers(workspaceId),
      listWorkspaceInvitations(workspaceId).catch(() => [] as Invitation[]),
      loadSpaceMembers().catch(() => { rosterFailed = true; return [] as SpaceMember[]; }),
    ])
      .then(([m, inv, humans]) => {
        if (my !== seqRef.current) return;
        setMembers(m); setInvites(inv); setSpaceHumans(humans); setRosterError(rosterFailed);
      })
      .catch((e) => { if (my === seqRef.current) setError(e?.message ?? "load failed"); })
      .finally(() => { if (my === seqRef.current) setLoading(false); });
  }, [workspaceId, loadSpaceMembers]);
  useEffect(reload, [reload]);

  // 候选 = space 里的人，排除已是本工作区成员的（按 octo_uid）。
  const existingOctoUids = useMemo(
    () => new Set(members.map((m) => m.octo_uid).filter(Boolean) as string[]),
    [members],
  );
  const candidates = useMemo(
    () => spaceHumans.filter((s) => !existingOctoUids.has(s.uid)),
    [spaceHumans, existingOctoUids],
  );

  const add = async () => {
    if (!selectedUid) return;
    setAdding(true);
    try {
      await addOctoMember(workspaceId, { octo_uid: selectedUid, role });
      setSelectedUid("");
      invalidateDirectory(); // 成员变动后清共享目录缓存,否则指派选择器仍返回旧候选(#581 评审)
      Toast.success(t("loop.settings.added"));
      reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "add failed"); }
    finally { setAdding(false); }
  };

  const changeRole = async (m: WorkspaceMember, r: string) => {
    try { await updateMemberRole(workspaceId, m.id, r); invalidateDirectory(); Toast.success(t("loop.toast.saved")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "failed"); }
  };
  const remove = (m: WorkspaceMember) => {
    Modal.confirm({
      title: t("loop.settings.removeMember"),
      content: displayName(m),
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await removeMember(workspaceId, m.id); invalidateDirectory(); Toast.success(t("loop.toast.deleted")); reload(); }
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

  // octo 身份优先：按 octo_uid 命中 space 名册取名字，否则回退后端侧 name/email。
  const displayName = (m: WorkspaceMember): string =>
    (m.octo_uid && rosterByUid[m.octo_uid]?.name) || m.name || m.email || m.octo_uid || m.user_id;
  const avatarSrc = (m: WorkspaceMember): string | undefined =>
    m.octo_uid ? WKApp.shared.avatarUser(m.octo_uid) : undefined;

  if (loading) return <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>;
  if (error) return <Banner type="danger" description={error} />;

  const memberCols = [
    { title: t("loop.field.name"), dataIndex: "name", render: (_v: string, r: WorkspaceMember) => {
      const src = avatarSrc(r);
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Avatar size="extra-small" color="light-blue" src={src}>{src ? undefined : <User size={13} />}</Avatar>
          <span>{displayName(r)}</span>
        </span>
      );
    } },
    { title: t("loop.settings.role"), dataIndex: "role", width: 160, render: (v: string, r: WorkspaceMember) => (
      v === "owner"
        ? <LoopTag tone="amber">owner</LoopTag>
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
      {rosterError && (
        <Banner
          type="danger"
          closeIcon={null}
          description={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
              {t("loop.settings.rosterLoadFailed")}
              <Button size="small" onClick={reload}>{t("loop.settings.rosterRetry")}</Button>
            </span>
          }
        />
      )}
      <div className="loop-settings-invite">
        <Select
          filter
          value={selectedUid || undefined}
          onChange={(v) => setSelectedUid(v as string)}
          placeholder={candidates.length ? t("loop.settings.selectMember") : t("loop.settings.noCandidates")}
          disabled={!candidates.length}
          dropdownClassName="loop-fields__dropdown"
          style={{ flex: 1 }}
          emptyContent={t("loop.settings.noCandidates")}
        >
          {candidates.map((c) => (
            // label 提供可匹配的纯字符串,否则 Semi 的 filter 拿 JSX children 无法匹配,输入即空(#581 评审 B1)
            <Select.Option key={c.uid} value={c.uid} label={c.name} showTick={false}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Avatar size="extra-small" color="light-blue" src={WKApp.shared.avatarUser(c.uid)}>{c.name?.slice(0, 1)}</Avatar>
                <span>{c.name}</span>
              </span>
            </Select.Option>
          ))}
        </Select>
        <Select value={role} onChange={(v) => setRole(v as string)} dropdownClassName="loop-fields__dropdown" style={{ width: 120 }}>
          {ROLES.map((x) => <Select.Option key={x} value={x}>{x}</Select.Option>)}
        </Select>
        <LoopButton icon={<UserPlus size={14} />} loading={adding} disabled={!selectedUid} onClick={add}>{t("loop.settings.addMember")}</LoopButton>
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
                <LoopTag tone="grey">{inv.role}</LoopTag>
                <Button theme="borderless" type="danger" size="small" style={{ marginLeft: "auto" }} icon={<Trash2 size={13} />} onClick={() => revoke(inv)}>{t("loop.settings.revoke")}</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
