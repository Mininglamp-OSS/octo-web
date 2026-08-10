import React, { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
import { EXPERT_CATEGORIES, EXPERT_WORKSPACE } from "../mock/expertMock";
import type { ExpertAgent, ExpertSkill } from "../mock/expertMock";
import {
  SKILL_PACKAGE_ACCEPT,
  SkillPackageError,
  extractSkillPackage,
} from "../utils/extractSkillPackage";
import { initExpertSkillUpload, uploadSkillFile } from "../api/expertService";

interface ExpertAgentPublishModalProps {
  visible: boolean;
  onClose: () => void;
  onPublish: (agent: ExpertAgent) => void;
  /** When set, the modal edits this expert instead of creating a new one. */
  editing?: ExpertAgent | null;
  /** Category NAMEs fetched from the backend; falls back to the static list. */
  categories?: string[];
}

interface Draft {
  name: string;
  summary: string;
  category: string;
  tags: string[];
  instruction: string;
  mcpConfig: string;
  // Each skill carries the uploaded file's text as `content`; on edit the
  // content isn't returned by the backend (only `hasContent`), so re-uploading
  // is required to change a skill's content.
  skills: ExpertSkill[];
}

// Categories minus the "全部" pseudo bucket — an expert must pick a real one.
// Used as the fallback when the backend category list hasn't loaded.
const FALLBACK_CATEGORIES = EXPERT_CATEGORIES.filter((c) => c !== "全部");

// Placeholder shown in the empty MCP config editor — the canonical mcpServers shape.
const MCP_CONFIG_TEMPLATE = '{\n  "mcpServers": {}\n}';

function createDraft(defaultCategory = FALLBACK_CATEGORIES[0] ?? "营销策划"): Draft {
  return {
    name: "",
    summary: "",
    category: defaultCategory,
    tags: [],
    instruction: "",
    mcpConfig: "",
    skills: [],
  };
}

/** Seed the form from an existing expert when opening in edit mode. */
function draftFrom(agent: ExpertAgent): Draft {
  return {
    name: agent.name,
    summary: agent.summary,
    category: agent.category,
    tags: [...agent.tags],
    instruction: agent.instruction ?? "",
    mcpConfig: agent.mcpConfig ?? "",
    skills: [...(agent.skills ?? [])].map((s) => ({
      name: s.name,
      hasContent: s.hasContent,
      canDownload: s.canDownload,
      fileName: s.fileName,
      fileSize: s.fileSize,
      files: s.files,
    })),
  };
}

/**
 * Manual single-expert publishing form. The 专家 (agent) counterpart to
 * ExpertPublishModal (squads): no members / dispatch strategy — just the basic
 * fields, plus the expert's 指令 (system prompt), MCP servers and uploaded
 * Skills. On submit it builds an ExpertAgent and hands it to onPublish. Each
 * Skill is uploaded as a .zip/.skill package; the SKILL.md inside is extracted
 * client-side and sent as the skill's `content` (stored in object storage).
 */
export default function ExpertAgentPublishModal({
  visible,
  onClose,
  onPublish,
  editing,
  categories,
}: ExpertAgentPublishModalProps) {
  useI18n();
  const realCategories =
    categories && categories.length ? categories : FALLBACK_CATEGORIES;
  const [draft, setDraft] = useState<Draft>(createDraft);
  const [tagInput, setTagInput] = useState("");
  const skillInputRef = useRef<HTMLInputElement | null>(null);
  // Per-upload error (invalid format / too large / no SKILL.md); cleared on the
  // next successful upload or when the modal reopens.
  const [skillError, setSkillError] = useState<string | null>(null);
  // A package upload is in flight (presigned PUT); blocks publish + shows progress.
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const isEditing = Boolean(editing);

  // mcp_config must be valid JSON if provided (matches the backend, which
  // rejects malformed config). Empty is allowed. Blocks publish + flags the hint.
  const mcpConfigInvalid = (() => {
    const raw = draft.mcpConfig.trim();
    if (!raw) return false;
    try {
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  })();

  useEffect(() => {
    if (visible) {
      setDraft(editing ? draftFrom(editing) : createDraft(realCategories[0]));
      setTagInput("");
      setSkillError(null);
      setUploading(false);
      setUploadPct(0);
    }
    // realCategories is derived from the categories prop; re-seeding the empty
    // draft's default category when it changes is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing]);

  const canPublish =
    draft.name.trim().length > 0 &&
    draft.summary.trim().length > 0 &&
    draft.instruction.trim().length > 0 &&
    !mcpConfigInvalid &&
    !uploading;

  // Category options for the select. If the record's current category isn't in
  // the fetched list (deleted category / fallback mismatch), prepend it so the
  // current value always renders and round-trips instead of being silently
  // rewritten to the first option on save.
  const categoryOptions =
    realCategories.includes(draft.category) || !draft.category
      ? realCategories
      : [draft.category, ...realCategories];

  // -------- Skills: upload .zip/.skill packages, extract each SKILL.md --------
  // Mirrors the Skills-marketplace upload contract (a package containing
  // SKILL.md). Invalid/oversized/mis-packaged files surface a visible error
  // instead of being dropped silently.
  const skillErrorMessage = (code: SkillPackageError["code"]): string => {
    const KEY: Record<SkillPackageError["code"], string> = {
      invalidFormat: "mcp.expert.skillErrInvalidFormat",
      fileTooLarge: "mcp.expert.skillErrTooLarge",
      noSkillMd: "mcp.expert.skillErrNoSkillMd",
      contentTooLarge: "mcp.expert.skillErrContentTooLarge",
      readFailed: "mcp.expert.skillErrReadFailed",
    };
    return t(KEY[code]);
  };

  const onSkillFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    const files: File[] = [];
    for (let i = 0; i < (list?.length ?? 0); i += 1) {
      const file = list?.item(i);
      if (file) files.push(file);
    }
    event.target.value = ""; // reset so re-selecting the same file fires onChange
    if (!files.length) return;

    setSkillError(null);
    setUploading(true);
    setUploadPct(0);
    const added: ExpertSkill[] = [];
    let firstError: string | null = null;
    for (const file of files) {
      try {
        // Validate + read name/manifest client-side (fail fast), then upload the
        // raw package to object storage; the create body carries the upload key.
        const extracted = await extractSkillPackage(file);
        const init = await initExpertSkillUpload(file.name, file.size);
        await uploadSkillFile(init.presignedUrl, file, init.headers, setUploadPct);
        added.push({
          name: extracted.name,
          uploadObjectKey: init.uploadObjectKey,
          fileName: file.name,
          fileSize: file.size,
          files: extracted.files,
        });
      } catch (err) {
        const message =
          err instanceof SkillPackageError
            ? `${file.name}: ${skillErrorMessage(err.code)}`
            : `${file.name}: ${t("mcp.expert.skillErrUploadFailed")}`;
        if (!firstError) firstError = message;
      }
    }

    setUploading(false);
    setUploadPct(0);
    setSkillError(firstError);
    if (added.length) {
      setDraft((prev) => {
        // Merge by name: a re-uploaded package REPLACES an existing same-named
        // skill (carrying its new uploadObjectKey) rather than being dropped —
        // otherwise the replacement would silently keep the old package.
        const byName = new Map(prev.skills.map((s) => [s.name, s] as const));
        for (const sk of added) byName.set(sk.name, sk);
        return { ...prev, skills: Array.from(byName.values()) };
      });
    }
  };

  const removeSkill = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };


  // -------- tag chips (type + Enter/逗号 to add, Backspace to remove) --------
  const commitTag = () => {
    const parts = tagInput
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) {
      setDraft((prev) => {
        const set = new Set(prev.tags);
        parts.forEach((tag) => set.add(tag));
        return { ...prev, tags: Array.from(set) };
      });
    }
    setTagInput("");
  };

  const onTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTag();
    } else if (event.key === "Backspace" && !tagInput && draft.tags.length) {
      setDraft((prev) => ({ ...prev, tags: prev.tags.slice(0, -1) }));
    }
  };

  const removeTag = (tag: string) => {
    setDraft((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== tag) }));
  };

  const handlePublish = () => {
    const tags = draft.tags.map((s) => s.trim()).filter(Boolean);
    const shortName =
      Array.from(draft.name.trim()).slice(0, 2).join("") || "专";
    const instruction = draft.instruction.trim() || undefined;
    const mcpConfig = draft.mcpConfig.trim() || undefined;
    const skills = draft.skills.length ? draft.skills : undefined;
    const agent: ExpertAgent = editing
      ? {
          ...editing,
          shortName,
          name: draft.name.trim(),
          summary: draft.summary.trim(),
          category: draft.category,
          tags: tags.length ? tags : ["自定义"],
          instruction,
          mcpConfig,
          skills,
        }
      : {
          id: `custom-agent-${Date.now()}`,
          kind: "agent",
          shortName,
          name: draft.name.trim(),
          summary: draft.summary.trim(),
          category: draft.category,
          tags: tags.length ? tags : ["自定义"],
          publisher: EXPERT_WORKSPACE,
          createdByType: "human",
          creatorName: t("mcp.expert.selfCreator"),
          mine: true,
          instruction,
          mcpConfig,
          skills,
        };
    onPublish(agent);
  };

  const header = (
    <div className="wk-mcp-expert-pub__header">
      <span className="wk-mcp-expert-pub__eyebrow">
        {isEditing ? t("mcp.expert.editAgent") : t("mcp.expert.publishAgent")}
      </span>
      <h2>
        {isEditing
          ? t("mcp.expert.agentEditTitle")
          : t("mcp.expert.agentPublishTitle")}
      </h2>
      <p>
        {isEditing
          ? t("mcp.expert.agentEditHint")
          : t("mcp.expert.agentPublishHint")}
      </p>
    </div>
  );

  const requiredMark = (
    <span className="wk-mcp-expert-pub__req" aria-hidden="true">
      *
    </span>
  );

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      width="min(560px, calc(100vw - 32px))"
      className="wk-mcp-expert-pub"
      header={header}
    >
      <div className="wk-mcp-expert-pub__body">
        <div className="wk-mcp-expert-pub__form">
          <label>
            <span>
              {t("mcp.expert.fieldName")}
              {requiredMark}
            </span>
            <input
              className="wk-mcp-expert-pub__input"
              value={draft.name}
              maxLength={128}
              placeholder={t("mcp.expert.agentNamePlaceholder")}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label>
            <span>
              {t("mcp.expert.fieldSummary")}
              {requiredMark}
            </span>
            <textarea
              className="wk-mcp-expert-pub__textarea"
              rows={2}
              value={draft.summary}
              maxLength={512}
              placeholder={t("mcp.expert.agentSummaryPlaceholder")}
              onChange={(e) => setDraft((p) => ({ ...p, summary: e.target.value }))}
            />
          </label>
          <label>
            <span>{t("mcp.expert.fieldCategory")}</span>
            <select
              className="wk-mcp-expert-pub__input"
              value={draft.category}
              onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
            >
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("mcp.expert.fieldTags")}</span>
            <div className="wk-mcp-expert-pub__tags">
              {draft.tags.map((tag) => (
                <span className="wk-mcp-expert-pub__tag-chip" key={tag}>
                  {tag}
                  <button
                    type="button"
                    aria-label={t("mcp.expert.removeTag")}
                    onClick={() => removeTag(tag)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                className="wk-mcp-expert-pub__tag-field"
                value={tagInput}
                placeholder={
                  draft.tags.length ? "" : t("mcp.expert.fieldTagsPlaceholder")
                }
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={commitTag}
              />
            </div>
          </label>
          <label>
            <span>
              {t("mcp.expert.fieldInstruction")}
              {requiredMark}
            </span>
            <textarea
              className="wk-mcp-expert-pub__textarea"
              rows={4}
              value={draft.instruction}
              placeholder={t("mcp.expert.instructionPlaceholder")}
              onChange={(e) => setDraft((p) => ({ ...p, instruction: e.target.value }))}
            />
          </label>
          <label>
            <span>{t("mcp.expert.fieldMcp")}</span>
            <textarea
              className="wk-mcp-expert-pub__textarea wk-mcp-expert-pub__code"
              rows={6}
              spellCheck={false}
              value={draft.mcpConfig}
              placeholder={MCP_CONFIG_TEMPLATE}
              onChange={(e) => setDraft((p) => ({ ...p, mcpConfig: e.target.value }))}
            />
            <p
              className={
                mcpConfigInvalid
                  ? "wk-mcp-expert-pub__field-hint wk-mcp-expert-pub__field-hint--error"
                  : "wk-mcp-expert-pub__field-hint"
              }
            >
              {mcpConfigInvalid
                ? t("mcp.expert.mcpConfigInvalid")
                : t("mcp.expert.mcpConfigHint")}
            </p>
          </label>
          <label>
            <span>{t("mcp.expert.fieldSkills")}</span>
            <div className="wk-mcp-expert-pub__skills">
              {draft.skills.map((skill, idx) => (
                <span className="wk-mcp-expert-pub__tag-chip" key={`${skill.name}-${idx}`}>
                  {skill.name}
                  <button
                    type="button"
                    aria-label={t("mcp.expert.removeSkill")}
                    onClick={() => removeSkill(idx)}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="wk-mcp-expert-pub__upload"
                onClick={() => skillInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} aria-hidden="true" />
                {uploading
                  ? t("mcp.expert.uploadingSkill", { values: { percent: uploadPct } })
                  : t("mcp.expert.uploadSkill")}
              </button>
              <input
                ref={skillInputRef}
                type="file"
                multiple
                hidden
                accept={SKILL_PACKAGE_ACCEPT}
                onChange={onSkillFiles}
              />
            </div>
            <p
              className={
                skillError
                  ? "wk-mcp-expert-pub__field-hint wk-mcp-expert-pub__field-hint--error"
                  : "wk-mcp-expert-pub__field-hint"
              }
            >
              {skillError ?? t("mcp.expert.skillUploadHint")}
            </p>
          </label>
        </div>
      </div>

      <div className="wk-mcp-expert-pub__footer">
        <span />
        <WKButton variant="primary" disabled={!canPublish} onClick={handlePublish}>
          {isEditing
            ? t("mcp.expert.submitEdit")
            : t("mcp.expert.submitPublishAgent")}
        </WKButton>
      </div>
    </WKModal>
  );
}
