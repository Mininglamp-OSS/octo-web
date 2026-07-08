import React, { useCallback, useEffect, useState } from "react";
import { Typography, Input, Select, Button, Table, Tag, Spin, Modal, Toast, Popconfirm, TextArea } from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Briefcase } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Project, ProjectStatus, IssuePriority } from "../api/types";
import { listProjects, createProject, deleteProject } from "../api/projectApi";
import ProjectDetailPage from "../panel/ProjectDetailPage";
import { PROJECT_STATUS_ORDER, PROJECT_STATUS_COLOR, PRIORITY_ORDER, PRIORITY_COLOR } from "../ui/meta";
import { confirmDelete } from "../ui/confirmDelete";

const { Title, Text } = Typography;

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="loop-progress">
      <div className="loop-progress__bar"><div className="loop-progress__fill" style={{ width: `${pct}%` }} /></div>
      <Text type="tertiary" style={{ fontSize: 12 }}>{done}/{total}</Text>
    </div>
  );
}

export default function ProjectPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nStatus, setNStatus] = useState<ProjectStatus>("planned");
  const [nPriority, setNPriority] = useState<IssuePriority>("none");

  const reload = useCallback(() => {
    setLoading(true);
    listProjects({ keyword }).then(setRows).finally(() => setLoading(false));
  }, [keyword]);
  useEffect(reload, [reload]);

  const openDetail = (id: string) => WKApp.routeRight.push(<ProjectDetailPage projectId={id} onChanged={reload} />);

  const doCreate = async () => {
    if (!nTitle.trim()) { Toast.warning(t("loop.validate.titleRequired")); return; }
    await createProject({ title: nTitle.trim(), description: nDesc, status: nStatus, priority: nPriority });
    setCreateOpen(false); setNTitle(""); setNDesc("");
    Toast.success(t("loop.toast.created")); reload();
  };
  const remove = async (id: string) => { await deleteProject(id); Toast.success(t("loop.toast.deleted")); reload(); };

  const columns = [
    { title: t("loop.field.name"), dataIndex: "title", render: (v: string, r: Project) => <span className="loop-cell-title" onClick={() => openDetail(r.id)}>{r.icon} {v}</span> },
    { title: t("loop.field.status"), dataIndex: "status", width: 120, render: (v: ProjectStatus) => <Tag color={PROJECT_STATUS_COLOR[v]} size="small">{t(`loop.projectStatus.${v}`)}</Tag> },
    { title: t("loop.field.priority"), dataIndex: "priority", width: 100, render: (v: IssuePriority) => <Tag color={PRIORITY_COLOR[v]} size="small">{t(`loop.priority.${v}`)}</Tag> },
    { title: t("loop.project.progress"), dataIndex: "issue_count", width: 170, render: (_v: number, r: Project) => <Progress done={r.done_count} total={r.issue_count} /> },
    { title: t("loop.project.lead"), dataIndex: "lead_name", width: 120, render: (v: string | null) => <Text>{v ?? "—"}</Text> },
    { title: "", dataIndex: "id", width: 60, render: (v: string) => <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />} onClick={() => confirmDelete({ title: t("loop.confirm.delete"), okText: t("loop.action.delete"), cancelText: t("loop.action.cancel"), onOk: () => remove(v) })} /> },
  ];

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.project")}</Title>
        <div className="loop-page__spacer" />
        <Input prefix={<Search size={14} />} placeholder={t("loop.search.project")} value={keyword} onChange={setKeyword} showClear style={{ width: 220 }} />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t("loop.action.newProject")}</Button>
      </div>
      <div className="loop-page__body">
        {loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Briefcase size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.projectTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.projectDesc")}</div>
              <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>{t("loop.action.newProject")}</Button>
            </div>
          ) : <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" />}
      </div>
      <Modal title={t("loop.action.newProject")} visible={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)} okText={t("loop.action.create")} cancelText={t("loop.action.cancel")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><div className="loop-detail__section-title">{t("loop.field.title")}</div><Input autoFocus value={nTitle} onChange={setNTitle} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.description")}</div><TextArea value={nDesc} onChange={setNDesc} autosize={{ minRows: 2, maxRows: 5 }} /></div>
          <div><div className="loop-detail__section-title">{t("loop.field.status")}</div>
            <Select value={nStatus} onChange={(v) => setNStatus(v as ProjectStatus)} style={{ width: "100%" }}>
              {PROJECT_STATUS_ORDER.map((s) => <Select.Option key={s} value={s}>{t(`loop.projectStatus.${s}`)}</Select.Option>)}
            </Select>
          </div>
          <div><div className="loop-detail__section-title">{t("loop.field.priority")}</div>
            <Select value={nPriority} onChange={(v) => setNPriority(v as IssuePriority)} style={{ width: "100%" }}>
              {PRIORITY_ORDER.map((p) => <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>)}
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
