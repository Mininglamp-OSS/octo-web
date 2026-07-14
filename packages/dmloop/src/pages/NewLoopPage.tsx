import React, { useEffect, useState } from "react";
import { Select, Button, Toast, Spin } from "@douyinfe/semi-ui";
import { ArrowLeft, Paperclip, CornerDownLeft, UserPlus } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { AssigneeType, Project } from "../api/types";
import { quickCreateIssue } from "../api/issueApi";
import { listProjects } from "../api/projectApi";
import { uploadAttachment } from "../api/attachmentApi";
import AssigneePicker from "../ui/AssigneePicker";
import CreateIssueModal from "../ui/CreateIssueModal";
import AutoGrowTextarea from "../ui/AutoGrowTextarea";
import "./loop.css";
import "../ui/loopControls.css";

export interface NewLoopPageProps {
  /** 创建成功回调（父列表刷新 + toast）。 */
  onCreated?: () => void;
}

/**
 * 新建回路独立页（对齐 Figma「把活交给 AI 队友」）：一句话 prompt + 项目/附件 + 指派 AI 队友 → 派单。
 * 派给 agent/squad 恒走 quickCreateIssue(POST /issues/quick-create,建单前查 runtime 在线 + daemon
 * 版本,离线/过旧当场 422,返回 task_id 由 agent 异步建单)。指派器只给 AI(agent/squad),故须选一个
 * AI 队友才能派单——无指派时按钮置灰(无 AI 的回路没人跑,不是本页的意图)。
 * 需指派给「人」时走顶部「手动建单」切换,唤起 CreateIssueModal(title + member/agent/squad 三态 +
 * 状态/优先级,createIssue 同步建单不派单)——对齐上游 quick-create(AI)/manual(可指人)双模式,
 * 上游亦在框内切换而非入口菜单(create-mode-store)。
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
  const [manualOpen, setManualOpen] = useState(false);

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
    // 需 prompt + 指派 AI 队友(agent/squad)。本页只派单,无指派不可提交(按钮已置灰,这里双保险)。
    if (!text || !assigneeId || submitting) return;
    setSubmitting(true);
    try {
      // 附件先上传拿 id（issue 尚不存在），再随派单绑定。
      // 派单流的附件是 agent 的上下文:任一上传失败就整体中止派单(不静默用残缺上下文派单——
      // 异步 fire-and-forget,用户导航走后无法补救),提示重试。全成功才继续。
      let attachmentIds: string[] | undefined;
      if (pendingFiles.length) {
        const ids: string[] = [];
        let failed = 0;
        for (const f of pendingFiles) {
          try { ids.push((await uploadAttachment(f)).id); } catch { failed++; }
        }
        if (failed) {
          Toast.error({ content: t("loop.newLoop.attachFailedAbort", { values: { count: failed } }), duration: 3 });
          return; // finally 会复位 submitting;不派单,用户可重试
        }
        if (ids.length) attachmentIds = ids;
      }
      // 一句话派单 → quick-create:建单前查 runtime 在线 + daemon 版本,离线/过旧当场 422 反馈,
      // 返回 task_id(异步:agent 稍后建单并跑)。assignee 恒为 agent/squad(指派器只给 AI)。
      await quickCreateIssue({
        ...(assigneeType === "squad" ? { squad_id: assigneeId } : { agent_id: assigneeId }),
        prompt: text,
        project_id: projectId,
        attachment_ids: attachmentIds,
      });
      // 单一 toast 归属此处(异步派单的准确措辞);duration 显式设 3s 保证自动消失。
      Toast.success({ content: t("loop.newLoop.dispatched"), duration: 3 });
      // 派单是异步的(agent 稍后建 issue),通知常驻 LoopPage 有界补刷看板,使新回路自动出现(无需手动 reload)。
      // 见 LoopPage 的 wk:loop-issues-dispatched 处理;覆盖看板内/侧栏两个入口。
      WKApp.mittBus.emit("wk:loop-issues-dispatched");
      // 成功后由调用方负责导航(切回回路看板)——此处不再自行 back(),避免叠加把新根 pop 掉。
      onCreated?.();
    } catch (e) {
      // quick-create 结构化 422:LoopApiError.code 映射成友好提示(即时失败反馈)。
      const err = e as { code?: string; message?: string };
      const msg =
        err.code === "agent_unavailable" ? t("loop.newLoop.agentUnavailable")
        : err.code === "daemon_version_unsupported" ? t("loop.newLoop.daemonUnsupported")
        : (err.message ?? t("loop.toast.saveFailed"));
      Toast.error({ content: msg, duration: 3 });
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
        {/* 指派给「人」→ 切到手动建单(CreateIssueModal 支持 member/agent/squad),对齐上游框内切换。 */}
        <Button icon={<UserPlus size={14} />} theme="borderless" onClick={() => setManualOpen(true)} style={{ marginLeft: "auto" }}>
          {t("loop.newLoop.manualSwitch")}
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
              <Button theme="solid" loading={submitting} disabled={!prompt.trim() || !assigneeId} onClick={submit} icon={<CornerDownLeft size={14} />} iconPosition="right">
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

      {/* 手动建单(可指派给人):顶层建单,无 parentIssueId;成功后复用同一 onCreated 回落看板。
          成功 toast 归此处的调用方(对齐 AI 派单路 + IssueDetailPage 约定:CreateIssueModal 自身不弹,
          由调用方弹「已创建」;单弹一次,不与派单路重复)。 */}
      <CreateIssueModal
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={() => { setManualOpen(false); Toast.success({ content: t("loop.toast.created"), duration: 3 }); onCreated?.(); }}
      />
    </div>
  );
}
