import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Settings, Upload } from "lucide-react";
import { WKApp, WKButton, t, useI18n } from "@octo/base";
import type { Category, EditableAttachment, Skill } from "../types/skill";
import { getCategories, getSkillFiles, updateSkill, createSkillFromScratch } from "../api/skillApi";
import SkillFileTree, { PROTECTED_PATHS } from "../components/SkillFileTree";
import EditSkillModal from "../components/EditSkillModal";

interface SkillEditorPageProps {
  /** Passed as the route `param` on navigation; falls back to the `?skillId=`
   *  query so a page refresh keeps working. Absent in create mode. */
  skillId?: string;
  /** "create" starts a blank from-scratch skill; defaults to "edit". */
  mode?: "create" | "edit";
  /** When set (child of another editor, e.g. the expert editor creating a bound
   *  skill), the saved skill's id+name are handed back on save. In create mode
   *  the page also pops itself after committing. */
  onCommitted?: (result: { id: string; name: string }) => void;
  /** Forwarded to createSkillFromScratch — expert-scoped skills pass false so
   *  the new skill isn't published to the discovery scene. */
  publishToScene?: boolean;
}

const TOAST_MS = 2600;

/** Reject unsafe paths for new/renamed files (mirrors the backend guard). */
function isSafePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\")) return false;
  if (trimmed.includes("\0")) return false;
  return !trimmed.split("/").some((s) => s === "..");
}

/**
 * Full-page skill editor (mirrors the marketing prototype's Workspace-style
 * editor): editable title/description hero + a file tree and a code editor for
 * the skill's package files. Mounted as a whole-page route (no market sidebar).
 * Legacy zip-package skills can't be edited per file — the editor degrades to a
 * notice + the reupload flow via the settings modal.
 */
