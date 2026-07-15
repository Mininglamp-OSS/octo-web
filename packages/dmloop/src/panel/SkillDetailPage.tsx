import React, { useEffect, useMemo, useState } from "react";
import { Typography, Input, Button, Spin, Toast, Banner, Tooltip } from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { ArrowLeft, BookOpen, Clock3, ExternalLink, Save, Trash2, Plus, Users } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { I18nFormatter } from "@octo/base";
import type { Agent, Skill, SkillFile } from "../api/types";
import { getSkill, updateSkill, deleteSkill, skillSource } from "../api/skillApi";
import { listAgents } from "../api/agentApi";
import { confirmDelete } from "../ui/confirmDelete";
import SkillFileTree from "./SkillFileTree";
import SkillFileViewer from "./SkillFileViewer";
import { isValidSkillName } from "../ui/skillName";
import { ensureSkillFrontmatter, parseFrontmatter, setFrontmatterField } from "../ui/frontmatter";
import "./sideDetail.css";

const { Text } = Typography;
const SKILL_MD = "SKILL.md";

type DraftFile = { path: string; content: string };

function toDraftFiles(files?: SkillFile[]): DraftFile[] {
  return (files ?? [])
    .filter((f) => f.path !== SKILL_MD)
    .map((f) => ({ path: f.path, content: f.content }));
}

function formatSkillTime(value: string | undefined, format: Pick<I18nFormatter, "date" | "relativeTime">): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = date.getTime() - Date.now();
  if (!Number.isFinite(diff)) return "-";
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

