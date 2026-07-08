import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Button, Table, Tag, Spin, Modal, Toast, Popconfirm, TextArea, Banner } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Sparkles } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Skill } from "../api/types";
import { listSkills, createSkill, deleteSkill, skillSource } from "../api/skillApi";
import SkillDetailPage from "../panel/SkillDetailPage";

const { Title, Text } = Typography;
const SRC: Record<string, "green" | "blue" | "grey"> = { github: "green", local: "blue", workspace: "grey" };

export default function SkillPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nContent, setNContent] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    listSkills({ keyword }).then(setRows).catch((e) => setError(e?.message ?? "load failed")).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<SkillDetailPage skillId={id} onChanged={reload} />);

  const doCreate = async () => {
    if (!nName.trim()) { Toast.warning(t("loop.validate.nameRequired")); return; }
    try {
      await createSkill({ name: nName.trim(), description: nDesc, content: nContent });
      setCreateOpen(false); setNName(""); setNDesc(""); setNContent("");
      Toast.success(t("loop.toast.created")); reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };
  const remove = async (id: string) => {
    try { await deleteSkill(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
  };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "name", render: (v: string, r: Skill) => <span className="loop-cell-title" onClick={() => openDetail(r.id)}>{v}</span> },
    { title: t("loop.field.description"), dataIndex: "description", render: (v: string) => <Text type="tertiary">{v || "—"}</Text> },
    { title: t("loop.skill.source"), dataIndex: "id", width: 120, render: (_v: string, r: Skill) => { const s = skillSource(r); return <Tag color={SRC[s]} size="small">{t(`loop.skill.sourceType.${s}`)}</Tag>; } },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Popconfirm title={t("loop.confirm.delete")} onConfirm={() => remove(v)}><Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} /></Popconfirm> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.skill")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.skill")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t("loop.action.newSkill")}</Button>
      </div>
      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Sparkles size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.skillTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.skillDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>{t("loop.action.newSkill")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>
      <Modal title={t("loop.action.newSkill")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><div className="loop-detail__section-title">{t("loop.field.name")}</div><Input autoFocus value={nName} onChange={setNName} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><Input value={nDesc} onChange={setNDesc} /></div>
          <div><div className="loop-detail__section-title">{t("loop.skill.content")}</div><TextArea value={nContent} onChange={setNContent} autosize={{ minRows: 4, maxRows: 10 }} /></div>
        </div>
      </Modal>
    </div>
  );
}