export default function SkillEditorPage({
  skillId,
  mode,
  onCommitted,
  publishToScene,
}: SkillEditorPageProps) {
  useI18n();
  const isCreate = mode === "create";
  const resolvedId = useMemo(
    () =>
      skillId ||
      new URLSearchParams(window.location.search).get("skillId") ||
      "",
    [skillId]
  );

  const [loading, setLoading] = useState(!isCreate);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [isLegacy, setIsLegacy] = useState(false);
  const [attachments, setAttachments] = useState<EditableAttachment[]>([]);
  const [activePath, setActivePath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const load = useCallback(async () => {
    if (isCreate) {
      // Blank from-scratch skill: seed a single editable SKILL.md.
      setAttachments([{ path: "SKILL.md", rawContent: "", readonly: false }]);
      setActivePath("SKILL.md");
      setLoading(false);
      setDirty(false);
      return;
    }
    if (!resolvedId) {
      setLoading(false);
      setError(t("skillMarket.editor.noSkill"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [files, cats] = await Promise.all([
        getSkillFiles(resolvedId),
        getCategories().catch(() => [] as Category[]),
      ]);
      setSkill(files.skill);
      setIsLegacy(files.isLegacy);
      setAttachments(files.attachments);
      setDisplayName(files.skill.displayName);
      setDescription(files.skill.description);
      setCategories(cats);
      const first =
        files.attachments.find((a) => a.path === "SKILL.md") ??
        files.attachments.find((a) => !a.readonly) ??
        files.attachments[0];
      setActivePath(first?.path ?? "");
      setDirty(false);
    } catch {
      setError(t("skillMarket.editor.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [resolvedId, isCreate]);

  useEffect(() => {
    load();
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [load]);

  const activeFile = attachments.find((a) => a.path === activePath) ?? null;

  const editContent = (text: string) => {
    setAttachments((prev) =>
      prev.map((a) => (a.path === activePath ? { ...a, rawContent: text } : a))
    );
    setDirty(true);
  };

  const uniquePath = (base: string): string => {
    if (!attachments.some((a) => a.path === base)) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let n = 2;
    while (attachments.some((a) => a.path === `${stem}-${n}${ext}`)) n += 1;
    return `${stem}-${n}${ext}`;
  };

  const addRawFile = (path: string, content: string) => {
    const safe = isSafePath(path) ? path : t("skillMarket.editor.newFileName");
    const finalPath = uniquePath(safe);
    setAttachments((prev) => [
      ...prev,
      { path: finalPath, rawContent: content, readonly: false },
    ]);
    setActivePath(finalPath);
    setDirty(true);
  };

  const newFile = () => addRawFile(t("skillMarket.editor.newFileName"), "");

  const deleteFile = (path: string) => {
    if (PROTECTED_PATHS.has(path)) return;
    setAttachments((prev) => prev.filter((a) => a.path !== path));
    setDirty(true);
    if (path === activePath) {
      const rest = attachments.filter((a) => a.path !== path);
      setActivePath(rest.find((a) => a.path === "SKILL.md")?.path ?? rest[0]?.path ?? "");
    }
  };

  const renameActive = (nextPath: string) => {
    if (!activeFile || PROTECTED_PATHS.has(activeFile.path) || activeFile.readonly) return;
    if (!isSafePath(nextPath) || attachments.some((a) => a.path === nextPath)) return;
    setAttachments((prev) =>
      prev.map((a) => (a.path === activePath ? { ...a, path: nextPath } : a))
    );
    setActivePath(nextPath);
    setDirty(true);
  };

  const onUploadFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => addRawFile(file.name, String(reader.result ?? ""));
      reader.readAsText(file);
    });
  };

  const save = async () => {
    if (saving) return;
    if (isCreate) {
      const name = displayName.trim();
      if (!name) {
        showToast(t("skillMarket.editor.nameRequired"));
        return;
      }
      setSaving(true);
      try {
        const created = await createSkillFromScratch(
          {
            displayName: name,
            name,
            description,
            tags: [],
            attachments,
          },
          { publishToScene }
        );
        onCommitted?.({ id: created.id, name: created.displayName || name });
        WKApp.routeRight.pop();
        return;
      } catch {
        showToast(t("skillMarket.editor.saveFailed"));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!skill) return;
    setSaving(true);
    try {
      const updated = await updateSkill(skill.id, {
        displayName: displayName.trim() || skill.displayName,
        description,
        ...(isLegacy ? {} : { attachments }),
      });
      setSkill(updated);
      setDirty(false);
      onCommitted?.({ id: updated.id, name: updated.displayName });
      showToast(t("skillMarket.editor.saved"));
    } catch {
      showToast(t("skillMarket.editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (dirty && !window.confirm(t("skillMarket.editor.leaveConfirm"))) return;
    WKApp.routeRight.pop();
  };

  return (
    <div className="skill-editor">
      <header className="skill-editor__topbar">
        <div className="skill-editor__crumb">
          <button
            type="button"
            className="skill-editor__back"
            onClick={goBack}
            aria-label={t("skillMarket.editor.returnToMine")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("skillMarket.editor.returnToMine")}
          </button>
          <span className="skill-editor__crumb-sep">/</span>
          <b className="skill-editor__crumb-title">
            {displayName || skill?.name || t("skillMarket.editor.createTitle")}
          </b>
        </div>
        <div className="skill-editor__top-actions">
          {skill && (
            <WKButton onClick={() => setSettingsOpen(true)} icon={<Settings size={15} />}>
              {t("skillMarket.editor.settings")}
            </WKButton>
          )}
          <WKButton
            variant="primary"
            icon={<Save size={15} />}
            disabled={saving || (isCreate ? !displayName.trim() : !skill || !dirty)}
            onClick={save}
          >
            {saving ? t("skillMarket.editor.saving") : t("skillMarket.editor.save")}
          </WKButton>
        </div>
      </header>

      {loading ? (
        <div className="skill-editor__state">{t("skillMarket.editor.loading")}</div>
      ) : error ? (
        <div className="skill-editor__state skill-editor__state--error" role="alert">
          <span>{error}</span>
          <WKButton onClick={goBack}>{t("skillMarket.editor.returnToMine")}</WKButton>
        </div>
      ) : (
        <>
          <section className="skill-editor__hero">
            <div className="skill-editor__avatar" aria-hidden="true">
              {(displayName || skill?.name || "?").slice(0, 1)}
            </div>
            <div className="skill-editor__hero-main">
              <input
                className="skill-editor__title-input"
                value={displayName}
                maxLength={40}
                placeholder={t("skillMarket.form.displayNamePlaceholder")}
                aria-label={t("skillMarket.editor.editName")}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setDirty(true);
                }}
              />
              <textarea
                className="skill-editor__desc-input"
                value={description}
                rows={2}
                placeholder={t("skillMarket.editor.editDesc")}
                aria-label={t("skillMarket.editor.editDesc")}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
          </section>

          {isLegacy ? (
            <div className="skill-editor__legacy">
              <b>{t("skillMarket.editor.legacyTitle")}</b>
              <span>{t("skillMarket.editor.legacyNotice")}</span>
              <WKButton
                variant="primary"
                icon={<Upload size={15} />}
                onClick={() => setSettingsOpen(true)}
              >
                {t("skillMarket.editor.reupload")}
              </WKButton>
            </div>
          ) : (
            <div className="skill-editor__body">
              <aside className="skill-editor__files">
                <div className="skill-editor__files-header">
                  <span>
                    {t("skillMarket.editor.filesHeader", {
                      values: { count: attachments.length },
                    })}
                  </span>
                  <button
                    type="button"
                    className="skill-editor__new-file"
                    onClick={newFile}
                    aria-label={t("skillMarket.editor.newFile")}
                    title={t("skillMarket.editor.newFile")}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
                <SkillFileTree
                  files={attachments}
                  activePath={activePath}
                  onSelect={setActivePath}
                  onDelete={deleteFile}
                />
                <label className="skill-editor__upload">
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      onUploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <b>{t("skillMarket.editor.uploadTitle")}</b>
                  <span>{t("skillMarket.editor.uploadHint")}</span>
                </label>
              </aside>

              <section className="skill-editor__pane">
                {activeFile ? (
                  <>
                    <div className="skill-editor__file-head">
                      <input
                        className="skill-editor__file-path"
                        value={activeFile.path}
                        readOnly={
                          activeFile.readonly || PROTECTED_PATHS.has(activeFile.path)
                        }
                        aria-label={t("skillMarket.editor.filePath")}
                        onChange={(e) => renameActive(e.target.value)}
                      />
                    </div>
                    {activeFile.readonly ? (
                      <div className="skill-editor__readonly">
                        {t("skillMarket.editor.readonlyFile")}
                      </div>
                    ) : (
                      <textarea
                        className="skill-editor__code"
                        value={activeFile.rawContent ?? ""}
                        spellCheck={false}
                        onChange={(e) => editContent(e.target.value)}
                        aria-label={t("skillMarket.editor.codeArea")}
                      />
                    )}
                  </>
                ) : (
                  <div className="skill-editor__state">
                    {t("skillMarket.editor.noFile")}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {skill && settingsOpen && (
        <EditSkillModal
          skill={skill}
          categories={categories}
          onClose={() => setSettingsOpen(false)}
          onUpdated={(updated) => {
            setSkill(updated);
            setDisplayName(updated.displayName);
            setDescription(updated.description);
            setSettingsOpen(false);
            showToast(t("skillMarket.editor.saved"));
            // A reupload rebuilds the package server-side; reload the tree.
            load();
          }}
        />
      )}

      {toast && <div className="skill-editor__toast">{toast}</div>}
    </div>
  );
}
