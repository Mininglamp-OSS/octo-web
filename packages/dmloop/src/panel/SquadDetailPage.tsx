import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Typography, Input, Select, Button, Avatar, Spin, Toast, Modal, Dropdown } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { ChevronRight, Archive, Users, FileText, Plus, Trash2, Crown, ArrowUpRight, Save, Pencil, MoreHorizontal } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Squad, SquadMember, SquadMemberStatus, SquadMemberStatusValue, AssigneeCandidate } from "../api/types";
import {
  getSquad, updateSquad, deleteSquad, addSquadMember, removeSquadMember, updateSquadMemberRole, getSquadMemberStatus,
} from "../api/squadApi";
import { listAssigneeCandidates } from "../api/issueApi";
import { confirmDelete } from "../ui/confirmDelete";
import { StatusDot } from "../ui/StatusDot";
import { formatRelativeTime } from "../ui/time";
import AgentDetailPage from "./AgentDetailPage";
import IssueDetailPage from "./IssueDetailPage";

const { Text } = Typography;

type Tab = "members" | "instructions";

const STATUS_LABEL: Record<SquadMemberStatusValue, string> = {
  working: "loop.squad.statusWorking",
  idle: "loop.squad.statusIdle",
  offline: "loop.squad.statusOffline",
  unstable: "loop.squad.statusUnstable",
  archived: "loop.squad.statusArchived",
};

/**
 * AI小队详情页（对齐 Figma 新版）：
 * 顶部面包屑 + 归档；下方身份区（头像 / 名称·描述内联编辑 / 领队·成员数·创建信息胶囊）；
 * 「成员 / 指引」二级 tab。成员面板：角色内联编辑、设为领队、移除、实时状态与在处理 issue。
 */
