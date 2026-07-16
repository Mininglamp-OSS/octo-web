import React, { useEffect, useMemo, useRef, useState } from "react";
import { Typography, Button, Spin, Toast, Tooltip } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { ChevronRight, Archive, Save, Eraser, Plus, Trash2, FileText, Pencil, Eye } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Agent, AgentTask, AgentContribution, Issue, RuntimeDevice } from "../api/types";
import { getAgent, updateAgent, listAgentTasks, getAgentContributions, archiveAgent, setAgentSkills, listRuntimesForAgent } from "../api/agentApi";
import { listAssigneeCandidates } from "../api/directory";
import { getIssue } from "../api/issueApi";
import { listSkills } from "../api/skillApi";
import { isActiveRun, isTerminalRun, normalizeAgentStatus } from "../ui/meta";
import { StatusDot } from "../ui/StatusDot";
import InlineEdit from "../ui/InlineEdit";
import RuntimePicker from "./RuntimePicker";
import ModelPicker from "./ModelPicker";
import { formatRelativeTime, formatDurationMs } from "../ui/time";
import { confirmDelete } from "../ui/confirmDelete";
import LoopMarkdown from "../ui/LoopMarkdown";
import SkillAddDialog from "./SkillAddDialog";
import IssueDetailPage from "./IssueDetailPage";
import "./agentDetail.css";

const { Text } = Typography;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

type TopTab = "profile" | "config";
type ConfigSection = "instructions" | "connectors" | "skills";

function triggerKey(task: AgentTask): "triggerComment" | "triggerAutopilot" | "triggerChat" | "triggerManual" {
  if (task.kind === "comment") return "triggerComment";
  if (task.kind === "autopilot") return "triggerAutopilot";
  if (task.kind === "chat") return "triggerChat";
  if (task.kind === "quick_create" || task.kind === "direct") return "triggerManual";
  if (task.trigger_comment_id || task.issue_id) return "triggerComment";
  if (task.autopilot_run_id) return "triggerAutopilot";
  if (task.chat_session_id) return "triggerChat";
  return "triggerManual";
}

// 贡献格颜色分级（阈值 0/1/5/10/20 → 5 级）。
function contribLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}

/**
 * AI队友详情页（对齐 Figma 新版）：
 * 顶部面包屑 + 状态胶囊 + 归档；下方「档案 / 配置」一级 tab。
 * 档案 = 活动概览（近 30 天运行统计 + 热力图 + 履历）+ 右侧只读信息栏（仅档案存在）。
 * 配置 = 通栏：左侧子导航（Instructions / 连接器(MCP) / 技能）+ 主面板；技能支持完整增删。
 */
