import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { WKApp, WKButton, t, useI18n } from "@octo/base";
import { SkillEditorPage, type SkillDraftForm } from "@dmwork/skillmarket";
import type { ExpertAgent } from "../mock/expertMock";
import {
  createExpert,
  getExpert,
  listExpertCategories,
  materializeSkillDrafts,
  rollbackPlugins,
  updateExpert,
  type ExpertCategoryCount,
  type ExpertMemberDraft,
  type ExpertWriteForm,
} from "../api/expertService";

interface ExpertEditorPageProps {
  /** "create"/"edit" persist a standalone expert; "draft" hands an unsaved
   *  member draft back to the squad editor (no network) — the squad's save
   *  materializes it. */
  mode: "create" | "edit" | "draft";
  /** Required when mode === "edit". */
  expertId?: string;
  /** Seeds "draft" mode when editing an already-added (unsaved) member draft. */
  initialDraft?: ExpertMemberDraft;
  /** "draft" mode: returns the member draft to the squad editor (no network). */
  onDraft?: (draft: ExpertMemberDraft) => void;
  /** "edit" mode child use (e.g. squad editing an EXISTING member): the saved
   *  id+name are handed back and the page pops itself. */
  onCommitted?: (result: { id: string; name: string }) => void;
}

/** A bound skill: an already-persisted plugin, or an unsaved draft created here
 *  and materialized on the expert's save. */
type BoundSkill =
  | { kind: "existing"; pluginId: string; name: string }
  | { kind: "draft"; localId: string; draft: SkillDraftForm };

const skillKey = (s: BoundSkill) => (s.kind === "existing" ? s.pluginId : s.localId);
const skillName = (s: BoundSkill) => (s.kind === "existing" ? s.name : s.draft.displayName);

const TOAST_MS = 2600;

/**
 * Full-page expert (agent) editor. Bound skills are managed as drafts: "新建
 * Skill" opens the skill editor which hands back a draft (nothing persisted),
 * and the expert's save materializes every draft skill first, then creates/
 * updates the expert wired to all its skills — one atomic-ish save, rolled back
 * if a step fails. "draft" mode returns the whole expert as a member draft to
 * the squad editor without persisting anything.
 */
