import React, { useEffect, useState } from "react";
import { Typography, Input, Button, Spin, Toast, TextArea } from "@douyinfe/semi-ui";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Project } from "../api/types";
import { getProject, updateProject, deleteProject } from "../api/projectApi";
import ProjectWebhooksSection from "./ProjectWebhooksSection";
import "./sideDetail.css";

const { Text } = Typography;

/** Project 配置面板：名称 + 描述 + Webhook（右侧唤起，不再下钻 issue）。 */
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
  const save = async () => {
    if (!row) return;
    if (!title.trim()) { Toast.warning(t("loop.validate.titleRequired")); return; }
    try {
      const next = await updateProject(row.id, { title: title.trim(), description: desc });
      setRow(next);
      setDirty(false);
      onChanged?.();
      Toast.success(t("loop.toast.saved"));
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    }
  };
  const remove = async () => {
    try {
      await deleteProject(projectId);
      Toast.success(t("loop.toast.deleted"));
      onChanged?.();
      back();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.deleteFailed"));
    }
  };

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (!row) return (
    <div className="loop-sd">
      <div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div>
      <div className="loop-sd__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div>
    </div>
  );

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{row.icon} {t("loop.detail.projectTitle")}</Text>
        <div style={{ flex: 1 }} />
        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>
        <Button theme="solid" icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</Button>
      </div>
      <div className="loop-sd__body" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="loop-sd__main">
          <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div className="loop-detail__section-title">{t("loop.field.name")}</div>
              <Input value={title} onChange={(v) => { setTitle(v); setDirty(true); }} />
            </div>
            <div>
              <div className="loop-detail__section-title">{t("loop.field.description")}</div>
              <TextArea
                value={desc}
                onChange={(v) => { setDesc(v); setDirty(true); }}
                placeholder={t("loop.project.descPlaceholder")}
                autosize={{ minRows: 4, maxRows: 16 }}
              />
              <Text type="tertiary" style={{ fontSize: 12, marginTop: 6, display: "block", lineHeight: 1.5 }}>
                {t("loop.project.descHint")}
              </Text>
            </div>
            <div>
              <div className="loop-detail__section-title">{t("loop.webhook.title")}</div>
              <ProjectWebhooksSection projectId={row.id} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