export default function AgentDetailPage({
  agentId,
  onChanged,
}: {
  agentId: string;
  onChanged?: () => void;
}) {
  const { t, format } = useI18n();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [contribs, setContribs] = useState<AgentContribution[]>([]);
  const [issueMap, setIssueMap] = useState<Record<string, Issue>>({});

  const [tab, setTab] = useState<TopTab>("profile");
  const [section, setSection] = useState<ConfigSection>("instructions");

  // 运行时列表（供属性栏运行环境下拉切换 + 回填名字/在线状态）
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  // 当前用户的 member_id（octo_uid===loginInfo.uid），供运行时下拉 Mine/All 与锁定判定，与 Squad 页一致。
  const [myMemberId, setMyMemberId] = useState<string | null>(null);

  // instructions draft
  const [instr, setInstr] = useState("");
  const [instrDirty, setInstrDirty] = useState(false);
  const [instrMode, setInstrMode] = useState<"edit" | "preview">("edit");

  // connectors (mcp_config) draft
  const [mcpText, setMcpText] = useState("");
  const [mcpDirty, setMcpDirty] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  // skills management
  const [wsSkillCount, setWsSkillCount] = useState(0);
  const [skillDlgOpen, setSkillDlgOpen] = useState(false);
  const [skillBusy, setSkillBusy] = useState(false);

  const syncDrafts = (a: Agent) => {
    setInstr(a.instructions);
    setInstrDirty(false);
    setMcpText(a.mcp_config == null ? "" : JSON.stringify(a.mcp_config, null, 2));
    setMcpDirty(false);
    setMcpError(null);
  };

  useEffect(() => {
    setLoading(true);
    getAgent(agentId)
      .then((a) => { setAgent(a); syncDrafts(a); })
      .catch(() => Toast.error(t("loop.detail.notFound")))
      .finally(() => setLoading(false));
    listAgentTasks(agentId).then(setTasks).catch(() => setTasks([]));
    getAgentContributions(agentId).then(setContribs).catch(() => setContribs([]));
    listSkills().then((s) => setWsSkillCount(s.length)).catch(() => setWsSkillCount(0));
    listRuntimesForAgent().then(setRuntimes).catch(() => setRuntimes([]));
    const uid = WKApp.loginInfo?.uid;
    if (uid) {
      listAssigneeCandidates()
        .then((cs) => setMyMemberId(cs.find((c) => c.type === "member" && c.octo_uid === uid)?.id ?? null))
        .catch(() => setMyMemberId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // updateAgent 返回的 agent 不带回填字段（runtime_name/owner_*）；合并旧值并按 runtime_id 从
  // 已加载的 runtimes 重算 runtime_name，避免就地编辑后属性栏丢失运行环境名字与在线点。
  const mergeAgentDisplayFields = (next: Agent) => {
    setAgent((prev) => ({
      ...next,
      runtime_name: runtimes.find((r) => r.id === next.runtime_id)?.name ?? prev?.runtime_name ?? next.runtime_name ?? null,
      owner_name: next.owner_name ?? prev?.owner_name ?? null,
      owner_avatar: next.owner_avatar ?? prev?.owner_avatar ?? null,
    }));
  };

  const patch = async (p: Parameters<typeof updateAgent>[1]) => {
    if (!agent) return;
    const next = await updateAgent(agent.id, { name: agent.name, ...p });
    mergeAgentDisplayFields(next);
    onChanged?.();
  };

  const refreshAgent = async () => {
    const a = await getAgent(agentId);
    setAgent(a);
    onChanged?.();
  };

  const back = () => WKApp.routeRight.pop();

  const doArchive = () => {
    if (!agent) return;
    confirmDelete({
      title: t("loop.agent.archiveConfirm"),
      okText: t("loop.agent.archive"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try {
          await archiveAgent(agent.id);
          Toast.success(t("loop.toast.archived"));
          onChanged?.();
          back();
        } catch (e) { Toast.error((e as Error)?.message ?? "archive failed"); }
      },
    });
  };

  const saveInstr = async () => {
    await patch({ instructions: instr });
    setInstrDirty(false);
    Toast.success(t("loop.toast.saved"));
  };

  const saveMcp = async () => {
    const raw = mcpText.trim();
    if (!raw) {
      await patch({ mcp_config: null });
      setMcpDirty(false); setMcpError(null);
      Toast.success(t("loop.toast.saved"));
      return;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { setMcpError(t("loop.agent.connectorsInvalidJson")); return; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setMcpError(t("loop.agent.connectorsMustBeObject")); return;
    }
    await patch({ mcp_config: parsed });
    setMcpText(JSON.stringify(parsed, null, 2));
    setMcpDirty(false); setMcpError(null);
    Toast.success(t("loop.toast.saved"));
  };

  const removeSkill = async (skillId: string) => {
    if (!agent) return;
    setSkillBusy(true);
    try {
      await setAgentSkills(agent.id, (agent.skills ?? []).filter((s) => s.id !== skillId).map((s) => s.id));
      await refreshAgent();
    } catch (e) { Toast.error((e as Error)?.message ?? t("loop.toast.saveFailed")); }
    finally { setSkillBusy(false); }
  };

  const addSkills = async (mergedIds: string[]) => {
    if (!agent) return;
    await setAgentSkills(agent.id, mergedIds);
    await refreshAgent();
    Toast.success(t("loop.toast.saved"));
  };

  // ---- 档案统计（近 30 天，复用 /tasks） ----
  const stats = useMemo(() => {
    const now = Date.now();
    const start = now - WINDOW_DAYS * DAY_MS;
    const win = tasks.filter((x) => new Date(x.created_at).getTime() >= start);
    const terminal = win.filter((x) => isTerminalRun(x.status));
    const completed = terminal.filter((x) => x.status === "completed").length;
    const successPct = terminal.length ? Math.round((completed / terminal.length) * 100) : 100;
    const durs = win
      .filter((x) => x.started_at && x.completed_at)
      .map((x) => new Date(x.completed_at as string).getTime() - new Date(x.started_at as string).getTime())
      .filter((d) => Number.isFinite(d) && d > 0);
    const avgMs = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
    const recent = terminal
      .slice()
      .sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime())
      .slice(0, 20);
    return { totalRuns: win.length, successPct, avgMs, terminalCount: terminal.length, recent };
  }, [tasks]);

  // ---- 贡献日历：裁成完整的 7×N 长方形（丢掉最旧的不足一列的余数，保留最新的整列） ----
  const weeks = useMemo(() => {
    const rem = contribs.length % 7;
    const trimmed = rem ? contribs.slice(rem) : contribs;
    const cols: AgentContribution[][] = [];
    for (let i = 0; i < trimmed.length; i += 7) cols.push(trimmed.slice(i, i + 7));
    return cols;
  }, [contribs]);

  // 贡献日历默认滚到最右（最新）：小屏放不下会横向溢出，用户只关心最近，故进页面对齐最新一列。
  const calRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = calRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks, tab]);

  // ---- 履历标题/跳转：按 issue_id 二次拉取 issue（标题取 issue.title） ----
  useEffect(() => {
    const ids = Array.from(new Set(stats.recent.map((r) => r.issue_id).filter(Boolean)));
    const missing = ids.filter((id) => !(id in issueMap));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) => getIssue(id).then((iss) => [id, iss] as const).catch(() => null)),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, Issue> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      if (Object.keys(next).length) setIssueMap((prev) => ({ ...prev, ...next }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.recent]);

  const runTitle = (r: AgentTask): string => {
    const iss = r.issue_id ? issueMap[r.issue_id] : undefined;
    if (iss?.title) return iss.title;
    if (r.trigger_summary?.trim()) return r.trigger_summary.trim();
    if (r.issue_id) return r.issue_id.slice(0, 8);
    return t("loop.agent.untitledRun");
  };

  const openIssue = (issueId: string) =>
    WKApp.routeRight.push(<IssueDetailPage key={issueId} issueId={issueId} onChanged={onChanged} />);

  if (loading && !agent) {
    return <div className="loop-adp"><div className="loop-adp__center"><Spin /></div></div>;
  }
  if (!agent) {
    return (
      <div className="loop-adp">
        <div className="loop-adp__header">
          <Button theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        </div>
        <div className="loop-adp__center"><Text type="tertiary">{t("loop.detail.notFound")}</Text></div>
      </div>
    );
  }

  const skills = agent.skills ?? [];
  const activeCount = tasks.filter((x) => isActiveRun(x.status)).length;
  // 属性仅归属人可改（agent 对工作区其他人可见但只读）。
  const canEdit = !!agent.owner_id && agent.owner_id === myMemberId;

  return (
    <div className="loop-adp">
      {/* 顶部：面包屑 + 状态胶囊 + 归档 */}
      <div className="loop-adp__header">
        <button className="loop-adp__crumb" onClick={back}>{t("loop.nav.agent")}</button>
        <ChevronRight size={13} className="loop-adp__crumb-sep" />
        <span className="loop-adp__crumb-cur">{agent.name}</span>
        <span className="loop-adp__pill">
          <StatusDot status={agent.status} decorative />
          {`${t(`loop.agentStatus.${normalizeAgentStatus(agent.status)}`)} · ${t("loop.agent.taskCount", { values: { count: activeCount } })}`}
        </span>
        <div className="loop-adp__header-spacer" />
        <Button theme="outline" size="small" icon={<Archive size={14} />} onClick={doArchive}>{t("loop.agent.archive")}</Button>
      </div>

      <div className="loop-adp__body">
        <div className="loop-adp__main">
          <div className="loop-adp__toptabs">
            <button className={`loop-adp__toptab ${tab === "profile" ? "is-active" : ""}`} onClick={() => setTab("profile")}>{t("loop.agent.tabProfile")}</button>
            <button className={`loop-adp__toptab ${tab === "config" ? "is-active" : ""}`} onClick={() => setTab("config")}>{t("loop.agent.tabConfig")}</button>
          </div>

          {tab === "profile" ? (
            <div className="loop-adp__profile">
              <div className="loop-adp__statcard">
                <div className="loop-adp__statmain">
                  <div className="loop-adp__statnum">{stats.totalRuns}</div>
                  <div className="loop-adp__statunit">{t("loop.agent.runsUnit")}</div>
                  <div className="loop-adp__statsub">
                    {t("loop.agent.successAvg", { values: { pct: stats.successPct, avg: formatDurationMs(stats.avgMs) } })}
                  </div>
                </div>
                <div className="loop-adp__cal" ref={calRef}>
                  {weeks.map((w, wi) => (
                    <div key={wi} className="loop-adp__cal-col">
                      {w.map((d) => (
                        <Tooltip key={d.date} content={t("loop.agent.contribTip", { values: { date: d.date, count: d.count } })} position="top">
                          <i className="loop-adp__cal-cell" data-level={contribLevel(d.count)} />
                        </Tooltip>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="loop-adp__section">
                <div className="loop-adp__section-head">
                  <span className="loop-adp__section-title">{t("loop.agent.history")}</span>
                  <span className="loop-adp__section-count">{t("loop.agent.execCount", { values: { count: stats.terminalCount } })}</span>
                </div>
                {stats.recent.length === 0 ? (
                  <Text type="tertiary" style={{ fontSize: 13 }}>{t("loop.agent.historyEmpty")}</Text>
                ) : (
                  <div className="loop-adp__runs">
                    {stats.recent.map((r) => (
                      <div
                        key={r.id}
                        className={`loop-adp__run ${r.issue_id ? "is-link" : ""}`}
                        onClick={r.issue_id ? () => openIssue(r.issue_id) : undefined}
                        role={r.issue_id ? "button" : undefined}
                        tabIndex={r.issue_id ? 0 : undefined}
                        onKeyDown={r.issue_id ? (e) => { if (e.key === "Enter") openIssue(r.issue_id); } : undefined}
                      >
                        <i className="loop-adp__run-dot" data-status={r.status} />
                        <span className="loop-adp__run-title">{runTitle(r)}</span>
                        <span className="loop-adp__run-trigger">{t(`loop.agent.${triggerKey(r)}`)}</span>
                        <span className="loop-adp__run-time">
                          {formatRelativeTime(r.completed_at ?? r.created_at, format)}
                          {r.started_at && r.completed_at
                            ? ` · ${formatDurationMs(new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="loop-adp__config">
              <nav className="loop-adp__subnav">
                <button className={`loop-adp__subnav-item ${section === "instructions" ? "is-active" : ""}`} onClick={() => setSection("instructions")}>{t("loop.agent.instructionsTitle")}</button>
                <button className={`loop-adp__subnav-item ${section === "connectors" ? "is-active" : ""}`} onClick={() => setSection("connectors")}>{t("loop.agent.connectors")}</button>
                <button className={`loop-adp__subnav-item ${section === "skills" ? "is-active" : ""}`} onClick={() => setSection("skills")}>{t("loop.agent.skills")}</button>
              </nav>

              <div className="loop-adp__panel">
                {section === "instructions" && (
                  <>
                    <div className="loop-adp__panel-head">
                      <span className="loop-adp__panel-title">{t("loop.agent.instructionsTitle")}</span>
                      <div className="loop-adp__panel-actions">
                        <div className="loop-adp__modes" role="tablist">
                          <button type="button" className={`loop-adp__mode ${instrMode === "edit" ? "is-active" : ""}`} onClick={() => setInstrMode("edit")}>
                            <Pencil size={13} />{t("loop.skill.detail.edit")}
                          </button>
                          <button type="button" className={`loop-adp__mode ${instrMode === "preview" ? "is-active" : ""}`} onClick={() => setInstrMode("preview")}>
                            <Eye size={13} />{t("loop.skill.detail.preview")}
                          </button>
                        </div>
                        <LoopButton size="sm" icon={<Save size={14} />} disabled={!instrDirty} onClick={saveInstr}>{t("loop.action.save")}</LoopButton>
                      </div>
                    </div>
                    <div className="loop-adp__editor">
                      {instrMode === "preview" ? (
                        <div className="loop-adp__ed-preview"><LoopMarkdown content={instr || t("loop.skill.detail.noContent")} /></div>
                      ) : (
                        <textarea
                          className="loop-adp__ed"
                          value={instr}
                          onChange={(e) => { setInstr(e.target.value); setInstrDirty(true); }}
                          placeholder={t("loop.agent.instructionsPlaceholder")}
                          spellCheck={false}
                        />
                      )}
                    </div>
                  </>
                )}

                {section === "connectors" && (
                  <>
                    <div className="loop-adp__panel-head">
                      <span className="loop-adp__panel-title">{t("loop.agent.connectors")}</span>
                      <div className="loop-adp__panel-actions">
                        {!agent.mcp_config_redacted && mcpText.trim() && (
                          <Button theme="borderless" size="small" icon={<Eraser size={14} />} onClick={() => { setMcpText(""); setMcpDirty(true); setMcpError(null); }}>{t("loop.agent.clear")}</Button>
                        )}
                        <LoopButton size="sm" icon={<Save size={14} />} disabled={!mcpDirty || !!agent.mcp_config_redacted} onClick={saveMcp}>{t("loop.action.save")}</LoopButton>
                      </div>
                    </div>
                    {agent.mcp_config_redacted ? (
                      <div className="loop-adp__panel-scroll"><Text type="tertiary" style={{ fontSize: 13 }}>{t("loop.agent.connectorsRedacted")}</Text></div>
                    ) : (
                      <div className="loop-adp__editor">
                        <textarea
                          className="loop-adp__ed"
                          value={mcpText}
                          onChange={(e) => { setMcpText(e.target.value); setMcpDirty(true); setMcpError(null); }}
                          placeholder={t("loop.agent.connectorsPlaceholder")}
                          spellCheck={false}
                        />
                        {mcpError && <div className="loop-adp__ed-error">{mcpError}</div>}
                      </div>
                    )}
                  </>
                )}

                {section === "skills" && (
                  <>
                    <div className="loop-adp__panel-head">
                      <span className="loop-adp__panel-title">{t("loop.agent.skills")}</span>
                      {skills.length > 0 && (
                        <LoopButton size="sm" icon={<Plus size={14} />} disabled={wsSkillCount === 0} onClick={() => setSkillDlgOpen(true)}>{t("loop.agent.addSkill")}</LoopButton>
                      )}
                    </div>
                    <div className="loop-adp__panel-scroll">
                      {skills.length === 0 ? (
                        <div className="loop-adp__skills-empty">
                          <FileText size={32} className="loop-adp__skills-empty-ico" />
                          <div className="loop-adp__skills-empty-title">{t("loop.agent.skillsEmptyTitle")}</div>
                          <div className="loop-adp__skills-empty-hint">{t("loop.agent.skillsEmptyHint")}</div>
                          <LoopButton size="sm" icon={<Plus size={14} />} disabled={wsSkillCount === 0} onClick={() => setSkillDlgOpen(true)} style={{ marginTop: 12 }}>{t("loop.agent.addSkill")}</LoopButton>
                        </div>
                      ) : (
                        <div className="loop-adp__skills-list">
                          {skills.map((s) => (
                            <div key={s.id} className="loop-adp__skill-row">
                              <FileText size={15} className="loop-adp__skill-ico" />
                              <span className="loop-adp__skill-main">
                                <span className="loop-adp__skill-name">{s.name}</span>
                                {s.description && <span className="loop-adp__skill-desc">{s.description}</span>}
                              </span>
                              <Button theme="borderless" type="danger" size="small" disabled={skillBusy} icon={<Trash2 size={14} />} onClick={() => removeSkill(s.id)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右侧只读信息栏：仅「档案」tab 存在 */}
        {tab === "profile" && (
          <aside className="loop-adp__aside">
            <div className="loop-adp__identity">
              <div className="loop-adp__ins-avatar">
                <span>{agent.name.slice(0, 1).toUpperCase()}</span>
                <StatusDot status={agent.status} className="loop-adp__ins-dot" />
              </div>
              <div className="loop-adp__ins-name">
                <InlineEdit
                  value={agent.name}
                  placeholder={t("loop.agent.namePlaceholder")}
                  ariaLabel={t("loop.field.name")}
                  canEdit={canEdit}
                  onSave={(v) => (v ? patch({ name: v }) : undefined)}
                />
              </div>
              <div className="loop-adp__ins-desc">
                <InlineEdit
                  value={agent.description ?? ""}
                  placeholder={t("loop.agent.noDescription")}
                  ariaLabel={t("loop.field.description")}
                  kind="textarea"
                  canEdit={canEdit}
                  onSave={(v) => patch({ description: v })}
                />
              </div>
            </div>

            <div className="loop-adp__aside-sec">
              <div className="loop-adp__aside-title">{t("loop.detail.properties")}</div>
              <dl className="loop-adp__props">
                <dt>{t("loop.agent.runtime")}</dt>
                <dd>
                  <RuntimePicker
                    value={agent.runtime_id}
                    runtimes={runtimes}
                    currentUserId={myMemberId ?? null}
                    canEdit={canEdit}
                    onChange={(id) => patch({ runtime_id: id })}
                  />
                </dd>
                <dt>{t("loop.agent.model")}</dt>
                <dd>
                  <ModelPicker value={agent.model ?? ""} canEdit={canEdit} onChange={(v) => patch({ model: v })} />
                </dd>
                <dt>{t("loop.agent.concurrency")}</dt>
                <dd>
                  <InlineEdit
                    value={String(agent.max_concurrent_tasks)}
                    placeholder="1"
                    ariaLabel={t("loop.agent.concurrency")}
                    kind="number"
                    min={1}
                    canEdit={canEdit}
                    onSave={(v) => {
                      const n = Number(v);
                      return Number.isFinite(n) && n >= 1 ? patch({ max_concurrent_tasks: n }) : undefined;
                    }}
                  />
                </dd>
              </dl>
            </div>

            <div className="loop-adp__aside-sec">
              <div className="loop-adp__aside-title">{t("loop.agent.detailsSection")}</div>
              <dl className="loop-adp__props">
                <dt>{t("loop.agent.owner")}</dt>
                <dd className="loop-adp__owner">
                  {agent.owner_name && <span className="loop-adp__owner-ava">{agent.owner_name.slice(0, 1).toUpperCase()}</span>}
                  {agent.owner_name ?? "—"}
                </dd>
                <dt>{t("loop.dateField.created_at")}</dt>
                <dd>{formatRelativeTime(agent.created_at, format)}</dd>
                <dt>{t("loop.dateField.updated_at")}</dt>
                <dd>{formatRelativeTime(agent.updated_at, format)}</dd>
              </dl>
            </div>

            <div className="loop-adp__aside-sec">
              <div className="loop-adp__aside-title">
                {t("loop.agent.skills")} <span className="loop-adp__aside-count">{skills.length}</span>
              </div>
              {skills.length === 0 ? (
                <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.agent.noSkills")}</Text>
              ) : (
                <div className="loop-adp__aside-chips">
                  {skills.map((s) => <span key={s.id} className="loop-adp__aside-chip">{s.name}</span>)}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <SkillAddDialog
        visible={skillDlgOpen}
        attachedIds={skills.map((s) => s.id)}
        onClose={() => setSkillDlgOpen(false)}
        onConfirm={addSkills}
      />
    </div>
  );
}