/** Skill 详情页：左侧文件树 + 右侧多文件编辑器（SKILL.md 映射到 content）。 */
export default function SkillDetailPage({ skillId, onChanged }: { skillId: string; onChanged?: () => void }) {
  const { t, format } = useI18n();
  const [row, setRow] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedAgents, setUsedAgents] = useState<Agent[]>([]);

  const [content, setContent] = useState("");
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [selectedPath, setSelectedPath] = useState(SKILL_MD);
  const [dirty, setDirty] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const [addingFile, setAddingFile] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [addError, setAddError] = useState("");

  const seed = (s: Skill) => {
    setRow(s);
    // 规范化：保证 SKILL.md 一定带合法 frontmatter（name/description），
    // 避免头部缺失导致解析异常，并让下方 name 输入框从头部取值。
    setContent(ensureSkillFrontmatter(s.name, s.description ?? "", s.content ?? ""));
    setFiles(toDraftFiles(s.files));
    setDirty(false);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedPath(SKILL_MD);
    Promise.all([
      getSkill(skillId),
      listAgents().catch(() => [] as Agent[]),
    ])
      .then(([skill, agents]) => {
        seed(skill);
        setUsedAgents(agents.filter((agent) => (agent.skills ?? []).some((sk) => sk.id === skill.id)));
      })
      .catch((e) => setError(e?.message ?? "load failed"))
      .finally(() => setLoading(false));
  }, [skillId]);

  const fileMap = useMemo(() => {
    const map = new Map<string, string>();
    map.set(SKILL_MD, content);
    for (const f of files) if (f.path.trim()) map.set(f.path, f.content);
    return map;
  }, [content, files]);
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap]);
  const selectedContent = fileMap.get(selectedPath) ?? "";
  const skillFrontmatter = useMemo(() => parseFrontmatter(content).frontmatter, [content]);
  // content 为唯一数据源：name/description 都取自 SKILL.md 头部，输入框改动回写头部。
  const nameValue = skillFrontmatter?.name ?? "";
  const skillDescription = skillFrontmatter?.description?.trim() ?? "";

  const onNameChange = (next: string) => {
    setContent((prev) => setFrontmatterField(prev, "name", next));
    setDirty(true);
  };

  useEffect(() => {
    if (selectedPath !== SKILL_MD && !fileMap.has(selectedPath)) setSelectedPath(SKILL_MD);
  }, [fileMap, selectedPath]);

  const back = () => WKApp.routeRight.pop();

  const onFileContentChange = (next: string) => {
    if (selectedPath === SKILL_MD) setContent(next);
    else setFiles((prev) => prev.map((f) => (f.path === selectedPath ? { ...f, content: next } : f)));
    setDirty(true);
  };

  const validateNewPath = (p: string): string => {
    const v = p.trim();
    if (!v) return t("loop.skill.detail.addFile.empty");
    if (v.startsWith("/")) return t("loop.skill.detail.addFile.absolute");
    if (v.split("/").includes("..")) return t("loop.skill.detail.addFile.doubleDot");
    if (v === SKILL_MD) return t("loop.skill.detail.addFile.reserved");
    if (filePaths.includes(v)) return t("loop.skill.detail.addFile.exists");
    return "";
  };

  const submitNewFile = () => {
    const err = validateNewPath(newPath);
    if (err) { setAddError(err); return; }
    const p = newPath.trim();
    setFiles((prev) => [...prev, { path: p, content: "" }]);
    setSelectedPath(p);
    setDirty(true);
    setAddingFile(false);
    setNewPath("");
    setAddError("");
  };

  const cancelNewFile = () => { setAddingFile(false); setNewPath(""); setAddError(""); };

  const deleteSelectedFile = () => {
    if (selectedPath === SKILL_MD) return;
    setFiles((prev) => prev.filter((f) => f.path !== selectedPath));
    setSelectedPath(SKILL_MD);
    setDirty(true);
  };

  const save = async () => {
    const skillName = nameValue.trim();
    if (!skillName) { Toast.warning(t("loop.validate.nameRequired")); return; }
    if (!isValidSkillName(skillName)) { Toast.warning(t("loop.skill.namePattern")); return; }
    try {
      const updated = await updateSkill(skillId, {
        name: skillName,
        description: skillDescription,
        content,
        files: files.filter((f) => f.path.trim() && f.path !== SKILL_MD),
      });
      seed(updated);
      Toast.success(t("loop.toast.saved"));
      onChanged?.();
    } catch (e) {
      Toast.error((e as Error)?.message ?? "save failed");
    }
  };

  const remove = () => {
    confirmDelete({
      title: t("loop.confirm.delete"),
      okText: t("loop.action.delete"),
      cancelText: t("loop.action.cancel"),
      onOk: async () => {
        try { await deleteSkill(skillId); Toast.success(t("loop.toast.deleted")); onChanged?.(); back(); }
        catch (e) { Toast.error((e as Error)?.message ?? "delete failed"); }
      },
    });
  };

  if (loading) return <div className="loop-sd"><div className="loop-sd__center"><Spin /></div></div>;
  if (error || !row) return (
    <div className="loop-sd">
      <div className="loop-sd__topbar"><Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button></div>
      <div className="loop-sd__center">{error ? <Banner type="danger" description={error} /> : <Text type="tertiary">{t("loop.detail.notFound")}</Text>}</div>
    </div>
  );

  const src = skillSource(row);

  return (
    <div className="loop-sd">
      <div className="loop-sd__topbar">
        <Button icon={<ArrowLeft size={16} />} theme="borderless" onClick={back}>{t("loop.detail.back")}</Button>
        <Text type="tertiary" style={{ fontSize: 12 }}>{t("loop.detail.skillTitle")}</Text>
        <div style={{ flex: 1 }} />
        <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={remove}>{t("loop.action.delete")}</Button>
        <LoopButton icon={<Save size={14} />} disabled={!dirty} onClick={save}>{t("loop.action.save")}</LoopButton>
      </div>

      <div className="loop-skill-body">
        <aside className="loop-skill-tree">
          <section className="loop-skill-profile">
            <div className="loop-skill-profile__main">
              <div className="loop-skill-profile__icon"><BookOpen size={18} /></div>
              <div className="loop-skill-profile__copy">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameValue}
                    onBlur={() => setEditingName(false)}
                    onChange={onNameChange}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingName(false); }}
                    placeholder={t("loop.field.name")}
                    className="loop-skill-profile__nameInput"
                  />
                ) : (
                  <button type="button" className="loop-skill-profile__name" onClick={() => setEditingName(true)}>
                    {nameValue || t("loop.field.name")}
                  </button>
                )}
                <Tooltip
                  content={<div className="loop-skill-profile__descTip">{skillDescription || t("loop.skill.detail.noDescription")}</div>}
                  position="bottomLeft"
                >
                  <div className={skillDescription ? "loop-skill-profile__desc" : "loop-skill-profile__desc is-empty"}>
                    {skillDescription || t("loop.skill.detail.noDescription")}
                  </div>
                </Tooltip>
              </div>
            </div>
            <div className="loop-skill-profile__subline">
              <div className="loop-skill-profile__fact">
                <ExternalLink size={12} />
                <span>{t("loop.skill.source")}</span>
                <strong>{t(`loop.skill.sourceType.${src}`)}</strong>
              </div>
              <div className="loop-skill-profile__fact">
                <Clock3 size={12} />
                <span>{t("loop.detail.updated")}</span>
                <strong>{formatSkillTime(row.updated_at, format)}</strong>
              </div>
            </div>
          </section>

          <section className="loop-skill-files">
            <div className="loop-skill-files__head">
              <span className="loop-skill-files__label">{t("loop.skill.detail.files")}（{filePaths.length}）</span>
              <Tooltip content={t("loop.skill.detail.addFile.add")}>
                <Button theme="borderless" size="small" icon={<Plus size={14} />} onClick={() => setAddingFile(true)} />
              </Tooltip>
            </div>
            {addingFile && (
              <div className="loop-skill-files__addfile">
                <Input
                  autoFocus
                  size="small"
                  value={newPath}
                  placeholder={t("loop.skill.detail.addFile.placeholder")}
                  onChange={(v) => { setNewPath(v); setAddError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNewFile(); if (e.key === "Escape") cancelNewFile(); }}
                />
                {addError && <div className="loop-skill-files__adderr">{addError}</div>}
                <div className="loop-skill-files__addbtns">
                  <LoopButton size="sm" onClick={submitNewFile}>{t("loop.skill.detail.addFile.add")}</LoopButton>
                  <Button size="small" theme="borderless" onClick={cancelNewFile}>{t("loop.action.cancel")}</Button>
                </div>
              </div>
            )}
            <div className="loop-skill-files__scroll">
              <SkillFileTree
                filePaths={filePaths}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                emptyText={t("loop.skill.detail.noFiles")}
              />
            </div>
            {selectedPath !== SKILL_MD && (
              <div className="loop-skill-files__foot">
                <Button theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />} onClick={deleteSelectedFile}>
                  {t("loop.skill.detail.deleteFile")}
                </Button>
              </div>
            )}
          </section>

          <section className="loop-skill-agents">
            <div className="loop-skill-agents__head">
              <Users size={13} />
              <span>{t("loop.skill.detail.usedAgents", { values: { count: usedAgents.length } })}</span>
            </div>
            {usedAgents.length > 0 ? (
              <div className="loop-skill-agents__list">
                {usedAgents.map((agent) => (
                  <div key={agent.id} className="loop-skill-agents__item">
                    <span className="loop-skill-agents__avatar">{agent.name.trim().slice(0, 1).toUpperCase() || "A"}</span>
                    <span className="loop-skill-agents__name">{agent.name}</span>
                    <span className="loop-skill-agents__type">{t("loop.skill.detail.agentType")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="loop-skill-agents__empty">{t("loop.skill.detail.noUsedAgents")}</div>
            )}
          </section>
        </aside>

        <section className="loop-skill-editor">
          <div className="loop-skill-editor__viewer">
            <SkillFileViewer key={selectedPath} path={selectedPath} content={selectedContent} onChange={onFileContentChange} />
          </div>
        </section>
      </div>
    </div>
  );
}
