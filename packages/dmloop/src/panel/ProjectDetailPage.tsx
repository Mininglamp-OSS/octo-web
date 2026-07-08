import React, { useEffect, useState } from "react";
import { Typography, Input, Select, Button, Spin, Tag, Toast, TextArea } from "@douyinfe/semi-ui";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Project, ProjectStatus, IssuePriority } from "../api/types";
import { getProject, updateProject, deleteProject } from "../api/projectApi";
import { PROJECT_STATUS_ORDER, PROJECT_STATUS_COLOR, PRIORITY_ORDER, PRIORITY_COLOR } from "../ui/meta";
import "./sideDetail.css";

const { Title, Text } = Typography;

/** Project 独立详情页：左侧属性 + 右侧进度/说明。 */
export default function ProjectDetailPage({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const { t } = useI18n();
  const [row, setRow] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    getProject(projectId)
      .then((p) => { setRow(p); setTitle(p.title); setDesc(p.description ?? ""); setDirty(false); })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
  };
  useEffect(load, [projectId]);

  const back = () => WKApp.routeRight.pop();
  const patch = async (p: Parameters<typeof updateProject>[1]) => {
    if (!row) return;
    const next = await updateProject(row.id, { title: p.title ?? row.title, ...p });
    setRow(next);
    onChanged?.();
  };
  const save = async () => {
    if (!title.trim()) { Toast.warning(t("loop.validate.titleRequired")); return; }
    await patch({ title: title.trim(), description: desc });
    setDirty(false);
    Toast.success(t("loop.toast.saved"));
  };
  const remove = async () => { await deleteProject(projectId); Toast.success(t("loop.toast.deleted")); onChanged?.(); back(); };

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (!row) return <div className="loop-sd"><div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div><div className="loop-sd__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div></div>;

  const pct = row.issue_count > 0 ? Math.round((row.done_count / row.issue_count) * 100) : 0;

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{row.icon} {t("loop.detail.projectTitle")}</Text>
        <div style={{ flex: 1 }} />
        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>
        <Button theme="solid" icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</Button>
      </div>
      <div className="loop-sd__body">
        <aside className="loop-sd__aside">
          <div className="loop-detail__section-title">{t("loop.field.title")}</div>
          <Input value={title} onChange={(v) => { setTitle(v); setDirty(true); }} />
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.field.status")}</div>
          <Select value={row.status} style={{ width: "100%" }} size="small" onChange={(v) => patch({ title: row.title, status: v as ProjectStatus })}>
            {PROJECT_STATUS_ORDER.map((s) => <Select.Option key={s} value={s}><Tag color={PROJECT_STATUS_COLOR[s]} size="small">{t(`loop.projectStatus.${s}`)}</Tag></Select.Option>)}
          </Select>
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.field.priority")}</div>
          <Select value={row.priority} style={{ width: "100%" }} size="small" onChange={(v) => patch({ title: row.title, priority: v as IssuePriority })}>
            {PRIORITY_ORDER.map((p) => <Select.Option key={p} value={p}><Tag color={PRIORITY_COLOR[p]} size="small">{t(`loop.priority.${p}`)}</Tag></Select.Option>)}
          </Select>
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.project.lead")}</div>
          <Text>{row.lead_name ?? "—"}</Text>
          <div className="loop-detail__section-title" style={{ marginTop: 14 }}>{t("loop.project.progress")}</div>
          <div className="loop-progress">
            <div className="loop-progress__bar"><div className="loop-progress__fill" style={{ width: `${pct}%` }} /></div>
            <Text type="tertiary" style={{ fontSize: 12 }}>{row.done_count}/{row.issue_count}</Text>
          </div>
        </aside>
        <section className="loop-sd__main">
          <div className="loop-detail__section-title">{t("loop.field.description")}</div>
          <TextArea value={desc} onChange={(v) => { setDesc(v); setDirty(true); }} autosize={{ minRows: 6, maxRows: 20 }} />
        </section>
      </div>
    </div>
  );
}
