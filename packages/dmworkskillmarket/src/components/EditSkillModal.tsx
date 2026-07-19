import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Box, FileArchive, Loader2, XCircle } from "lucide-react";
import { t, useI18n, WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, Skill } from "../types/skill";
import { updateSkill, uploadIcon, initReupload, uploadFile, triggerParse, pollParse } from "../api/skillApi";
import { MAX_SKILL_TAGS, validateSkillTag } from "../utils/format";
import IconCropModal from "./IconCropModal";

interface EditSkillModalProps {
  skill: Skill | null;
  categories: Category[];
  onClose: () => void;
  onUpdated: (skill: Skill) => void;
}

type UploadStage = "idle" | "uploading" | "parsing" | "error";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const SKILL_PACKAGE_ACCEPT = ".zip,.skill";

function bumpPatch(ver: string): string {
  const parts = ver.split(".");
  if (parts.length < 3) return ver;
  const patch = parseInt(parts[2], 10);
  parts[2] = String(isNaN(patch) ? 1 : patch + 1);
  return parts.join(".");
}

function validateZipFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".zip") && !name.endsWith(".skill")) return t("skillMarket.upload.invalidFormat");
  if (file.size > MAX_ZIP_SIZE) return t("skillMarket.upload.fileTooLarge");
  return null;
}

