import React, { useEffect, useState } from "react";
import { Select, Button, Toast, Spin } from "@douyinfe/semi-ui";
import { ArrowLeft, Paperclip, CornerDownLeft } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { AssigneeType, Project } from "../api/types";
import { createIssue } from "../api/issueApi";
import { listProjects } from "../api/projectApi";
import { uploadAttachment } from "../api/attachmentApi";
import AssigneePicker from "../ui/AssigneePicker";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import "./loop.css";
import "../ui/loopControls.css";

export interface NewLoopPageProps {
  /** 创建成功回调（父列表刷新 + toast）。 */
  onCreated?: () => void;
}

// 从 prompt 派生标题：取首个非空行、裁到 ~80 字（其余保留在描述里）。
function deriveTitle(prompt: string): string {
  const line = prompt.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > 80 ? line.slice(0, 80) : line;
}

/**
 * 新建回路独立页（对齐 Figma「把活交给 AI 队友」）：一句话 prompt + 项目/附件 + 指派 AI 队友 → 派单。
 * 映射到现有 createIssue（title 由 prompt 派生，description=prompt，assignee=agent/squad，status=todo 触发派单）。
 * 渲染在右主栏（routeRight.push），返回 pop。
 */
export default function NewLoopPage({ onCreated }: NewLoopPageProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeType, setAssigneeType] = useState<AssigneeType | null>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const back = () => WKApp.routeRight.pop();

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    // 同步捕获:调用点随后 e.target.value="" 会清空 FileList,延迟到 setState 更新函数里读会丢多选。
    const arr = Array.from(files);
    setPendingFiles((p) => [...p, ...arr]);
  };
  const removeFile = (idx: number) => setPendingFiles((p) => p.filter((_, i) => i !== idx));

  const submit = async () => {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      // 附件先上传拿 id（issue 尚不存在），再随 createIssue 绑定。单个失败只提示、不阻断建单。
      let attachmentIds: string[] | undefined;
      if (pendingFiles.length) {
        const ids: string[] = [];
        let failed = 0;
        for (const f of pendingFiles) {
          try { ids.push((await uploadAttachment(f)).id); } catch { failed++; }
        }
        if (failed) Toast.error(t("loop.toast.attachFailed", { values: { count: failed } }));
        if (ids.length) attachmentIds = ids;
      }
      await createIssue({
        title: deriveTitle(text),
        description: text,
        status: "todo",
        priority: "none",
        assignee_id: assigneeId,
        assignee_type: assigneeType,
        project_id: projectId,
        attachment_ids: attachmentIds,
      });
      // 创建成功后由调用方负责导航(pop 回列表 / 切到回路看板)——此处不再自行 back(),
      // 避免与调用方的 replaceToRoot 叠加导致把新根也 pop 掉、右栏变空。
      onCreated?.();
    } catch (e) {
      Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const subtitle = assigneeName
    ? t("loop.newLoop.subtitle", { values: { name: assigneeName } })
    : t("loop.newLoop.subtitleGeneric");

  const examples = [
    { title: t("loop.newLoop.ex1Title"), desc: t("loop.newLoop.ex1Desc"), prompt: t("loop.newLoop.ex1Prompt") },
    { title: t("loop.newLoop.ex2Title"), desc: t("loop.newLoop.ex2Desc"), prompt: t("loop.newLoop.ex2Prompt") },
    { title: t("loop.newLoop.ex3Title"), desc: t("loop.newLoop.ex3Desc"), prompt: t("loop.newLoop.ex3Prompt") },
  ];

  return (
    <div className="loop-page loop-newloop">
      <div className="loop-newloop__bar-top">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>
          {t("loop.detail.back")}
        </Button>
      </div>

      <div className="loop-newloop__inner">
        <div className="loop-newloop__hero">
          <h2 className="loop-newloop__title">{t("loop.newLoop.title")}</h2>
          <p className="loop-newloop__subtitle">{subtitle}</p>
        </div>

        <div className="loop-newloop__composer">
          <AutoGrowTextarea
            className="loop-field-textarea loop-field-textarea--lg loop-field-textarea--auto loop-newloop__input"
            value={prompt}
            onChange={setPrompt}
            placeholder={t("loop.newLoop.placeholder")}
            autoFocus
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          />
          <div className="loop-newloop__composer-bar">
            <div className="loop-newloop__composer-left">
              <Select
                value={projectId ?? undefined}
                onChange={(v) => setProjectId((v as string) ?? null)}
                dropdownClassName="loop-fields__dropdown"
                size="small"
                showClear
                placeholder={t("loop.newLoop.noProject")}
                style={{ width: 150 }}
              >
                {projects.map((p) => (
                  <Select.Option key={p.id} value={p.id}>{p.icon} {p.title}</Select.Option>
                ))}
              </Select>
              <label className="loop-attach-btn" aria-label={t("loop.attach.add")}>
                <Paperclip size={16} />
                <input type="file" multiple hidden disabled={submitting} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            <div className="loop-newloop__composer-right">
              <div className="loop-newloop__assignee">
                <AssigneePicker
                  types={["agent", "squad"]}
                  value={assigneeId}
                  valueName={assigneeName}
                  onChange={(id, type, name) => { setAssigneeId(id); setAssigneeType(type); setAssigneeName(name); }}
                />
              </div>
              <Button theme="solid" loading={submitting} disabled={!prompt.trim()} onClick={submit} icon={<CornerDownLeft size={14} />} iconPosition="right">
                {t("loop.newLoop.dispatch")}
              </Button>
            </div>
          </div>
          {pendingFiles.length > 0 && (
            <div className="loop-atts loop-newloop__atts">
              {pendingFiles.map((f, i) => (
                <span key={i} className="loop-att loop-att--pending">
                  <Paperclip size={12} />
                  <span>{f.name}</span>
                  <button type="button" aria-label={t("loop.action.delete")} onClick={() => removeFile(i)}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="loop-newloop__examples">
          <div className="loop-newloop__examples-head">{t("loop.newLoop.examplesTitle")}</div>
          <div className="loop-newloop__examples-grid">
            {examples.map((ex) => (
              <button key={ex.title} type="button" className="loop-newloop__example" onClick={() => setPrompt(ex.prompt)}>
                <strong>{ex.title}</strong>
                <span>{ex.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {submitting && <div className="loop-newloop__overlay"><Spin /></div>}
    </div>
  );
}
