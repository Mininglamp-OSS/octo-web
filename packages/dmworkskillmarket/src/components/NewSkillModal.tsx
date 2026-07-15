import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileArchive, ImagePlus, Loader2, UploadCloud, XCircle } from "lucide-react";
import { WKButton, WKInput, WKModal } from "@octo/base";
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
  if (!file.name.toLowerCase().endsWith(".zip")) return "文件格式不正确";
  if (file.size > MAX_ZIP_SIZE) return "文件超过 20MB";
  return null;
}

export default function NewSkillModal({ visible, categories, onClose, onCreated }: NewSkillModalProps) {
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
          setError(status.error?.message ?? "解析失败");
          return;
        }
        // Still pending/parsing — wait 1s and retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      // Timeout
      setStage("error");
      setError("解析超时，请重试");
    } catch (err) {
      if (!abortRef.current) {
        setStage("error");
        setError(err instanceof Error ? err.message : "上传失败");
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
      setError("请填写展示名称和分类");
      return;
    }
    if (!parseTaskId) {
      setError("请先上传并解析 Skill 压缩包");
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
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <WKModal
        visible={visible}
        onCancel={requestClose}
        title="新建 Skill"
        size="lg"
        className="skill-market-workflow-modal"
        footer={stage === "form" ? (
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>取消</WKButton>
            <WKButton variant="primary" onClick={() => void submit()} loading={saving} disabled={!canCreate}>创建</WKButton>
          </>
        ) : (
          <WKButton variant="secondary" onClick={requestClose}>取消</WKButton>
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
                    aria-label="选择 Skill zip 文件"
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                  />
                  <UploadCloud size={28} />
                  <strong>上传 Skill 压缩包（.zip，≤20MB）</strong>
                  <span>zip 内需包含 SKILL.md 文件</span>
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
                      <span>上传中</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="skill-market-progress" aria-label="上传进度条">
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
                    <span>解析中...</span>
                  </div>
                </>
              )}
              {stage === "error" && (
                <WKButton variant="secondary" onClick={() => setStage("idle")}>重新选择文件</WKButton>
              )}
            </section>
          ) : (
            <section className="skill-market-form skill-market-form--workflow">
              <div className="skill-market-upload-file">
                <FileArchive size={18} />
                <div>
                  <strong>{file?.name}</strong>
                  <span>{file ? formatFileSize(file.size) : "-"} · 已解析 SKILL.md</span>
                </div>
                <button type="button" onClick={() => setStage("idle")}>重新上传</button>
              </div>

              <h3 className="skill-market-form__section-title">基本信息</h3>

              <div className="skill-market-form__icon-row">
                <label className="skill-market-icon-upload" title="上传图标">
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
                  <span>英文名</span>
                  <span className="skill-market-field-readonly__value">{name}</span>
                </label>
                <label>
                  <span>展示名称<i className="skill-market-required">*</i></span>
                  <WKInput value={displayName} onChange={(v) => setDisplayName(v.slice(0, 20))} placeholder="请输入展示名称，最多20个字符" maxLength={20} />
                </label>
              </div>
              <div className="skill-market-form__row">
                <label>
                  <span>分类<i className="skill-market-required">*</i></span>
                  <select aria-label="分类" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">请选择分类</option>
                    {selectableCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>标签</span>
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
                      placeholder="输入标签后回车"
                    />
                  </div>
                </label>
              </div>
              <fieldset className="skill-market-radio-group">
                <legend>可见性<i className="skill-market-required">*</i></legend>
                {[
                  ["space", "公开", "Space 内所有成员可见"],
                  ["private", "非公开", "仅自己可见"],
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
                <span>由 SKILL.md 自动解析，如需修改请重新上传 zip 包</span>
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
      title="确定离开？"
      size="md"
      footer={
        <>
          <WKButton variant="secondary" onClick={onKeep}>{mode === "busy" ? "继续上传" : "继续编辑"}</WKButton>
          <WKButton variant="danger" onClick={onLeave}>确认离开</WKButton>
        </>
      }
    >
      <p className="skill-market-confirm-text">
        {mode === "busy"
          ? "确定离开？Skill 包正在上传/解析中，离开后当前进度将丢失，需要重新上传。"
          : "确定离开？尚未完成创建，已上传的文件和填写的信息将丢失。"}
      </p>
    </WKModal>
  );
}