export default function EditSkillModal({ skill, categories, onClose, onUpdated }: EditSkillModalProps) {
  useI18n();
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("dev-tools");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parseTaskId, setParseTaskId] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconCropFile, setIconCropFile] = useState<File | null>(null);
  const [changelog, setChangelog] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => () => { abortRef.current = true; }, []);

  useEffect(() => {
    if (!skill) {
      abortRef.current = true;
      return;
    }
    abortRef.current = true;
    setName(skill.name);
    setDisplayName(skill.displayName ?? "");
    setDescription(skill.description);
    setCategoryId(skill.categoryId);
    setTags(skill.tags);
    setTagDraft("");
    setTagError(null);
    setVersion(skill.version);
    setUploadStage("idle");
    setProgress(0);
    setUploadedFile(null);
    setParseTaskId(null);
    setIconPreview(skill.iconUrl || null);
    setIconBlob(null);
    setIconCropFile(null);
    setChangelog(t("skillMarket.form.currentVersionChangelog"));
    setError(null);
    setConfirmClose(false);
    setTimeout(() => { abortRef.current = false; }, 0);
  }, [skill]);

  const busy = uploadStage === "uploading" || uploadStage === "parsing";
  const dirty = Boolean(skill) && (
    name !== skill?.name ||
    displayName !== (skill?.displayName ?? "") ||
    categoryId !== skill?.categoryId ||
    JSON.stringify(tags) !== JSON.stringify(skill?.tags) ||
    Boolean(tagDraft.trim()) ||
    Boolean(uploadedFile) ||
    Boolean(iconBlob)
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
  const canSave = Boolean(
    !busy &&
    uploadStage !== "error" &&
    name.trim() &&
    displayName.trim() &&
    (!parseTaskId || (version.trim() && changelog.trim())) &&
    !tagSubmitError,
  );

  function requestClose() {
    if (busy) {
      setConfirmClose(true);
      return;
    }
    if (dirty && !saving) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  function confirmLeave() {
    abortRef.current = true;
    setUploadStage("idle");
    setProgress(0);
    setUploadedFile(null);
    setParseTaskId(null);
    onClose();
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next) return;
    const validationError = validateSkillTag(next);
    if (validationError) {
      setTagError(validationError);
      return;
    }
    if (tags.includes(next)) {
      setTagError(t("skillMarket.form.tagDuplicate"));
      return;
    }
    if (tags.length >= MAX_SKILL_TAGS) {
      setTagError(t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } }));
      return;
    }
    setTags([...tags, next].slice(0, MAX_SKILL_TAGS));
    setTagDraft("");
    setTagError(null);
  }

  async function startUpload(nextFile: File) {
    if (!skill) return;
    const validationError = validateZipFile(nextFile);
    setError(validationError);
    if (validationError) {
      setUploadStage("error");
      setUploadedFile(null);
      setProgress(0);
      return;
    }

    setUploadedFile(nextFile);
    setUploadStage("uploading");
    setProgress(0);
    setError(null);
    abortRef.current = false;

    try {
      const { uploadId, presignedUrl, headers } = await initReupload(skill.id, nextFile.name, nextFile.size);
      if (abortRef.current) return;

      await uploadFile(presignedUrl, nextFile, headers, (percent) => {
        if (!abortRef.current) setProgress(percent);
      });
      if (abortRef.current) return;

      setUploadStage("parsing");
      const { taskId } = await triggerParse(uploadId);
      if (abortRef.current) return;

      let attempts = 0;
      const maxAttempts = 60;
      while (attempts < maxAttempts) {
        if (abortRef.current) return;
        const status = await pollParse(taskId);
        if (abortRef.current) return;

        if (status.status === "success" && status.result) {
          if (status.result.name !== skill.name) {
            setUploadStage("error");
            setUploadedFile(null);
            setParseTaskId(null);
            setError(t("skillMarket.upload.nameMismatch", {
              values: { expected: skill.name, actual: status.result.name },
            }));
            return;
          }
          setParseTaskId(taskId);
          setName(status.result.name);
          setDescription(status.result.description);
          if (status.result.tags.length > 0) {
            setTags(status.result.tags);
          }
          setVersion(bumpPatch(skill.version));
          setChangelog("");
          setUploadStage("idle");
          setError(null);
          return;
        }
        if (status.status === "failed") {
          setUploadStage("error");
          setUploadedFile(null);
          setError(status.error?.message ?? t("skillMarket.upload.parseFailed"));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      setUploadStage("error");
      setError(t("skillMarket.upload.parseTimeout"));
    } catch (err) {
      if (!abortRef.current) {
        setUploadStage("error");
        setUploadedFile(null);
        setError(err instanceof Error ? err.message : t("skillMarket.upload.uploadFailed"));
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void startUpload(file);
    event.target.value = "";
  }

  async function submit() {
    if (!skill) return;
    if (!name.trim() || !displayName.trim() || !categoryId || (parseTaskId && (!version.trim() || !changelog.trim()))) {
      setError(t("skillMarket.form.validationRequired"));
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
      let iconUrl: string | undefined;
      if (iconBlob) {
        iconUrl = await uploadIcon(iconBlob);
      }
      const updated = await updateSkill(skill.id, {
        ...(parseTaskId ? { parseTaskId, version, changelog } : {}),
        name,
        displayName,
        description,
        categoryId,
        tags: submittedTags,
        ...(iconUrl !== undefined ? { iconUrl } : {}),
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <WKModal
        visible={Boolean(skill)}
        onCancel={requestClose}
        title={skill ? t("skillMarket.form.editTitle", { values: { name: skill.name } }) : t("skillMarket.form.editTitleFallback")}
        size="lg"
        className="skill-market-workflow-modal"
        footer={
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>{t("skillMarket.common.cancel")}</WKButton>
            <WKButton
              variant="primary"
              onClick={() => void submit()}
              loading={saving}
              disabled={!canSave}
            >
              {t("skillMarket.common.save")}
            </WKButton>
          </>
        }
      >
        <div className="skill-market-form skill-market-form--workflow">
          {error && (
            <div className="skill-market-form__error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
          <div className="skill-market-upload-file">
            <FileArchive size={18} />
            <div>
              <strong>{uploadedFile?.name ?? skill?.fileName}</strong>
              <span>{uploadedFile ? t("skillMarket.upload.newVersionParsedWithName", { values: { name } }) : t("skillMarket.upload.currentPackageWithName", { values: { name } })}</span>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()}>{t("skillMarket.upload.reupload")}</button>
            <input
              ref={fileInputRef}
              aria-label={t("skillMarket.upload.selectNewFileAriaLabel")}
              className="skill-market-upload-file__input"
              type="file"
              accept={SKILL_PACKAGE_ACCEPT}
              onChange={handleFileChange}
            />
          </div>
          {uploadStage === "uploading" && (
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
          {uploadStage === "parsing" && (
            <div className="skill-market-upload-status is-parsing">
              <Loader2 size={16} />
              <span>{t("skillMarket.upload.parsing")}</span>
            </div>
          )}
          {uploadStage === "error" && (
            <WKButton variant="secondary" onClick={() => fileInputRef.current?.click()}>{t("skillMarket.upload.reselect")}</WKButton>
          )}

          <div className="skill-market-form__version-section">
            <h3 className="skill-market-form__section-title">{t("skillMarket.form.versionSection")}</h3>
            <div className="skill-market-form__row">
              <label>
                <span>{t("skillMarket.form.versionLabel")}<i className="skill-market-required">*</i></span>
                <WKInput
                  value={version}
                  onChange={setVersion}
                  placeholder={t("skillMarket.form.versionPlaceholder")}
                  readOnly={!parseTaskId}
                  className={!parseTaskId ? "skill-market-input-readonly" : undefined}
                />
              </label>
              <label>
                <span>{t("skillMarket.form.changelogLabel")}<i className="skill-market-required">*</i></span>
                <WKInput
                  value={changelog}
                  onChange={setChangelog}
                  placeholder={t("skillMarket.form.changelogPlaceholder")}
                  readOnly={!parseTaskId}
                  className={!parseTaskId ? "skill-market-input-readonly" : undefined}
                />
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
                <Box size={24} />
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
                {selectableCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("skillMarket.form.tags")}</span>
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder={t("skillMarket.form.tagPlaceholder")}
                  aria-describedby={(tagError || tags.length >= MAX_SKILL_TAGS) ? "skill-market-edit-tag-hint" : undefined}
                />
              </div>
              {(tagError || tags.length >= MAX_SKILL_TAGS) && (
                <small id="skill-market-edit-tag-hint" className={tagError ? "skill-market-tag-hint is-error" : "skill-market-tag-hint"}>
                  {tagError ?? t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } })}
                </small>
              )}
            </label>
          </div>
        </div>
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
      <WKModal
        visible={confirmClose}
        onCancel={() => setConfirmClose(false)}
        title={t("skillMarket.confirm.title")}
        size="md"
        footer={
          <>
            <WKButton variant="secondary" onClick={() => setConfirmClose(false)}>{t("skillMarket.confirm.keepEditing")}</WKButton>
            <WKButton variant="danger" onClick={confirmLeave}>{t("skillMarket.confirm.leave")}</WKButton>
          </>
        }
      >
        <p className="skill-market-confirm-text">
          {busy
            ? t("skillMarket.confirm.busyMessage")
            : t("skillMarket.confirm.dirtyEditMessage")}
        </p>
      </WKModal>
    </>
  );
}
