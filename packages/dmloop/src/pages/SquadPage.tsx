import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Button, Table, Avatar, Spin, Modal, Toast, Popconfirm, TextArea } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Squad } from "../api/types";
import { listSquads, createSquad, deleteSquad } from "../api/squadApi";
import SquadDetailPage from "../panel/SquadDetailPage";

const { Title, Text } = Typography;

export default function SquadPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    listSquads({ keyword }).then(setRows).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<SquadDetailPage squadId={id} onChanged={reload} />);

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    await createSquad({ name: nName.trim(), description: nDesc });
    setCreateOpen(false); setNName(""); setNDesc("");
    Toast.success(t("loop.toast.created")); reload();
  };
  const remove = async (id: string) => { await deleteSquad(id); Toast.success(t("loop.toast.deleted")); reload(); };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: Squad) => (
      <span className="loop-cell-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }} onClick={() => openDetail(r.id)}>
        <Avatar size="extra-small" color="purple"><Users size={14} /></Avatar>
        <span><div>{v}</div><Text type="tertiary" style={{ fontSize: 12 }}>{r.description}</Text></span>
      </span>) },
    { title: t("loop.squad.leader"), dataIndex: "leader_name", width: 150 },
    { title: t("loop.squad.members"), dataIndex: "members", width: 110, render: (_v: unknown, r: Squad) => <Text>{r.members.length}</Text> },
    { title: t("loop.field.creator"), dataIndex: "creator_name", width: 130 },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Popconfirm title={t("loop.confirm.delete")} onConfirm={() => remove(v)}><Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} /></Popconfirm> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.squad")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.squad")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t("loop.action.newSquad")}</Button>
      </div>
      <div className="loop-page__body">
        {loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Users size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.squadTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.squadDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>{t("loop.action.newSquad")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>
      <Modal title={t("loop.action.newSquad")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><div className="loop-detail__section-title">{t("loop.field.name")}</div><Input autoFocus value={nName} onChange={setNName} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><TextArea value={nDesc} onChange={setNDesc} autosize={{ minRows: 2, maxRows: 5 }} /></div>
        </div>
      </Modal>
    </div>
  );
}
