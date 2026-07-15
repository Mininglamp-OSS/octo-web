import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Typography, Input, Button, Spin, Modal, Toast, Banner,
  Select, Checkbox, Tooltip, Popover,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Sparkles, Download, FileText, Link2, Copy, Clock3, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Agent, Skill, Workspace, RuntimeDevice, RuntimeLocalSkillSummary } from "../api/types";
import {
  listSkills, createSkill, deleteSkill, importSkill,
  fetchRuntimeSkills, importRuntimeSkill,
} from "../api/skillApi";
import { listAgents } from "../api/agentApi";
import { listWorkspaces } from "../api/workspaceApi";
import { listRuntimes } from "../api/runtimeApi";
import SkillDetailPage from "../panel/SkillDetailPage";
import { confirmDelete } from "../ui/confirmDelete";
import LoopTag from "../ui/LoopTag";
import LoopButton from "../ui/LoopButton";
import { isValidSkillName } from "../ui/skillName";
import { ensureSkillFrontmatter, parseFrontmatter } from "../ui/frontmatter";
import { formatRelativeTime } from "../ui/time";

const { Title, Text } = Typography;
type CreateTab = "local" | "web" | "runtime";

export default function SkillPage() {
  const { t, format } = useI18n();
  const [rows, setRows] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<CreateTab>("local");

  // local
  const [nName, setNName] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nContent, setNContent] = useState("");
  // web
  const [webUrl, setWebUrl] = useState("");
  const [webBusy, setWebBusy] = useState(false);
  // runtime
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);
  const [rtId, setRtId] = useState<string | undefined>();
  const [rtBusy, setRtBusy] = useState(false);
  const [rtSkills, setRtSkills] = useState<RuntimeLocalSkillSummary[]>([]);
  const [rtErr, setRtErr] = useState<string | null>(null);
  const [rtPicked, setRtPicked] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      listSkills(),
      listAgents().catch(() => [] as Agent[]),
      listWorkspaces().catch(() => [] as Workspace[]),
    ])
      .then(([sk, ag, ws]) => { setRows(sk); setAgents(ag); setWorkspaces(ws); })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  // workspace_id → 展示名映射，用于 hover 时标注 agent 属于哪个工作空间。
  const workspaceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) m.set(w.id, w.name);
    return m;
  }, [workspaces]);

  // 每个 skill 被哪些 AI队友引用：由 agents 的 skills 反向折叠得到。
  // 只统计「未归档」的 agent（archived_at 为空），归档的不计入使用数。
  const usedBy = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of agents) {
      if (a.archived_at) continue; // 已归档 agent 不计入引用
      for (const s of a.skills ?? []) {
        const arr = m.get(s.id);
        if (arr) arr.push(a); else m.set(s.id, [a]);
      }
    }
    return m;
  }, [agents]);

  const openDetail = (id: string) => WKApp.routeRight.push(<SkillDetailPage skillId={id} onChanged={reload} />);
  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = row.name?.toLowerCase() ?? "";
      const desc = row.description?.toLowerCase() ?? "";
      return name.includes(q) || desc.includes(q);
    });
  }, [keyword, rows]);

  const openCreate = () => {
    setCreateOpen(true);
    setCreateTab("local");
    setNName(""); setNDesc(""); setNContent(""); setWebUrl("");
    setRtSkills([]); setRtPicked(new Set()); setRtErr(null);
    listRuntimes().then((rs) => { setRuntimes(rs); if (rs[0]) setRtId(rs[0].id); }).catch(() => setRuntimes([]));
  };

  const createLocal = async () => {
    const skillName = nName.trim();
    if (!skillName) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!isValidSkillName(skillName)) { Toast.warning(t("loop.skill.namePattern")); return; }
    const content = ensureSkillFrontmatter(skillName, nDesc.trim(), nContent);
    const frontmatter = parseFrontmatter(content).frontmatter;
    const frontmatterName = frontmatter?.name?.trim() || skillName;
    if (!isValidSkillName(frontmatterName)) { Toast.warning(t("loop.skill.namePattern")); return; }
    const frontmatterDesc = frontmatter?.description?.trim() ?? "";
    try { await createSkill({ name: frontmatterName, description: frontmatterDesc, content }); setCreateOpen(false); Toast.success(t("loop.toast.created")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "create failed"); }
  };
  const importFromWeb = async () => {
    if (!webUrl.trim()) { Toast.warning(t("loop.skill.urlRequired")); return; }
    setWebBusy(true);
    try { await importSkill(webUrl.trim()); setCreateOpen(false); Toast.success(t("loop.toast.created")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "import failed"); }
    finally { setWebBusy(false); }
  };
  const loadRuntimeSkills = async () => {
    if (!rtId) return;
    setRtBusy(true); setRtErr(null); setRtSkills([]); setRtPicked(new Set());
    try {
      const res = await fetchRuntimeSkills(rtId);
      if (!res.supported) setRtErr(t("loop.skill.rtUnsupported"));
      else if (res.error) setRtErr(res.error);
      else setRtSkills(res.skills);
    } catch (e) { setRtErr((e as Error)?.message ?? "failed"); }
    finally { setRtBusy(false); }
  };
  const importFromRuntime = async () => {
    if (!rtId || rtPicked.size === 0) return;
    setRtBusy(true);
    try {
      let ok = 0;
      for (const key of rtPicked) {
        const sk = rtSkills.find((s) => s.key === key);
        if (sk?.name && !isValidSkillName(sk.name)) {
          Toast.warning(t("loop.skill.importInvalidName", { values: { name: sk.name } }));
          continue;
        }
        const res = await importRuntimeSkill(rtId, key, sk?.name);
        if (res.status === "completed" || res.skill) ok += 1;
      }
      setCreateOpen(false);
      Toast.success(`${t("loop.skill.imported")} (${ok})`);
      reload();
    } catch (e) { Toast.error((e as Error)?.message ?? "import failed"); }
    finally { setRtBusy(false); }
  };
  const remove = async (id: string) => {
    try { await deleteSkill(id); Toast.success(t("loop.toast.deleted")); reload(); }
    catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
  };

  // 渲染 skill 的「被谁使用」徽标：0 个显示未使用；>0 个显示数量 + hover 弹出
  // 具体的 [工作空间] · agent 列表（按 workspace 分组）。
  const renderUsedBy = (skillId: string) => {
    const list = usedBy.get(skillId) ?? [];
    if (list.length === 0) {
      return <span className="loop-skill-list__used loop-skill-list__used--empty"><Users size={13} />{t("loop.skill.unused")}</span>;
    }
    // 按 workspace 分组
    const groups = new Map<string, Agent[]>();
    for (const a of list) {
      const arr = groups.get(a.workspace_id);
      if (arr) arr.push(a); else groups.set(a.workspace_id, [a]);
    }
    const popContent = (
      <div className="loop-skill-used-pop">
        {Array.from(groups.entries()).map(([wsId, ags]) => (
          <div key={wsId} className="loop-skill-used-pop__group">
            <div className="loop-skill-used-pop__ws">{workspaceName.get(wsId) ?? t("loop.skill.unknownWorkspace")}</div>
            {ags.map((a) => (
              <div key={a.id} className="loop-skill-used-pop__agent">
                <span className="loop-skill-used-pop__avatar">{a.name.trim().slice(0, 1).toUpperCase() || "A"}</span>
                <span className="loop-skill-used-pop__name">{a.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
    return (
      <Popover content={popContent} position="bottomLeft" showArrow>
        <span
          className="loop-skill-list__used"
          onClick={(e) => e.stopPropagation()}
        >
          <Users size={13} />{t("loop.skill.usedCount", { values: { count: list.length } })}
        </span>
      </Popover>
    );
  };

  return (
    <div className="loop-page">
      <div className="loop-skill-page-head">
        <div className="loop-skill-page-head__row">
          <div className="loop-skill-page-head__title">
            <Title heading={4}>{t("loop.nav.skill")}</Title>
            <Text type="tertiary" className="loop-skill-page-head__desc">{t("loop.empty.skillDesc")}</Text>
          </div>
          <LoopButton icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newSkill")}</LoopButton>
        </div>
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.skill")}
          value={keyword}
          onChange={setKeyword}
          showClear
          className="loop-skill-page-head__search"
        />
      </div>
      <div className="loop-page__body">
        {error ? <Banner type="danger" description={error} />
          : loading ? <div className="loop-page__center"><Spin /></div>
          : rows.length === 0 ? (
            <div className="loop-empty">
              <Sparkles size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.skillTitle")}</div>
              <div className="loop-empty__desc">{t("loop.empty.skillDesc")}</div>
              <LoopButton icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newSkill")}</LoopButton>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="loop-empty">
              <Sparkles size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.skill")}</div>
            </div>
          ) : (
            <div className="loop-skill-list" role="list">
              {filteredRows.map((row) => {
                const desc = row.description?.trim();
                return (
                  <div key={row.id} className="loop-skill-list__row" role="listitem" onClick={() => openDetail(row.id)}>
                    <div className="loop-skill-list__main">
                      <div className="loop-skill-list__name">{row.name}</div>
                      {desc && (
                        <Tooltip content={<div className="loop-skill-list__tip">{desc}</div>} position="bottomLeft">
                          <div className="loop-skill-list__desc">{desc}</div>
                        </Tooltip>
                      )}
                    </div>
                    <div className="loop-skill-list__meta">
                      {renderUsedBy(row.id)}
                      <span className="loop-skill-list__time"><Clock3 size={13} />{formatRelativeTime(row.updated_at ?? row.created_at, format)}</span>
                      <Button
                        theme="borderless"
                        type="danger"
                        size="small"
                        icon={<Trash2 size={14} />}
                        className="loop-skill-list__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete({
                            title: t("loop.confirm.delete"),
                            okText: t("loop.action.delete"),
                            cancelText: t("loop.action.cancel"),
                            onOk: () => remove(row.id),
                          });
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <Modal
        className="loop-modal"
        visible={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        width={760}
        bodyStyle={{ padding: 0 }}
        title={
          <div className="loop-nsk__head">
            <div className="loop-nsk__head-title">{t("loop.action.newSkill")}</div>
            <div className="loop-nsk__head-sub">{t("loop.skill.create.subtitle")}</div>
          </div>
        }
      >
        <div className="loop-nsk">
          <div className="loop-nsk__body">
            {/* 左侧：tab + 表单 */}
            <div className="loop-nsk__form">
              <div className="loop-nsk__tabs" role="tablist">
                <button type="button" className={`loop-nsk__tab${createTab === "local" ? " is-active" : ""}`} onClick={() => setCreateTab("local")}>
                  <FileText size={14} />{t("loop.skill.create.draft")}
                </button>
                <button type="button" className={`loop-nsk__tab${createTab === "web" ? " is-active" : ""}`} onClick={() => setCreateTab("web")}>
                  <Link2 size={14} />{t("loop.skill.create.url")}
                </button>
                <button type="button" className={`loop-nsk__tab${createTab === "runtime" ? " is-active" : ""}`} onClick={() => setCreateTab("runtime")}>
                  <Copy size={14} />{t("loop.skill.create.runtime")}
                </button>
              </div>

              {createTab === "local" && (
                <div className="loop-nsk__fields">
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.field.name")}</label>
                    <input className="loop-field" value={nName} onChange={(e) => setNName(e.target.value)} placeholder={t("loop.field.name")} />
                  </div>
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.field.description")}</label>
                    <input className="loop-field" value={nDesc} onChange={(e) => setNDesc(e.target.value)} placeholder={t("loop.field.descriptionPlaceholder")} />
                  </div>
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.skill.content")}</label>
                    <textarea className="loop-field-textarea loop-field-textarea--lg" value={nContent} onChange={(e) => setNContent(e.target.value)} placeholder={t("loop.skill.content")} spellCheck={false} />
                  </div>
                </div>
              )}

              {createTab === "web" && (
                <div className="loop-nsk__fields">
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.skill.create.urlLabel")}</label>
                    <input className="loop-field" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="https://clawhub.ai/owner/skill" />
                  </div>
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.skill.create.supportedSources")}</label>
                    <div className="loop-nsk__sources">
                      <div className="loop-nsk__source"><strong>ClawHub</strong><small>clawhub.ai/owner/skill</small></div>
                      <div className="loop-nsk__source"><strong>Skills.sh</strong><small>skills.sh/owner/skill</small></div>
                      <div className="loop-nsk__source"><strong>GitHub</strong><small>github.com/owner/repo</small></div>
                    </div>
                  </div>
                </div>
              )}

              {createTab === "runtime" && (
                <div className="loop-nsk__fields">
                  <div className="loop-nsk__rtbar">
                    <Select value={rtId} onChange={(v) => setRtId(v as string)} dropdownClassName="loop-fields__dropdown" style={{ flex: 1 }} placeholder={t("loop.agent.runtime")}>
                      {runtimes.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}（{r.provider}）</Select.Option>)}
                    </Select>
                    <Button loading={rtBusy} onClick={loadRuntimeSkills}>{t("loop.skill.fetch")}</Button>
                  </div>
                  {rtErr && <Banner type="warning" description={rtErr} closeIcon={null} />}
                  {rtBusy && rtSkills.length === 0 && !rtErr && <div className="loop-nsk__rtloading"><Spin /></div>}
                  {rtSkills.length > 0 && (
                    <div className="loop-skill-rtlist">
                      {rtSkills.map((s) => (
                        <label key={s.key} className="loop-skill-rtitem">
                          <Checkbox
                            checked={rtPicked.has(s.key)}
                            onChange={(e) => {
                              const next = new Set(rtPicked);
                              if (e.target.checked) next.add(s.key); else next.delete(s.key);
                              setRtPicked(next);
                            }}
                          />
                          <span className="loop-skill-rtitem__main">
                            <strong>{s.name}</strong>
                            {s.description && <small>{s.description}</small>}
                          </span>
                          {s.provider && <LoopTag tone="grey">{s.provider}</LoopTag>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 右侧：实时预览 */}
            <div className="loop-nsk__preview">
              <div className="loop-nsk__preview-label">{t("loop.skill.create.preview")}</div>
              <div className="loop-nsk__preview-card">
                <div className="loop-nsk__preview-top">
                  <span className="loop-nsk__preview-ico">
                    {createTab === "local" ? <FileText size={20} /> : createTab === "web" ? <Link2 size={20} /> : <Copy size={20} />}
                  </span>
                  <span className="loop-nsk__preview-badge">
                    {createTab === "local" ? t("loop.skill.create.draft") : createTab === "web" ? t("loop.skill.create.url") : t("loop.skill.create.runtime")}
                  </span>
                </div>
                {createTab === "local" && (
                  <>
                    <div className="loop-nsk__preview-name">{nName.trim() || t("loop.skill.create.unnamed")}</div>
                    {nDesc.trim() && <div className="loop-nsk__preview-desc">{nDesc.trim()}</div>}
                    <div className="loop-nsk__preview-file"><FileText size={13} />SKILL.md</div>
                  </>
                )}
                {createTab === "web" && (
                  <>
                    <div className="loop-nsk__preview-name">{t("loop.skill.create.url")}</div>
                    <div className="loop-nsk__preview-desc">{webUrl.trim() || "https://clawhub.ai/owner/skill"}</div>
                    <div className="loop-nsk__preview-file"><FileText size={13} />SKILL.md</div>
                  </>
                )}
                {createTab === "runtime" && (
                  <>
                    <div className="loop-nsk__preview-name">
                      {runtimes.find((r) => r.id === rtId)?.name || t("loop.skill.create.runtime")}
                    </div>
                    <div className="loop-nsk__preview-desc">
                      {rtPicked.size > 0 ? `${t("loop.skill.importSelected")}（${rtPicked.size}）` : t("loop.skill.fromRuntime")}
                    </div>
                  </>
                )}
              </div>
              <p className="loop-nsk__preview-note">{t("loop.skill.create.previewNote")}</p>
            </div>
          </div>

          {/* 底部操作 */}
          <div className="loop-nsk__footer">
            <Button onClick={() => setCreateOpen(false)}>{t("loop.action.cancel")}</Button>
            {createTab === "local" && (
              <LoopButton icon={<Plus size={14} />} disabled={!nName.trim()} onClick={createLocal}>{t("loop.action.create")}</LoopButton>
            )}
            {createTab === "web" && (
              <LoopButton icon={<Download size={14} />} loading={webBusy} disabled={!webUrl.trim()} onClick={importFromWeb}>{t("loop.skill.import")}</LoopButton>
            )}
            {createTab === "runtime" && (
              <LoopButton icon={<Download size={14} />} loading={rtBusy} disabled={rtPicked.size === 0} onClick={importFromRuntime}>
                {t("loop.skill.importSelected")}（{rtPicked.size}）
              </LoopButton>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
