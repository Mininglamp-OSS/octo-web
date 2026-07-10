import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Typography, Input, Button, Tag, Spin, Modal, Toast, TextArea, Banner,
  Select, Checkbox, Tooltip,
} from "@douyinfe/semi-ui";
import { Search, Plus, Trash2, Sparkles, Download, FileText, Link2, Copy, Clock3, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { I18nFormatter } from "@octo/base";
import type { Agent, Skill, RuntimeDevice, RuntimeLocalSkillSummary } from "../api/types";
import {
  listSkills, createSkill, deleteSkill, skillSource, importSkill,
  fetchRuntimeSkills, importRuntimeSkill,
} from "../api/skillApi";
import { listAgents } from "../api/agentApi";
import { listRuntimes } from "../api/runtimeApi";
import SkillDetailPage from "../panel/SkillDetailPage";
import { confirmDelete } from "../ui/confirmDelete";
import { isValidSkillName } from "../ui/skillName";
import { ensureSkillFrontmatter, parseFrontmatter } from "../ui/frontmatter";

const { Title, Text } = Typography;
const SRC: Record<string, "green" | "blue" | "grey"> = { github: "green", local: "blue", workspace: "grey" };
type CreateTab = "local" | "web" | "runtime";

function formatSkillTime(value: string | undefined, format: Pick<I18nFormatter, "date" | "relativeTime">): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absDiff < minute) return format.relativeTime(0, "minute");
  if (absDiff < hour) return format.relativeTime(Math.round(diff / minute), "minute");
  if (absDiff < day) return format.relativeTime(Math.round(diff / hour), "hour");
  if (absDiff < 10 * day) return format.relativeTime(Math.round(diff / day), "day");
  return format.date(date, { month: "short", day: "numeric" });
}

export default function SkillPage() {
  const { t, format } = useI18n();
  const [rows, setRows] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
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
    Promise.all([listSkills(), listAgents().catch(() => [] as Agent[])])
      .then(([sk, ag]) => { setRows(sk); setAgents(ag); })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  // 每个 skill 被多少个 AI队友引用：由 agents 的 skills 反向折叠得到。
  const usedByCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) for (const s of a.skills ?? []) m.set(s.id, (m.get(s.id) ?? 0) + 1);
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

  return (
    <div className="loop-page">
      <div className="loop-skill-page-head">
        <div className="loop-skill-page-head__row">
          <div className="loop-skill-page-head__title">
            <Title heading={4}>{t("loop.nav.skill")}</Title>
            <Text type="tertiary" className="loop-skill-page-head__desc">{t("loop.empty.skillDesc")}</Text>
          </div>
          <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate}>{t("loop.action.newSkill")}</Button>
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
              <Button theme="solid" icon={<Plus size={14} />} onClick={openCreate} style={{ marginTop: 12 }}>{t("loop.action.newSkill")}</Button>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="loop-empty">
              <Sparkles size={40} className="loop-empty__icon" />
              <div className="loop-empty__title">{t("loop.empty.skill")}</div>
            </div>
          ) : (
            <div className="loop-skill-list" role="list">
              {filteredRows.map((row) => {
                const src = skillSource(row);
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
                      {(usedByCount.get(row.id) ?? 0) > 0 && (
                        <span className="loop-skill-list__used">
                          <Users size={13} />{t("loop.skill.usedCount", { values: { count: usedByCount.get(row.id) ?? 0 } })}
                        </span>
                      )}
                      <Tag color={SRC[src]} size="small">{t(`loop.skill.sourceType.${src}`)}</Tag>
                      <span className="loop-skill-list__time"><Clock3 size={13} />{formatSkillTime(row.updated_at ?? row.created_at, format)}</span>
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
                    <Input value={nName} onChange={setNName} placeholder={t("loop.field.name")} />
                  </div>
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.field.description")}</label>
                    <Input value={nDesc} onChange={setNDesc} placeholder={t("loop.field.descriptionPlaceholder")} />
                  </div>
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.skill.content")}</label>
                    <TextArea value={nContent} onChange={setNContent} autosize={{ minRows: 5, maxRows: 12 }} />
                  </div>
                </div>
              )}

              {createTab === "web" && (
                <div className="loop-nsk__fields">
                  <div className="loop-nsk__field">
                    <label className="loop-nsk__label">{t("loop.skill.create.urlLabel")}</label>
                    <Input value={webUrl} onChange={setWebUrl} placeholder="https://clawhub.ai/owner/skill" />
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
                    <Select value={rtId} onChange={(v) => setRtId(v as string)} style={{ flex: 1 }} placeholder={t("loop.agent.runtime")}>
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
                          {s.provider && <Tag size="small" color="grey">{s.provider}</Tag>}
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
              <Button theme="solid" icon={<Plus size={14} />} disabled={!nName.trim()} onClick={createLocal}>{t("loop.action.create")}</Button>
            )}
            {createTab === "web" && (
              <Button theme="solid" icon={<Download size={14} />} loading={webBusy} disabled={!webUrl.trim()} onClick={importFromWeb}>{t("loop.skill.import")}</Button>
            )}
            {createTab === "runtime" && (
              <Button theme="solid" icon={<Download size={14} />} loading={rtBusy} disabled={rtPicked.size === 0} onClick={importFromRuntime}>
                {t("loop.skill.importSelected")}（{rtPicked.size}）
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