export default function SquadDetailPage({ squadId, onChanged }: { squadId: string; onChanged?: () => void }) {
  const { t, format } = useI18n();
  const [row, setRow] = useState<Squad | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("members");
  const [statusList, setStatusList] = useState<SquadMemberStatus[]>([]);

  // identity inline edit（名称走 InlineText，描述走 Modal）
  const [descOpen, setDescOpen] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // instructions draft
  const [instr, setInstr] = useState("");
  const [instrDirty, setInstrDirty] = useState(false);
  const [savingInstr, setSavingInstr] = useState(false);

  // add member dialog
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addPick, setAddPick] = useState<string | undefined>();
  const [addRole, setAddRole] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getSquad(squadId)
      .then((s) => { setRow(s); setInstr(s.instructions ?? ""); setInstrDirty(false); })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
    getSquadMemberStatus(squadId).then(setStatusList).catch(() => setStatusList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId]);
  useEffect(load, [load]);
  useEffect(() => { listAssigneeCandidates().then((cs) => setCands(cs.filter((c) => c.type !== "squad"))).catch(() => setCands([])); }, []);
  // 成员状态非实时推送：面板打开期间每 30s 轮询一次，作为 staleTime 式兜底。
  useEffect(() => {
    const id = window.setInterval(() => { getSquadMemberStatus(squadId).then(setStatusList).catch(() => undefined); }, 30000);
    return () => window.clearInterval(id);
  }, [squadId]);

  const statusById = useMemo(() => {
    const m = new Map<string, SquadMemberStatus>();
    for (const s of statusList) m.set(memberKey(s), s);
    return m;
  }, [statusList]);

  const back = () => WKApp.routeRight.pop();
  const afterMutate = () => { load(); onChanged?.(); };

  // PUT /squads/:id 是全量替换、name 必填；局部编辑需带上当前 name（对齐 AgentDetailPage）。
  const patch = async (p: Parameters<typeof updateSquad>[1]) => {
    if (!row) return;
    await updateSquad(squadId, { name: row.name, ...p });
    afterMutate();
  };

  // InlineText 只在值变化且非空时回调，这里直接提交即可。
  const commitName = async (v: string) => {
    if (!row) return;
    try { await patch({ name: v }); Toast.success(t("loop.toast.saved")); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };
  const saveDesc = async () => {
    if (!row) return;
    setDescOpen(false);
    if (descDraft === (row.description ?? "")) return;
    try { await patch({ description: descDraft }); Toast.success(t("loop.toast.saved")); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };
  const saveInstr = async () => {
    setSavingInstr(true);
    try { await patch({ instructions: instr }); setInstrDirty(false); Toast.success(t("loop.squad.instructionsSaved")); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
    finally { setSavingInstr(false); }
  };

  const archive = () => {
    if (!row) return;
    confirmDelete({
      title: t("loop.squad.archiveConfirm"), content: t("loop.squad.archiveConfirmDesc"),
      okText: t("loop.squad.archive"), cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await deleteSquad(squadId); Toast.success(t("loop.toast.archived")); onChanged?.(); back(); }
        catch (e) { Toast.error((e as Error)?.message ?? "archive failed"); }
      },
    });
  };

  const addMember = async () => {
    if (!addPick) return;
    const c = cands.find((x) => `${x.type}:${x.id}` === addPick);
    if (!c) return;
    setBusy(true);
    try {
      await addSquadMember(squadId, c.type as "agent" | "member", c.id, addRole.trim());
      setAddOpen(false); setAddPick(undefined); setAddRole("");
      afterMutate();
    } catch (e) { Toast.error((e as Error)?.message ?? "add failed"); }
    finally { setBusy(false); }
  };
  const dropMember = async (m: SquadMember) => {
    try { await removeSquadMember(squadId, m.member_type, m.member_id); afterMutate(); }
    catch (e) { Toast.error((e as Error)?.message ?? "remove failed"); }
  };
  const setRole = async (m: SquadMember, role: string) => {
    if ((m.role ?? "") === role.trim()) return;
    try { await updateSquadMemberRole(squadId, m.member_type, m.member_id, role.trim()); afterMutate(); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };
  const setLeader = async (agentId: string) => {
    try { await patch({ leader_id: agentId }); Toast.success(t("loop.toast.saved")); }
    catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
  };

  const openAgent = (id: string) => WKApp.routeRight.push(<AgentDetailPage agentId={id} onChanged={onChanged} />);
  const openIssue = (id: string) => WKApp.routeRight.push(<IssueDetailPage key={id} issueId={id} onChanged={onChanged} />);

  if (loading && !row) return <div className="loop-sqd"><div className="loop-sqd__center"><Spin /></div></div>;
  if (!row) return (
    <div className="loop-sqd">
      <div className="loop-sqd__header"><button className="loop-sqd__crumb" onClick={back}>{t("loop.nav.squad")}</button></div>
      <div className="loop-sqd__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div>
    </div>
  );

  const members = row.members ?? [];
  const isLeader = (m: SquadMember) => m.member_type === "agent" && row.leader_id === m.member_id;
  const availCands = cands.filter((c) => !members.some((m) => memberKey(m) === `${c.type}:${c.id}`));

  return (
    <div className="loop-sqd">
      <div className="loop-sqd__header">
        <button className="loop-sqd__crumb" onClick={back}>{t("loop.nav.squad")}</button>
        <ChevronRight size={13} className="loop-sqd__crumb-sep" />
        <span className="loop-sqd__crumb-cur">{row.name}</span>
        <div className="loop-sqd__header-spacer" />
        <Button theme="outline" type="danger" size="small" icon={<Archive size={14} />} onClick={archive}>{t("loop.squad.archive")}</Button>
      </div>

      <div className="loop-sqd__body">
        {/* 身份区 */}
        <div className="loop-sqd__identity">
          <div className="loop-sqd__avatar">{row.name.slice(0, 1).toUpperCase()}</div>
          <div className="loop-sqd__idmain">
            <InlineText value={row.name} onCommit={commitName} size="large" inputStyle={{ maxWidth: 360 }}>
              {(begin) => (
                <button className="loop-sqd__name" onClick={begin}>
                  {row.name}<Pencil size={13} className="loop-sqd__name-edit" />
                </button>
              )}
            </InlineText>
            <button className="loop-sqd__desc" onClick={() => { setDescDraft(row.description ?? ""); setDescOpen(true); }}>
              {row.description
                ? <span>{row.description}</span>
                : <span className="loop-sqd__desc-empty">{t("loop.squad.descPlaceholder")}</span>}
              <Pencil size={12} className="loop-sqd__desc-edit" />
            </button>
            <div className="loop-sqd__chips">
              <span className="loop-sqd__chip">
                <Crown size={12} />
                <Avatar size="extra-extra-small" color="light-blue" src={row.leader_avatar ?? undefined}>{(row.leader_name ?? "?").slice(0, 1)}</Avatar>
                {row.leader_name ?? "—"}
              </span>
              <span className="loop-sqd__chip"><Users size={12} />{t("loop.squad.membersChip", { values: { count: members.length } })}</span>
              <span className="loop-sqd__chip loop-sqd__chip--plain">
                {t("loop.squad.createdByChip", { values: { name: row.creator_name ?? "—" } })} · {formatRelativeTime(row.created_at, format)}
              </span>
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="loop-sqd__tabs">
          <button className={`loop-sqd__tab ${tab === "members" ? "is-active" : ""}`} onClick={() => setTab("members")}>
            <Users size={14} />{t("loop.squad.tabMembers")}
          </button>
          <button className={`loop-sqd__tab ${tab === "instructions" ? "is-active" : ""}`} onClick={() => setTab("instructions")}>
            <FileText size={14} />{t("loop.squad.tabInstructions")}
          </button>
        </div>

        {tab === "members" ? (
          <div className="loop-sqd__members">
            <div className="loop-sqd__members-head">
              <div className="loop-sqd__members-title">{t("loop.squad.members")}<span className="loop-sqd__members-count">{members.length}</span></div>
              <Button theme="outline" size="small" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>{t("loop.squad.addMember")}</Button>
            </div>
            <div className="loop-sqd__memlist">
              {members.map((m) => {
                const st = statusById.get(memberKey(m));
                const sv = st?.status ?? null;
                const issue = st?.active_issues?.[0];
                const extra = Math.max(0, (st?.active_issues?.length ?? 0) - 1);
                const leader = isLeader(m);
                // 非工作态且无在处理 issue 时，补充「最近活跃」信息。
                const showLast = m.member_type === "agent" && !!sv && sv !== "working" && !issue && !!st?.last_active_at;
                return (
                  <div key={memberKey(m)} className="loop-sqd__mem">
                    <span className="loop-sqd__mem-ava">
                      <Avatar size="small" color="light-blue" src={m.member_avatar ?? undefined}>{(m.member_name ?? "?").slice(0, 1)}</Avatar>
                      {/* Decorative only when the status-line text below states the status word
                          (sv present, no issue shown instead); otherwise this dot is the sole status. */}
                      {m.member_type === "agent" && <StatusDot status={sv ?? "offline"} className="loop-sqd__mem-dot" decorative={!!sv && !issue} />}
                    </span>
                    <div className="loop-sqd__mem-main">
                      <div className="loop-sqd__mem-line">
                        <span className="loop-sqd__mem-name">{m.member_name ?? m.member_id.slice(0, 8)}</span>
                        <span className="loop-sqd__mem-type">{t(`loop.assignee.${m.member_type}`)}</span>
                      </div>
                      <InlineText value={m.role ?? ""} onCommit={(v) => setRole(m, v)} size="small" allowEmpty inputStyle={{ maxWidth: 220, marginTop: 2 }}>
                        {(begin) => (
                          <button type="button" className="loop-sqd__mem-role" onClick={begin}>
                            {m.role || <span className="loop-sqd__mem-role-empty">{t("loop.squad.roleInline")}</span>}
                          </button>
                        )}
                      </InlineText>
                    </div>
                    <div className="loop-sqd__mem-right">
                      {m.member_type === "agent" && (
                        <span className={`loop-sqd__mem-badge${leader ? " is-leader" : ""}`}>
                          {leader && <Crown size={11} />}
                          {t(leader ? "loop.squad.roleLeader" : "loop.squad.roleMember")}
                        </span>
                      )}
                      {m.member_type === "agent" && sv && (
                        <span className="loop-sqd__mem-status">
                          <StatusDot status={sv} className="loop-sqd__mem-dot" decorative />
                          {issue
                            ? <button className="loop-sqd__mem-issue" onClick={() => openIssue(issue.issue_id)}>
                                <span className="loop-sqd__mem-ident">{issue.identifier}</span>
                                <span className="loop-sqd__mem-ititle">{issue.title}</span>
                                {extra > 0 && <span className="loop-sqd__mem-more">{t("loop.squad.activeIssueMore", { values: { count: extra } })}</span>}
                              </button>
                            : <span>{t(STATUS_LABEL[sv])}{showLast ? ` · ${t("loop.squad.lastActive", { values: { time: formatRelativeTime(st!.last_active_at!, format) } })}` : ""}</span>}
                        </span>
                      )}
                      <Dropdown
                        trigger="click"
                        position="bottomRight"
                        clickToHide
                        render={
                          <Dropdown.Menu>
                            {m.member_type === "agent" && (
                              <Dropdown.Item icon={<ArrowUpRight size={13} />} onClick={() => openAgent(m.member_id)}>{t("loop.squad.viewAgent")}</Dropdown.Item>
                            )}
                            {m.member_type === "agent" && !leader && (
                              <Dropdown.Item icon={<Crown size={13} />} onClick={() => setLeader(m.member_id)}>{t("loop.squad.makeLeader")}</Dropdown.Item>
                            )}
                            {!leader && (
                              <Dropdown.Item icon={<Trash2 size={13} />} type="danger" onClick={() => dropMember(m)}>{t("loop.squad.removeMember")}</Dropdown.Item>
                            )}
                          </Dropdown.Menu>
                        }
                      >
                        <Button className="loop-sqd__mem-kebab" theme="borderless" type="tertiary" size="small" icon={<MoreHorizontal size={16} />} />
                      </Dropdown>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="loop-sqd__instr">
            <div className="loop-sqd__instr-head">
              <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.squad.instructionsDesc")}</Text>
              <div className="loop-sqd__instr-actions">
                {instrDirty && <span className="loop-sqd__unsaved">{t("loop.squad.unsaved")}</span>}
                <LoopButton size="sm" icon={<Save size={14} />} disabled={!instrDirty || savingInstr} loading={savingInstr} onClick={saveInstr}>{t("loop.action.save")}</LoopButton>
              </div>
            </div>
            <div className="loop-sqd__editor">
              <textarea className="loop-sqd__ed" value={instr} spellCheck={false}
                onChange={(e) => { setInstr(e.target.value); setInstrDirty(true); }}
                placeholder={t("loop.squad.instructionsPlaceholder")} />
            </div>
          </div>
        )}
      </div>

      <Modal className="loop-modal" title={t("loop.squad.descPlaceholder")} visible={descOpen} onOk={saveDesc} onCancel={() => setDescOpen(false)} okText={t("loop.action.save")} cancelText={t("loop.action.cancel")}>
        <textarea autoFocus className="loop-field-textarea loop-field-textarea--lg" value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder={t("loop.squad.descPlaceholder")} />
      </Modal>

      <Modal className="loop-modal" title={t("loop.squad.addMember")} visible={addOpen} onOk={addMember} onCancel={() => setAddOpen(false)}
        okText={t("loop.squad.add")} cancelText={t("loop.action.cancel")} confirmLoading={busy}
        okButtonProps={{ disabled: !addPick }}>
        <div className="loop-fields">
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.squad.memberPickerPlaceholder")}</div>
            <Select value={addPick} onChange={(v) => setAddPick(v as string)} dropdownClassName="loop-fields__dropdown" filter style={{ width: "100%" }} placeholder={t("loop.squad.memberSearch")}>
              {availCands.map((c) => <Select.Option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>{c.name} · {t(`loop.assignee.${c.type}`)}</Select.Option>)}
            </Select>
          </div>
          <div className="loop-fields__row">
            <div className="loop-fields__label">{t("loop.squad.role")} <span className="loop-detail__section-optional">{t("loop.squad.roleOptional")}</span></div>
            <input className="loop-field" value={addRole} onChange={(e) => setAddRole(e.target.value)} placeholder={t("loop.squad.rolePlaceholder")} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** actor 复合键（type:id），避免 agent 与 member 同 id 撞行。 */
function memberKey(m: { member_type: string; member_id: string }): string {
  return `${m.member_type}:${m.member_id}`;
}

/**
 * 通用内联文本编辑：点击展示态切换为输入框，失焦/回车提交，Esc 取消。
 * committed ref 保证「回车后紧接 blur」只提交一次；仅在值有变化且（非空或允许空）时回调。
 */
function InlineText({ value, onCommit, size, inputStyle, allowEmpty, children }: {
  value: string;
  onCommit: (next: string) => void;
  size: "small" | "large";
  inputStyle?: React.CSSProperties;
  allowEmpty?: boolean;
  children: (begin: () => void) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const committed = useRef(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const begin = () => { committed.current = false; setDraft(value); setEditing(true); };
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const v = draft.trim();
    if (v === value.trim()) return;
    if (!v && !allowEmpty) return;
    onCommit(v);
  };
  const cancel = () => { committed.current = true; setDraft(value); setEditing(false); };
  if (editing) {
    return (
      <Input size={size} autoFocus value={draft} onChange={setDraft}
        onBlur={commit} onEnterPress={commit}
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
        style={inputStyle} />
    );
  }
  return <>{children(begin)}</>;
}
