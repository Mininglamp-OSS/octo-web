import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileArchive, ImagePlus, Loader2, UploadCloud, XCircle } from "lucide-react";
import { t, useI18n, WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, NewSkillForm, Visibility } from "../types/skill";
import { createSkill, initUpload, uploadFile, uploadIcon, triggerParse, pollParse } from "../api/skillApi";
import { formatFileSize } from "../utils/format";
import IconCropModal from "./IconCropModal";

interface NewSkillModalProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}

type UploadStage = "idle" | "uploading" | "parsing" | "form" | "error";

interface ParsedSkill {
  name: string;
  description: string;
  tags: string[];
  version: string;
}

const MAX_ZIP_SIZE = 20 * 1024 * 1024;

function createReadme(name: string, description: string, version: string): string {
  return `# ${name}\n\n${description}\n\n## Version\n\n${version}\n`;
}

function validateZipFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".zip")) return t("skillMarket.upload.invalidFormat");
  if (file.size > MAX_ZIP_SIZE) return t("skillMarket.upload.fileTooLarge");
  return null;
}

export default function NewSkillModal({ visible, categories, onClose, onCreated }: NewSkillModalProps) {
  useI18n();
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
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
  const [visibility, setVisibility] = useState<Visibility>("space");
  const [version, setVersion] = useState("1.0.0");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconCropFile, setIconCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<"busy" | "dirty" | null>(null);

  const busy = stage === "uploading" || stage === "parsing";
  const dirty = Boolean(file || name.trim() || displayName.trim() || tags.length || categoryId);
  const canCreate = Boolean(parseTaskId && name.trim() && displayName.trim() && categoryId && !saving);

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
    setVisibility("space");
    setVersion("1.0.0");
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
          setVersion(status.result.version);
          setVisibility("space");
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
    if (!next || tags.includes(next)) return;
    setTags([...tags, next].slice(0, 5));
    setTagDraft("");
  }

  async function submit() {
    if (!name.trim() || !displayName.trim() || !categoryId) {
      setError(t("skillMarket.form.validationRequired"));
      return;
    }
    if (!parseTaskId) {
      setError(t("skillMarket.form.validationNoUpload"));
      return;
    }
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
        tags,
        visibility,
        version,
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
        footer={stage === "form" ? (
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>{t("skillMarket.common.cancel")}</WKButton>
            <WKButton variant="primary" onClick={() => void submit()} loading={saving} disabled={!canCreate}>{t("skillMarket.common.create")}</WKButton>
          </>
        ) : (
          <WKButton variant="secondary" onClick={requestClose}>{t("skillMarket.common.cancel")}</WKButton>
        )}
      >
        <div className="skill-market-workflow">
          {error && (
            <div className="skill-market-form__error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
          {stage !== "form" ? (
            <section className="skill-market-upload-panel">
              {(stage === "idle" || stage === "error") && (
                <label
                  className="skill-market-upload-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dropped = event.dataTransfer.files?.[0];
                    if (dropped) startUpload(dropped);
                  }}
                >
                  <input
                    aria-label={t("skillMarket.upload.selectFileAriaLabel")}
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                  />
                  <UploadCloud size={48} />
                  <strong>{t("skillMarket.upload.dropzoneTitle")}</strong>
                  <span>{t("skillMarket.upload.dropzoneHint")}</span>
                </label>
              )}
              {stage === "uploading" && (
                <div className="skill-market-upload-progress">
                  <FileArchive size={18} />
                  <div className="skill-market-upload-progress__info">
                    <strong>{file?.name}</strong>
                    <span>{file ? formatFileSize(file.size) : ""}</span>
                  </div>
                  <div className="skill-market-upload-status">
                    <div className="skill-market-upload-status__line">
                      <span>{t("skillMarket.upload.uploading")}</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="skill-market-progress" aria-label={t("skillMarket.upload.progressBarAriaLabel")}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {stage === "parsing" && (
                <>
                  <div className="skill-market-upload-progress">
                    <FileArchive size={18} />
                    <div className="skill-market-upload-progress__info">
                      <strong>{file?.name}</strong>
                      <span>{file ? formatFileSize(file.size) : ""}</span>
                    </div>
                  </div>
                  <div className="skill-market-parsing-center">
                    <Loader2 size={32} className="skill-market-spin" />
                    <span>{t("skillMarket.upload.parsing")}</span>
                  </div>
                </>
              )}
              {stage === "error" && (
                <WKButton variant="secondary" onClick={() => setStage("idle")}>{t("skillMarket.upload.reselect")}</WKButton>
              )}
            </section>
          ) : (
            <section className="skill-market-form skill-market-form--workflow">
              <div className="skill-market-upload-file">
                <FileArchive size={18} />
                <div>
                  <strong>{file?.name}</strong>
                  <span>{file ? formatFileSize(file.size) : "-"} · {t("skillMarket.upload.parsed")}</span>
                </div>
                <button type="button" onClick={() => setStage("idle")}>{t("skillMarket.upload.reuploadShort")}</button>
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
                <label className="skill-market-field-readonly">
                  <span>{t("skillMarket.form.englishName")}</span>
                  <span className="skill-market-field-readonly__value">{name}</span>
                </label>
                <label>
                  <span>{t("skillMarket.form.displayName")}<i className="skill-market-required">*</i></span>
                  <WKInput value={displayName} onChange={(v) => setDisplayName(v.slice(0, 20))} placeholder={t("skillMarket.form.displayNamePlaceholder")} maxLength={20} />
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
                  <div className="skill-market-tag-input">
                    {tags.map((tag) => (
                      <button key={tag} type="button" onClick={() => setTags(tags.filter((item) => item !== tag))}>
                        {tag}
                        <XCircle size={12} />
                      </button>
                    ))}
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder={t("skillMarket.form.tagPlaceholder")}
                    />
                  </div>
                </label>
              </div>
              <fieldset className="skill-market-radio-group">
                <legend>{t("skillMarket.form.visibility")}<i className="skill-market-required">*</i></legend>
                {[
                  ["space", t("skillMarket.form.visibilityPublic"), t("skillMarket.form.visibilityPublicHint")],
                  ["private", t("skillMarket.form.visibilityPrivate"), t("skillMarket.form.visibilityPrivateHint")],
                ].map(([value, label, hint]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      checked={visibility === value}
                      onChange={() => setVisibility(value as Visibility)}
                    />
                    <span>{label}</span>
                    <small className="skill-market-radio-hint">{hint}</small>
                  </label>
                ))}
              </fieldset>
              <div className="skill-market-doc-note">
                <CheckCircle2 size={15} />
                <span>{t("skillMarket.form.docNote")}</span>
              </div>
            </section>
          )}
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
