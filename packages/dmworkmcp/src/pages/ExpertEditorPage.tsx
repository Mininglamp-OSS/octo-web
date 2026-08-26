import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, X } from "lucide-react";
import { WKApp, WKButton, t, useI18n } from "@octo/base";
import type { ExpertAgent } from "../mock/expertMock";
import {
  createExpert,
  getExpert,
  listExpertCategories,
  updateExpert,
  type ExpertCategoryCount,
  type ExpertWriteForm,
} from "../api/expertService";

interface ExpertEditorPageProps {
  mode: "create" | "edit";
  /** Required when mode === "edit". */
  expertId?: string;
  /** When set, this editor is a CHILD of another editor (e.g. the squad editor
   *  creating a member). On a successful save the id+name are handed back and
   *  the page pops itself, instead of the standalone edit-in-place behavior. */
  onCommitted?: (result: { id: string; name: string }) => void;
  /** Forwarded to createExpert — squad members pass false so the member expert
   *  is not scene-published (kept out of the expert discovery lists). */
  publishToScene?: boolean;
}

const TOAST_MS = 2600;

/**
 * Full-page expert (agent) editor — create + edit — mirroring the marketing
 * prototype's Workspace-style editor. Pushed into the market right pane via
 * WKApp.routeRight.push; returns via pop. Edits the expert's self-contained
 * content: name/summary/category/tags + 指令 (AGENTS.md) + mcp 配置 (mcp.json).
 * Bound skills are shown here; creating/editing them opens the skill editor.
 */
export default function ExpertEditorPage({ mode, expertId, onCommitted, publishToScene }: ExpertEditorPageProps) {
  useI18n();
  const isEdit = mode === "edit";

  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [instruction, setInstruction] = useState("");
  const [mcpConfig, setMcpConfig] = useState("");
  const [expert, setExpert] = useState<ExpertAgent | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  /** Set once a create succeeds so the page flips to edit-in-place (subsequent
   *  saves update instead of creating a duplicate) WITHOUT touching the route
   *  stack — replaceToRoot would discard MyAssetsPage and strand the user on
   *  the empty-state when they hit 返回. */
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

  const glyph = useMemo(
    () => (name || expert?.shortName || "?").trim().slice(0, 1),
    [name, expert]
  );

  const goBack = () => {
    if (dirty && !window.confirm(t("mcp.expert.editor.leaveConfirm"))) return;
    WKApp.routeRight.pop();
  };

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      showToast(t("mcp.expert.editor.nameRequired"));
      return;
    }
    // mcp.json must be valid JSON (it's placeholdered + canonicalized server-side
    // via the write layer, which JSON.parses it).
    if (mcpConfig.trim()) {
      try {
        JSON.parse(mcpConfig);
      } catch {
        showToast(t("mcp.expert.editor.mcpInvalid"));
        return;
      }
    }
    const form: ExpertWriteForm = {
      name: name.trim(),
      summary,
      category: category || undefined,
      tags,
      instruction,
      mcpConfig,
      // skillIds omitted → preserve current bound skills on update.
    };
    setSaving(true);
    try {
      if (isEditing && editingId) {
        const updated = await updateExpert(editingId, form);
        setExpert(updated);
        if (onCommitted) {
          onCommitted({ id: editingId, name: form.name });
          WKApp.routeRight.pop();
          return;
        }
      } else {
        const { id } = await createExpert(form, { publishToScene });
        if (onCommitted) {
          // Hand the new member back to the parent (squad) editor and return.
          onCommitted({ id, name: form.name });
          WKApp.routeRight.pop();
          return;
        }
        // Flip to edit-in-place (no route change) so the next save updates.
        setCreatedId(id);
      }
      setDirty(false);
      showToast(t("mcp.expert.editor.saved"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("mcp.expert.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const title = isEditing ? name || expert?.name : t("mcp.expert.editor.createTitle");

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
              <WKButton
                icon={<Plus size={15} />}
                disabled={!isEdit}
                onClick={() => {
                  if (expert) openExpertSkillEditor(expert, showToast);
                }}
              >
                {t("mcp.expert.editor.newSkill")}
              </WKButton>
            </div>
            {expert?.skills?.length ? (
              <div className="wk-mcp-expert-editor__resource-list">
                {expert.skills.map((skill, index) => (
                  <div
                    key={`${skill.name}-${index}`}
                    className="wk-mcp-expert-editor__resource"
                  >
                    <span>{skill.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wk-mcp-expert-editor__empty">
                {isEdit
                  ? t("mcp.expert.editor.noSkills")
                  : t("mcp.expert.editor.skillsAfterCreate")}
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="wk-mcp-expert-editor__toast">{toast}</div>}
    </div>
  );
}

/** Placeholder for the expert-scoped skill create/edit flow (wired next). */
function openExpertSkillEditor(_expert: ExpertAgent, showToast: (m: string) => void) {
  showToast(t("mcp.expert.editor.skillsComingSoon"));
}