export default function ExpertEditorPage({
  mode,
  expertId,
  initialDraft,
  onDraft,
  onCommitted,
}: ExpertEditorPageProps) {
  useI18n();
  const isEdit = mode === "edit";
  const isDraftMode = mode === "draft";

  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [name, setName] = useState(() => initialDraft?.name ?? "");
  const [summary, setSummary] = useState(() => initialDraft?.summary ?? "");
  const [category, setCategory] = useState(() => initialDraft?.category ?? "");
  const [tags, setTags] = useState<string[]>(() => initialDraft?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [instruction, setInstruction] = useState(() => initialDraft?.instruction ?? "");
  const [mcpConfig, setMcpConfig] = useState(() => initialDraft?.mcpConfig ?? "");
  const [expert, setExpert] = useState<ExpertAgent | null>(null);
  const [skills, setSkills] = useState<BoundSkill[]>(() =>
    initialDraft
      ? [
          ...initialDraft.existingSkillIds.map(
            (pluginId): BoundSkill => ({ kind: "existing", pluginId, name: "" })
          ),
          ...initialDraft.draftSkills.map(
            (draft): BoundSkill => ({ kind: "draft", localId: crypto.randomUUID(), draft })
          ),
        ]
      : []
  );
  const [categories, setCategories] = useState<string[]>([]);
  /** Set once a standalone create succeeds so the page flips to edit-in-place
   *  WITHOUT touching the route stack. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const editingId = expertId ?? createdId ?? undefined;
  const isEditing = isEdit || createdId !== null;

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    let alive = true;
    listExpertCategories("agent")
      .then((cats: ExpertCategoryCount[]) => {
        if (alive) setCategories(cats.map((c) => c.name).filter(Boolean));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    if (!expertId) {
      setLoading(false);
      setError(t("mcp.expert.editor.noExpert"));
      return;
    }
    let alive = true;
    setLoading(true);
    getExpert(expertId)
      .then((e) => {
        if (!alive) return;
        setExpert(e);
        setName(e.name);
        setSummary(e.summary);
        setCategory(e.category);
        setTags(e.tags ?? []);
        setInstruction(e.instruction ?? "");
        setMcpConfig(e.mcpConfig ?? "");
        setSkills(
          (e.skills ?? [])
            .filter((s) => s.pluginId)
            .map((s): BoundSkill => ({ kind: "existing", pluginId: s.pluginId as string, name: s.name }))
        );
        setDirty(false);
      })
      .catch(() => {
        if (alive) setError(t("mcp.expert.editor.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isEdit, expertId]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value || tags.includes(value)) {
      setTagDraft("");
      return;
    }
    setTags([...tags, value]);
    setTagDraft("");
    setDirty(true);
  };
  const removeTag = (tag: string) => {
    setTags(tags.filter((tg) => tg !== tag));
    setDirty(true);
  };

  const addSkill = () => {
    WKApp.routeRight.push(
      <SkillEditorPage
        mode="create"
        onDraft={(draft) => {
          setSkills((prev) => [...prev, { kind: "draft", localId: crypto.randomUUID(), draft }]);
          setDirty(true);
        }}
      />
    );
  };

  const editSkill = (skill: BoundSkill) => {
    if (skill.kind === "existing") {
      WKApp.routeRight.push(
        <SkillEditorPage
          skillId={skill.pluginId}
          onCommitted={({ id, name: skillName }) =>
            setSkills((prev) =>
              prev.map((s) =>
                s.kind === "existing" && s.pluginId === id ? { ...s, name: skillName } : s
              )
            )
          }
        />
      );
      return;
    }
    const localId = skill.localId;
    WKApp.routeRight.push(
      <SkillEditorPage
        mode="create"
        initialDraft={skill.draft}
        onDraft={(draft) => {
          setSkills((prev) =>
            prev.map((s) => (s.kind === "draft" && s.localId === localId ? { ...s, draft } : s))
          );
          setDirty(true);
        }}
      />
    );
  };

  const removeSkill = (key: string) => {
    setSkills((prev) => prev.filter((s) => skillKey(s) !== key));
    setDirty(true);
  };

  const glyph = useMemo(
    () => (name || expert?.shortName || "?").trim().slice(0, 1),
    [name, expert]
  );

  const goBack = () => {
    if (dirty && !window.confirm(t("mcp.expert.editor.leaveConfirm"))) return;
    WKApp.routeRight.pop();
  };

  /** Shared validation for name + mcp.json; returns false (and toasts) if bad. */
  const validate = (): boolean => {
    if (!name.trim()) {
      showToast(t("mcp.expert.editor.nameRequired"));
      return false;
    }
    if (mcpConfig.trim()) {
      try {
        JSON.parse(mcpConfig);
      } catch {
        showToast(t("mcp.expert.editor.mcpInvalid"));
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (saving) return;
    if (!validate()) return;

    // Draft mode (squad member): hand the whole expert back as a draft, no network.
    if (isDraftMode) {
      onDraft?.({
        name: name.trim(),
        summary,
        category: category || undefined,
        tags,
        instruction,
        mcpConfig,
        existingSkillIds: skills.filter((s) => s.kind === "existing").map((s) => s.pluginId),
        draftSkills: skills.filter((s) => s.kind === "draft").map((s) => s.draft),
      });
      WKApp.routeRight.pop();
      return;
    }

    const draftEntries = skills.filter(
      (s): s is Extract<BoundSkill, { kind: "draft" }> => s.kind === "draft"
    );
    const existingIds = skills
      .filter((s): s is Extract<BoundSkill, { kind: "existing" }> => s.kind === "existing")
      .map((s) => s.pluginId);

    setSaving(true);
    let createdSkillIds: string[] = [];
    try {
      // Materialize draft skills first (private, unpublished), then wire them.
      createdSkillIds = await materializeSkillDrafts(draftEntries.map((d) => d.draft));
      const form: ExpertWriteForm = {
        name: name.trim(),
        summary,
        category: category || undefined,
        tags,
        instruction,
        mcpConfig,
        skillIds: [...existingIds, ...createdSkillIds],
      };

      let committedId: string;
      if (isEditing && editingId) {
        const updated = await updateExpert(editingId, form);
        setExpert(updated);
        committedId = editingId;
      } else {
        const { id } = await createExpert(form);
        setCreatedId(id);
        committedId = id;
      }

      // Convert now-persisted drafts into existing entries so a subsequent save
      // doesn't re-create them.
      const idByLocal = new Map(draftEntries.map((d, i) => [d.localId, createdSkillIds[i]]));
      setSkills((prev) =>
        prev.map((s) =>
          s.kind === "draft"
            ? { kind: "existing", pluginId: idByLocal.get(s.localId) as string, name: s.draft.displayName }
            : s
        )
      );

      if (onCommitted) {
        onCommitted({ id: committedId, name: form.name });
        WKApp.routeRight.pop();
        return;
      }
      setDirty(false);
      showToast(t("mcp.expert.editor.saved"));
    } catch (err) {
      // Roll back any skills created before the expert save failed.
      if (createdSkillIds.length) await rollbackPlugins(createdSkillIds);
      showToast(err instanceof Error ? err.message : t("mcp.expert.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const title = name || (isEditing ? expert?.name : t("mcp.expert.editor.createTitle"));

  return (
    <div className="wk-mcp-expert-editor">
      <header className="wk-mcp-expert-editor__topbar">
        <div className="wk-mcp-expert-editor__crumb">
          <button
            type="button"
            className="wk-mcp-expert-editor__back"
            onClick={goBack}
            aria-label={t("mcp.expert.editor.returnToMarket")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("mcp.expert.editor.returnToMarket")}
          </button>
          <span className="wk-mcp-expert-editor__crumb-sep">/</span>
          <b className="wk-mcp-expert-editor__crumb-title">{title}</b>
        </div>
        <WKButton
          variant="primary"
          icon={<Save size={15} />}
          loading={saving}
          disabled={loading || (isEditing && !dirty)}
          onClick={save}
        >
          {t("mcp.expert.editor.save")}
        </WKButton>
      </header>

      {loading ? (
        <div className="wk-mcp-expert-editor__state">{t("mcp.expert.editor.loading")}</div>
      ) : error ? (
        <div className="wk-mcp-expert-editor__state wk-mcp-expert-editor__state--error" role="alert">
          <span>{error}</span>
          <WKButton onClick={goBack}>{t("mcp.expert.editor.returnToMarket")}</WKButton>
        </div>
      ) : (
        <div className="wk-mcp-expert-editor__body">
          <section className="wk-mcp-expert-editor__hero">
            <div className="wk-mcp-expert-editor__avatar" aria-hidden="true">
              {glyph}
            </div>
            <div className="wk-mcp-expert-editor__hero-main">
              <input
                className="wk-mcp-expert-editor__title-input"
                value={name}
                maxLength={40}
                placeholder={t("mcp.expert.editor.namePlaceholder")}
                aria-label={t("mcp.expert.editor.editName")}
                onChange={(e) => mark(setName)(e.target.value)}
              />
              <textarea
                className="wk-mcp-expert-editor__desc-input"
                value={summary}
                rows={2}
                placeholder={t("mcp.expert.editor.descPlaceholder")}
                aria-label={t("mcp.expert.editor.editDesc")}
                onChange={(e) => mark(setSummary)(e.target.value)}
              />
            </div>
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.expert.editor.basicInfo")}
              </div>
            </div>
            <div className="wk-mcp-expert-editor__fields">
              <label className="wk-mcp-expert-editor__field">
                <span>{t("mcp.expert.editor.category")}</span>
                <select
                  value={category}
                  onChange={(e) => mark(setCategory)(e.target.value)}
                >
                  <option value="">{t("mcp.expert.editor.categoryPlaceholder")}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wk-mcp-expert-editor__field">
                <span>{t("mcp.expert.editor.tags")}</span>
                <div className="wk-mcp-expert-editor__tags">
                  {tags.map((tag) => (
                    <span key={tag} className="wk-mcp-expert-editor__tag">
                      {tag}
                      <button
                        type="button"
                        aria-label={t("mcp.expert.editor.removeTag", { values: { name: tag } })}
                        onClick={() => removeTag(tag)}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    placeholder={t("mcp.expert.editor.tagPlaceholder")}
                    aria-label={t("mcp.expert.editor.tags")}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    onBlur={addTag}
                  />
                </div>
              </label>
            </div>
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.expert.instructionTitle")}
              </div>
              <span className="wk-mcp-expert-editor__chip">Markdown</span>
            </div>
            <textarea
              className="wk-mcp-expert-editor__code"
              value={instruction}
              spellCheck={false}
              placeholder={t("mcp.expert.editor.instructionHint")}
              aria-label={t("mcp.expert.instructionTitle")}
              onChange={(e) => mark(setInstruction)(e.target.value)}
            />
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.expert.mcpTitle")}
              </div>
              <span className="wk-mcp-expert-editor__chip">JSON</span>
            </div>
            <textarea
              className="wk-mcp-expert-editor__code"
              value={mcpConfig}
              spellCheck={false}
              placeholder={t("mcp.expert.editor.mcpHint")}
              aria-label={t("mcp.expert.mcpTitle")}
              onChange={(e) => mark(setMcpConfig)(e.target.value)}
            />
          </section>

          <section className="wk-mcp-expert-editor__block">
            <div className="wk-mcp-expert-editor__block-head">
              <div className="wk-mcp-expert-editor__block-title">
                {t("mcp.expert.skillsTitle")}
              </div>
              <WKButton icon={<Plus size={15} />} onClick={addSkill}>
                {t("mcp.expert.editor.newSkill")}
              </WKButton>
            </div>
            {skills.length ? (
              <div className="wk-mcp-expert-editor__resource-list">
                {skills.map((skill) => (
                  <div key={skillKey(skill)} className="wk-mcp-expert-editor__resource">
                    <span className="wk-mcp-expert-editor__resource-name">
                      {skillName(skill)}
                    </span>
                    <div className="wk-mcp-expert-editor__resource-actions">
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.expert.editor.editSkill", { values: { name: skillName(skill) } })}
                        onClick={() => editSkill(skill)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {t("mcp.expert.editor.edit")}
                      </button>
                      <button
                        type="button"
                        className="wk-mcp-expert-editor__member-link"
                        aria-label={t("mcp.expert.editor.removeSkill", { values: { name: skillName(skill) } })}
                        onClick={() => removeSkill(skillKey(skill))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t("mcp.expert.editor.remove")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wk-mcp-expert-editor__empty">
                {t("mcp.expert.editor.noSkills")}
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="wk-mcp-expert-editor__toast">{toast}</div>}
    </div>
  );
}
