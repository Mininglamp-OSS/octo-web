import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Button, Table, Avatar, Select, Spin, Modal, Toast, Popconfirm, TextArea, Banner } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Squad, AssigneeCandidate } from "../api/types";
import { listSquads, createSquad, deleteSquad } from "../api/squadApi";
import { listAssigneeCandidates } from "../api/issueApi";
import SquadDetailPage from "../panel/SquadDetailPage";
import { confirmDelete } from "../ui/confirmDelete";

const { Title, Text } = Typography;

export default function SquadPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nLeader, setNLeader] = useState<string | undefined>();
  const [agents, setAgents] = useState<AssigneeCandidate[]>([]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listSquads({ keyword }).then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<SquadDetailPage squadId={id} onChanged={reload} />);

  const openCreate = () => {
    setCreateOpen(true);
    listAssigneeCandidates().then((cs) => {
      const ags = cs.filter((c) => c.type === "agent");
      setAgents(ags);
      if (ags[0]) setNLeader(ags[0].id);
    }).catch(() => setAgents([]));
  };

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!nLeader) { Toast.warning(t("loop.squad.leaderRequired")); return; }
    try {
      await createSquad({ name: nName.trim(), description: nDesc, leader_id: nLeader });
      setCreateOpen(false); setNName(""); setNDesc("");
      Toast.success(t("loop.toast.created")); reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };
  const remove = async (id: string) => {
    try { await deleteSquad(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
  };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: Squad) => (
      <span className="loop-cell-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }} onClick={() => openDetail(r.id)}>
        <Avatar size="extra-small" color="purple"><Users size={14} /></Avatar>
        <span><div>{v}</div><Text type="tertiary" style={{ fontSize: 12 }}>{r.description}</Text></span>
      </span>) },
    { title: t("loop.squad.leader"), dataIndex: "leader_name", width: 160, render: (v: string | null) => <Text>{v ?? "—"}</Text> },
    { title: t("loop.squad.members"), dataIndex: "member_count", width: 110, render: (v: number | undefined, r: Squad) => <Text>{v ?? (r.members ?? []).length}</Text> },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => confirmDelete({ title: t("loop.confirm.delete"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => remove(v) })} /> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.squad")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.squad")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newSquad")}</Button>
      </div>
      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Users size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.squadTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.squadDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newSquad")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>
      <Modal title={t("loop.action.newSquad")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><div className="loop-detail__section-title">{t("loop.field.name")}</div><Input autoFocus value={nName} onChange={setNName} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><TextArea value={nDesc} onChange={setNDesc} autosize={{ minRows: 2, maxRows: 5 }} /></div>
          <div><div className="loop-detail__section-title">{t("loop.squad.leader")}</div>
            <Select value={nLeader} onChange={(v) => setNLeader(v as string)} style={{ width: "100%" }} placeholder={t("loop.squad.leader")}>
              {agents.map((a) => <Select.Option key={a.id} value={a.id}>{a.name}</Select.Option>)}
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
