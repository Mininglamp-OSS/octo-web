import React, { useEffect, useState } from "react";
import { Typography, Button, Spin, Toast } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Project } from "../api/types";
import { getProject, updateProject, deleteProject } from "../api/projectApi";
import ProjectWebhooksSection from "./ProjectWebhooksSection";
import { useIsWorkspaceAdmin } from "../ui/useWorkspaceAdmin";
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
  const isAdmin = useIsWorkspaceAdmin();

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
        {isAdmin && <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>}
        <LoopButton icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</LoopButton>
      </div>
      <div className="loop-sd__body" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="loop-sd__main">
          <div className="loop-fields" style={{ maxWidth: 640 }}>
            <div className="loop-fields__row">
              <div className="loop-fields__label">{t("loop.field.name")}</div>
              <input className="loop-field" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder={t("loop.project.namePlaceholder")} />
            </div>
            <div className="loop-fields__row">
              <div className="loop-fields__label">{t("loop.field.description")}</div>
              <textarea
                className="loop-field-textarea loop-field-textarea--lg"
                value={desc}
                onChange={(e) => { setDesc(e.target.value); setDirty(true); }}
                placeholder={t("loop.project.descPlaceholder")}
              />
              <Text type="tertiary" style={{ fontSize: 12, marginTop: 2, display: "block", lineHeight: 1.5 }}>
                {t("loop.project.descHint")}
              </Text>
            </div>
            <div className="loop-fields__row">
              <div className="loop-fields__label">{t("loop.webhook.title")}</div>
              <ProjectWebhooksSection projectId={row.id} isAdmin={isAdmin} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
