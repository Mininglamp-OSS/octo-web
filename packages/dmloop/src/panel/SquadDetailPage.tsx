import React, { useEffect, useState } from "react";
import { Typography, Input, Select, Button, Avatar, Tag, Spin, Toast, TextArea } from "@douyinfe/semi-ui";
import { ArrowLeft, Save, Trash2, UserPlus, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Squad, AssigneeCandidate } from "../api/types";
import { getSquad, updateSquad, deleteSquad, addSquadMember, removeSquadMember } from "../api/squadApi";
import { listAssigneeCandidates } from "../api/issueApi";
import { ASSIGNEE_TYPE_COLOR } from "../ui/meta";
import "./sideDetail.css";

const { Title, Text } = Typography;

/** Squad 独立详情页：左侧资料 + 右侧成员表（增删）。 */
export default function SquadDetailPage({ squadId, onChanged }: { squadId: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const [row, setRow] = useState<Squad | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [instr, setInstr] = useState("");
  const [dirty, setDirty] = useState(false);
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);
  const [addPick, setAddPick] = useState<string | undefined>();

  const load = () => {
    setLoading(true);
    getSquad(squadId)
      .then((s) => { setRow(s); setName(s.name); setDesc(s.description); setInstr(s.instructions); setDirty(false); })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
  };
  useEffect(load, [squadId]);
  useEffect(() => { listAssigneeCandidates().then(setCands); }, []);

  const back = () => WKApp.routeRight.pop();
  const save = async () => {
    if (!name.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    const next = await updateSquad(squadId, { name: name.trim(), description: desc, instructions: instr });
    setRow(next); setDirty(false); Toast.success(t("loop.toast.saved")); onChanged?.();
  };
  const remove = async () => { await deleteSquad(squadId); Toast.success(t("loop.toast.deleted")); onChanged?.(); back(); };
  const addM = async () => {
    if (!addPick) return;
    const cand = cands.find((c) => c.id === addPick);
    if (!cand) return;
    try { const n = await addSquadMember(squadId, cand.type, cand.id); setRow(n); setAddPick(undefined); onChanged?.(); }
    catch (e) { Toast.error((e as Error)?.message ?? "add failed"); }
  };
  const dropM = async (memberType: "member" | "agent" | "squad", mid: string) => {
    try { const n = await removeSquadMember(squadId, memberType, mid); setRow(n); onChanged?.(); }
    catch (e) { Toast.error((e as Error)?.message ?? "remove failed"); }
  };

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (!row) return <div className="loop-sd"><div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div><div className="loop-sd__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div></div>;

  const avail = cands.filter((c) => !(row.members ?? []).some((m) => m.member_id === c.id));

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.detail.squadTitle")}</Text>
        <div style={{ flex: 1 }} />
        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>
        <Button theme="solid" icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</Button>
      </div>
      <div className="loop-sd__body">
        <aside className="loop-sd__aside">
          <div className="loop-sd__identity">
            <Avatar size="large" color="purple" shape="square"><Users size={22} /></Avatar>
          </div>
          <div className="loop-detail__section-title">{t("loop.field.name")}</div>
          <Input value={name} onChange={(v) => { setName(v); setDirty(true); }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.field.description")}</div>
          <Input value={desc} onChange={(v) => { setDesc(v); setDirty(true); }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.squad.instructions")}</div>
          <TextArea value={instr} onChange={(v) => { setInstr(v); setDirty(true); }} autosize={{ minRows: 3, maxRows: 8 }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.squad.leader")}</div>
          <Text>{row.leader_name}</Text>
        </aside>
        <section className="loop-sd__main">
          <div className="loop-detail__section-title">{t("loop.squad.members")} ({(row.members ?? []).length})</div>
          <div className="loop-comments">
            {(row.members ?? []).map((m) => (
              <div key={m.member_id} className="loop-comment" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar size="extra-extra-small" color="light-blue">{(m.member_name ?? "?").slice(0, 1)}</Avatar>
                <Text>{m.member_name}</Text>
                <Tag color={ASSIGNEE_TYPE_COLOR[m.member_type]} size="small">{t(`loop.assignee.${m.member_type}`)}</Tag>
                {m.role === "leader" ? (
                  <Tag color="amber" size="small">{t("loop.squad.roleLeader")}</Tag>
                ) : (
                  <Button theme="borderless" type="danger" size="small" style={{ marginLeft: "auto" }} icon={<Trash2 size={13} />} onClick={() => dropM(m.member_type, m.member_id)} />
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Select placeholder={t("loop.squad.addMember")} value={addPick} onChange={(v) => setAddPick(v as string)} style={{ flex: 1 }} size="small">
              {avail.map((c) => <Select.Option key={c.id} value={c.id}>{c.name} · {t(`loop.assignee.${c.type}`)}</Select.Option>)}
            </Select>
            <Button icon={<UserPlus size={14} />} onClick={addM} disabled={!addPick}>{t("loop.squad.add")}</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
