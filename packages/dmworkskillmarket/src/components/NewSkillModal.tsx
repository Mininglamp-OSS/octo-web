import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FileArchive, ImagePlus, Loader2, UploadCloud, XCircle } from "lucide-react";
import { t, useI18n, WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, NewSkillForm } from "../types/skill";
import { createSkill, getSkillTags, initUpload, uploadFile, uploadIcon, triggerParse, pollParse } from "../api/skillApi";
import { MAX_SKILL_TAGS, validateSkillTag } from "../utils/format";
import IconCropModal from "./IconCropModal";

interface NewSkillModalProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}

type UploadStage = "idle" | "uploading" | "parsing" | "form" | "error";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const DEFAULT_CREATE_VERSION = "0.1.0";
const SKILL_PACKAGE_ACCEPT = ".zip,.skill";

function createReadme(name: string, description: string, version: string): string {
  return `# ${name}\n\n${description}\n\n## Version\n\n${version}\n`;
}

function validateZipFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".zip") && !name.endsWith(".skill")) return t("skillMarket.upload.invalidFormat");
  if (file.size > MAX_ZIP_SIZE) return t("skillMarket.upload.fileTooLarge");
  return null;
}

export default function NewSkillModal({ visible, categories, onClose, onCreated }: NewSkillModalProps) {
  useI18n();
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tagFieldRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [parseTaskId, setParseTaskId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const [tagSuggestionStyle, setTagSuggestionStyle] = useState<React.CSSProperties>({});
  const [activeTagSuggestion, setActiveTagSuggestion] = useState(0);
  const [tagError, setTagError] = useState<string | null>(null);
  const [version, setVersion] = useState(DEFAULT_CREATE_VERSION);
  const [changelog, setChangelog] = useState("");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconCropFile, setIconCropFile] = useState<File | null>(null);
  // Every `URL.createObjectURL(blob)` allocates a browser-managed handle
  // that only the caller can release with `revokeObjectURL`. Without this
  // effect a user cropping the icon N times leaks N-1 blob URLs (the last
  // one is still bound to the <img> src). Cleanup runs on preview change
  // AND on unmount.
  useEffect(() => {
    if (!iconPreview) return;
    return () => URL.revokeObjectURL(iconPreview);
  }, [iconPreview]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<"busy" | "dirty" | null>(null);

  const busy = stage === "uploading" || stage === "parsing";
  const dirty = Boolean(
    file ||
    name.trim() ||
    displayName.trim() ||
    tags.length ||
    tagDraft.trim() ||
    categoryId ||
    version !== DEFAULT_CREATE_VERSION ||
    changelog.trim() ||
    iconBlob,
  );

  function getTagDraftError() {
    const next = tagDraft.trim();
    if (!next) return null;
    if (validateSkillTag(next)) return validateSkillTag(next);
    if (tags.includes(next)) return t("skillMarket.form.tagDuplicate");
    if (tags.length >= MAX_SKILL_TAGS) return t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } });
    return null;
  }

  const tagSubmitError = tagError ?? getTagDraftError();
  const canCreate = Boolean(
    parseTaskId &&
    name.trim() &&
    displayName.trim() &&
    categoryId &&
    version.trim() &&
    changelog.trim() &&
    !busy &&
    !saving &&
    !tagSubmitError,
  );

  function updateTagSuggestionStyle() {
    const field = tagFieldRef.current;
    if (!field) return;

    const rect = field.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 12;
    const maxPanelHeight = 180;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - viewportPadding - gap;
    const placeAbove = availableBelow < 120 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      96,
      Math.min(maxPanelHeight, placeAbove ? availableAbove : availableBelow)
    );

    setTagSuggestionStyle({
      left: rect.left,
      top: placeAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
      width: rect.width,
      maxHeight,
    });
  }

  useEffect(() => () => { abortRef.current = true; }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  function reset() {
    abortRef.current = true;
    setStage("idle");
    setProgress(0);
    setFile(null);
    setParseTaskId(null);
    setName("");
    setDisplayName("");
    setDescription("");
    setCategoryId("");
    setTags([]);
    setTagDraft("");
    setTagSuggestions([]);
    setTagSuggestOpen(false);
    setTagSuggestionStyle({});
    setActiveTagSuggestion(0);
    setTagError(null);
    setVersion(DEFAULT_CREATE_VERSION);
    setChangelog("");
    setIconPreview(null);
    setIconBlob(null);
    setSaving(false);
    setError(null);
    setConfirmClose(null);
    // Allow next upload
    setTimeout(() => { abortRef.current = false; }, 0);
  }

  function requestClose() {
    if (busy) {
      setConfirmClose("busy");
      return;
    }
    if (dirty && !saving) {
      setConfirmClose("dirty");
      return;
    }
    onClose();
  }

  function confirmLeave() {
    reset();
    onClose();
  }

  async function startUpload(nextFile: File) {
    const validationError = validateZipFile(nextFile);
    setError(validationError);
    if (validationError) {
      setStage("error");
      setFile(null);
      setProgress(0);
      return;
    }

    setFile(nextFile);
    setStage("uploading");
    setProgress(0);
    setError(null);
    abortRef.current = false;

    try {
      // Step 1: Init upload
      const { uploadId, presignedUrl, headers } = await initUpload(nextFile.name, nextFile.size);
      if (abortRef.current) return;

      // Step 2: Upload the file
      await uploadFile(presignedUrl, nextFile, headers, (percent) => {
        if (!abortRef.current) setProgress(percent);
      });
      if (abortRef.current) return;

      // Step 3: Trigger parse
      setStage("parsing");
      const { taskId } = await triggerParse(uploadId);
      if (abortRef.current) return;

      // Step 4: Poll parse status
      let attempts = 0;
      const maxAttempts = 60; // 60s max
      while (attempts < maxAttempts) {
        if (abortRef.current) return;
        const status = await pollParse(taskId);
        if (abortRef.current) return;

        if (status.status === "success" && status.result) {
          setParseTaskId(taskId);
          setName(status.result.name);
          setDescription(status.result.description);
          setTags(status.result.tags);
          setVersion(status.result.version || DEFAULT_CREATE_VERSION);
          setChangelog(t("skillMarket.form.initialChangelog"));
          setCategoryId("");
          setStage("form");
          setError(null);
          return;
        }
        if (status.status === "failed") {
          setStage("error");
          setError(status.error?.message ?? t("skillMarket.upload.parseFailed"));
          return;
        }
        // Still pending/parsing — wait 1s and retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      // Timeout
      setStage("error");
      setError(t("skillMarket.upload.parseTimeout"));
    } catch (err) {
      if (!abortRef.current) {
        setStage("error");
        setError(err instanceof Error ? err.message : t("skillMarket.upload.uploadFailed"));
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) void startUpload(nextFile);
    event.target.value = "";
  }

  function addTag() {
    const next = tagDraft.trim();
    addTagValue(next);
  }

  function addTagValue(next: string) {
    if (!next) {
      setTagDraft("");
      setTagSuggestOpen(false);
      return;
    }
    const validationError = validateSkillTag(next);
    if (validationError) {
      setTagError(validationError);
      setTagSuggestOpen(false);
      return;
    }
    if (tags.includes(next)) {
      setTagError(t("skillMarket.form.tagDuplicate"));
      setTagSuggestOpen(false);
      return;
    }
    if (tags.length >= MAX_SKILL_TAGS) {
      setTagError(t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } }));
      setTagSuggestOpen(false);
      return;
    }
    setTags([...tags, next].slice(0, MAX_SKILL_TAGS));
    setTagDraft("");
    setTagSuggestOpen(false);
    setActiveTagSuggestion(0);
    setTagError(null);
  }

  useEffect(() => {
    if (!visible) return;
    const query = tagDraft.trim();
    if (!query || tags.length >= MAX_SKILL_TAGS || validateSkillTag(query)) {
      setTagSuggestions([]);
      setTagSuggestOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getSkillTags(query, { signal: controller.signal })
        .then((items) => {
          const next = items
            .map((item) => item.name)
            .filter((name) => name && !tags.includes(name))
            .slice(0, 8);
          setTagSuggestions(next);
          setActiveTagSuggestion(0);
          setTagSuggestOpen(next.length > 0);
        })
        .catch((err) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setTagSuggestions([]);
            setTagSuggestOpen(false);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tagDraft, tags, visible]);

  useLayoutEffect(() => {
    if (!tagSuggestOpen || tagSuggestions.length === 0) return;
    updateTagSuggestionStyle();

    window.addEventListener("resize", updateTagSuggestionStyle);
    window.addEventListener("scroll", updateTagSuggestionStyle, true);
    return () => {
      window.removeEventListener("resize", updateTagSuggestionStyle);
      window.removeEventListener("scroll", updateTagSuggestionStyle, true);
    };
  }, [tagSuggestOpen, tagSuggestions.length]);

  async function submit() {
    if (!displayName.trim() || !categoryId || !version.trim() || !changelog.trim()) {
      setError(t("skillMarket.form.validationRequired"));
      return;
    }
    if (!parseTaskId) {
      setError(t("skillMarket.form.validationNoUpload"));
      return;
    }
    if (!name.trim()) {
      setError(t("skillMarket.form.validationNoUpload"));
      return;
    }
    const draftError = getTagDraftError();
    if (tagError || draftError) {
      setTagError(tagError ?? draftError);
      return;
    }
    const submittedTags = tagDraft.trim()
      ? [...tags, tagDraft.trim()].slice(0, MAX_SKILL_TAGS)
      : tags;
    setSaving(true);
    setError(null);
    try {
      let iconUrl = "";
      if (iconBlob) {
        const iconUploadId = await uploadIcon(iconBlob);
        iconUrl = iconUploadId;
      }
      const form: NewSkillForm = {
        parseTaskId,
        name,
        displayName,
        description,
        categoryId,
        tags: submittedTags,
        visibility: "space",
        version,
        changelog,
        readmeContent: createReadme(name, description, version),
        iconUrl,
        fileName: file?.name ?? "",
        fileSize: file?.size ?? 0,
      };
      await createSkill(form);
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.form.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <WKModal
        visible={visible}
        onCancel={requestClose}
        title={t("skillMarket.form.createTitle")}
        size="lg"
        className="skill-market-workflow-modal"
        footer={
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>{t("skillMarket.common.cancel")}</WKButton>
            <WKButton variant="primary" onClick={() => void submit()} loading={saving} disabled={!canCreate}>{t("skillMarket.common.create")}</WKButton>
          </>
        }
      >
        <section className="skill-market-form skill-market-form--workflow">
          {error && (
            <div className="skill-market-form__error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
          <div
            className={file ? "skill-market-upload-file" : "skill-market-upload-file skill-market-upload-file--empty"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (busy) return;
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) startUpload(dropped);
            }}
          >
            {file ? <FileArchive size={18} /> : <UploadCloud size={18} />}
            <div>
              <strong>{file?.name ?? t("skillMarket.upload.dropzoneTitle")}</strong>
              <span>
                {file
                  ? (parseTaskId
                    ? t("skillMarket.upload.parsedWithName", { values: { name } })
                    : stage === "parsing"
                      ? t("skillMarket.upload.parsing")
                      : t("skillMarket.upload.uploading"))
                  : t("skillMarket.upload.parseAutofillHint")}
              </span>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {file ? t("skillMarket.upload.reuploadShort") : t("skillMarket.upload.selectFileAction")}
            </button>
            <input
              ref={fileInputRef}
              aria-label={t("skillMarket.upload.selectFileAriaLabel")}
              className="skill-market-upload-file__input"
              type="file"
              accept={SKILL_PACKAGE_ACCEPT}
              onChange={handleFileChange}
            />
          </div>
          {stage === "uploading" && (
            <div className="skill-market-upload-status">
              <div className="skill-market-upload-status__line">
                <span>{t("skillMarket.upload.uploadProgress")}</span>
                <strong>{progress}%</strong>
              </div>
              <div className="skill-market-progress" aria-label={t("skillMarket.upload.progressBarAriaLabel")}>
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {stage === "parsing" && (
            <div className="skill-market-upload-status is-parsing">
              <Loader2 size={16} />
              <span>{t("skillMarket.upload.parsing")}</span>
            </div>
          )}

          <div className="skill-market-form__version-section">
            <h3 className="skill-market-form__section-title">{t("skillMarket.form.versionSection")}</h3>
            <div className="skill-market-form__row">
              <label>
                <span>{t("skillMarket.form.versionLabel")}<i className="skill-market-required">*</i></span>
                <WKInput value={version} onChange={setVersion} placeholder={t("skillMarket.form.versionPlaceholder")} />
              </label>
              <label>
                <span>{t("skillMarket.form.changelogLabel")}<i className="skill-market-required">*</i></span>
                <WKInput value={changelog} onChange={setChangelog} placeholder={t("skillMarket.form.changelogPlaceholder")} />
              </label>
            </div>
          </div>

          <h3 className="skill-market-form__section-title">{t("skillMarket.form.basicInfoSection")}</h3>

          <div className="skill-market-form__icon-row">
            <label className="skill-market-icon-upload" title={t("skillMarket.form.uploadIcon")}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => {
                  const f = event.target.files?.[0];
                  if (f) setIconCropFile(f);
                  event.target.value = "";
                }}
              />
              {iconPreview ? (
                <img src={iconPreview} alt="icon" />
              ) : (
                <ImagePlus size={24} />
              )}
            </label>
            <label>
              <span>{t("skillMarket.form.displayName")}<i className="skill-market-required">*</i></span>
              <WKInput value={displayName} onChange={(v: string) => setDisplayName(v.slice(0, 20))} placeholder={t("skillMarket.form.displayNamePlaceholder")} maxLength={20} />
            </label>
          </div>
          <div className="skill-market-form__row">
            <label>
              <span>{t("skillMarket.form.category")}<i className="skill-market-required">*</i></span>
              <select aria-label={t("skillMarket.form.category")} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">{t("skillMarket.form.categoryPlaceholder")}</option>
                {selectableCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("skillMarket.form.tags")}</span>
              <div className="skill-market-tag-field" ref={tagFieldRef}>
                <div className="skill-market-tag-input">
                  {tags.map((tag) => (
                    <button key={tag} type="button" onClick={() => setTags(tags.filter((item) => item !== tag))}>
                      {tag}
                      <XCircle size={12} />
                    </button>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(event) => {
                      const next = event.target.value;
                      setTagDraft(next);
                      setTagError(validateSkillTag(next));
                    }}
                    onFocus={() => setTagSuggestOpen(tagSuggestions.length > 0)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" && tagSuggestions.length) {
                        event.preventDefault();
                        setTagSuggestOpen(true);
                        setActiveTagSuggestion((current) => (current + 1) % tagSuggestions.length);
                        return;
                      }
                      if (event.key === "ArrowUp" && tagSuggestions.length) {
                        event.preventDefault();
                        setTagSuggestOpen(true);
                        setActiveTagSuggestion((current) => (current - 1 + tagSuggestions.length) % tagSuggestions.length);
                        return;
                      }
                      if (event.key === "Escape") {
                        setTagSuggestOpen(false);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (tagSuggestOpen && tagSuggestions[activeTagSuggestion]) {
                          addTagValue(tagSuggestions[activeTagSuggestion]);
                        } else {
                          addTag();
                        }
                      }
                    }}
                    onBlur={addTag}
                    placeholder={t("skillMarket.form.tagPlaceholder")}
                    aria-label={t("skillMarket.form.tags")}
                    aria-autocomplete="list"
                    aria-expanded={tagSuggestOpen}
                    aria-describedby={(tagError || tags.length >= MAX_SKILL_TAGS) ? "skill-market-tag-hint" : undefined}
                  />
                </div>
                {(tagError || tags.length >= MAX_SKILL_TAGS) && (
                  <small id="skill-market-tag-hint" className={tagError ? "skill-market-tag-hint is-error" : "skill-market-tag-hint"}>
                    {tagError ?? t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } })}
                  </small>
                )}
                {tagSuggestOpen && tagSuggestions.length > 0 && (
                  <div
                    className="skill-market-tag-suggestions"
                    role="listbox"
                    aria-label={t("skillMarket.form.tagSuggestions")}
                    style={tagSuggestionStyle}
                  >
                    {tagSuggestions.map((tag, index) => (
                      <button
                        key={tag}
                        type="button"
                        role="option"
                        aria-selected={index === activeTagSuggestion}
                        className={index === activeTagSuggestion ? "is-active" : ""}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          addTagValue(tag);
                        }}
                        onMouseEnter={() => setActiveTagSuggestion(index)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
          </div>
        </section>
      </WKModal>
      <IconCropModal
        visible={!!iconCropFile}
        file={iconCropFile}
        onCancel={() => setIconCropFile(null)}
        onConfirm={(blob) => {
          setIconPreview(URL.createObjectURL(blob));
          setIconBlob(blob);
          setIconCropFile(null);
        }}
      />
      <ConfirmLeaveModal
        mode={confirmClose}
        onKeep={() => setConfirmClose(null)}
        onLeave={confirmLeave}
      />
    </>
  );
}

function ConfirmLeaveModal({
  mode,
  onKeep,
  onLeave,
}: {
  mode: "busy" | "dirty" | null;
  onKeep: () => void;
  onLeave: () => void;
}) {
  return (
    <WKModal
      visible={Boolean(mode)}
      onCancel={onKeep}
      title={t("skillMarket.confirm.title")}
      size="md"
      footer={
        <>
          <WKButton variant="secondary" onClick={onKeep}>{mode === "busy" ? t("skillMarket.confirm.keepUploading") : t("skillMarket.confirm.keepEditing")}</WKButton>
          <WKButton variant="danger" onClick={onLeave}>{t("skillMarket.confirm.leave")}</WKButton>
        </>
      }
    >
      <p className="skill-market-confirm-text">
        {mode === "busy"
          ? t("skillMarket.confirm.busyMessage")
          : t("skillMarket.confirm.dirtyCreateMessage")}
      </p>
    </WKModal>
  );
}
