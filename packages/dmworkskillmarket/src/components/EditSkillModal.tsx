import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Box, CheckCircle2, FileArchive, ImagePlus, Loader2, XCircle } from "lucide-react";
import { WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, Skill, Visibility } from "../types/skill";
import { updateSkill, uploadIcon, initReupload, uploadFile, triggerParse, pollParse } from "../api/skillApi";
import { formatFileSize } from "../utils/format";
import IconCropModal from "./IconCropModal";

interface EditSkillModalProps {
  skill: Skill | null;
  categories: Category[];
  onClose: () => void;
  onUpdated: (skill: Skill) => void;
}

type UploadStage = "idle" | "uploading" | "parsing" | "error";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;

function validateZipFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".zip")) return "文件格式不正确";
  if (file.size > MAX_ZIP_SIZE) return "文件超过 20MB";
  return null;
}

export default function EditSkillModal({ skill, categories, onClose, onUpdated }: EditSkillModalProps) {
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
  const [visibility, setVisibility] = useState<Visibility>("space");
  const [version, setVersion] = useState("1.0.0");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parseTaskId, setParseTaskId] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconCropFile, setIconCropFile] = useState<File | null>(null);
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
    setVisibility(skill.visibility);
    setVersion(skill.version);
    setUploadStage("idle");
    setProgress(0);
    setUploadedFile(null);
    setParseTaskId(null);
    setIconPreview(skill.iconUrl || null);
    setIconBlob(null);
    setIconCropFile(null);
    setError(null);
    setConfirmClose(false);
    setTimeout(() => { abortRef.current = false; }, 0);
  }, [skill]);

  const busy = uploadStage === "uploading" || uploadStage === "parsing";
  const dirty = Boolean(skill) && (
    name !== skill?.name ||
    displayName !== (skill?.displayName ?? "") ||
    categoryId !== skill?.categoryId ||
    visibility !== skill?.visibility ||
    JSON.stringify(tags) !== JSON.stringify(skill?.tags) ||
    Boolean(uploadedFile) ||
    Boolean(iconBlob)
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
    if (!next || tags.includes(next)) return;
    setTags([...tags, next].slice(0, 5));
    setTagDraft("");
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
          setParseTaskId(taskId);
          setName(status.result.name);
          setDescription(status.result.description);
          setTags(status.result.tags);
          setVersion(status.result.version);
          setUploadStage("idle");
          setError(null);
          return;
        }
        if (status.status === "failed") {
          setUploadStage("error");
          setUploadedFile(null);
          setError(status.error?.message ?? "解析失败");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      setUploadStage("error");
      setError("解析超时，请重试");
    } catch (err) {
      if (!abortRef.current) {
        setUploadStage("error");
        setUploadedFile(null);
        setError(err instanceof Error ? err.message : "上传失败");
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
    if (!name.trim() || !displayName.trim() || !categoryId) {
      setError("请填写展示名称和分类");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let iconUrl: string | undefined;
      if (iconBlob) {
        iconUrl = await uploadIcon(iconBlob);
      }
      const updated = await updateSkill(skill.id, {
        ...(parseTaskId ? { parseTaskId } : {}),
        name,
        displayName,
        description,
        categoryId,
        tags,
        visibility,
        version,
        ...(iconUrl !== undefined ? { iconUrl } : {}),
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <WKModal
        visible={Boolean(skill)}
        onCancel={requestClose}
        title={skill ? `编辑 ${skill.name}` : "编辑 Skill"}
        size="lg"
        className="skill-market-workflow-modal"
        footer={
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>取消</WKButton>
            <WKButton
              variant="primary"
              onClick={() => void submit()}
              loading={saving}
              disabled={busy || uploadStage === "error" || !name.trim() || !displayName.trim()}
            >
              保存
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
              <span>
                {uploadedFile ? formatFileSize(uploadedFile.size) : skill ? formatFileSize(skill.fileSize) : "-"}
                {uploadedFile ? " · 已解析 SKILL.md" : " · 当前 Skill 包"}
              </span>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()}>重新上传 zip 包</button>
            <input
              ref={fileInputRef}
              aria-label="选择新的 Skill zip 文件"
              className="skill-market-upload-file__input"
              type="file"
              accept=".zip"
              onChange={handleFileChange}
            />
          </div>
          {uploadStage === "uploading" && (
            <div className="skill-market-upload-status">
              <div className="skill-market-upload-status__line">
                <span>上传进度</span>
                <strong>{progress}%</strong>
              </div>
              <div className="skill-market-progress" aria-label="上传进度条">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {uploadStage === "parsing" && (
            <div className="skill-market-upload-status is-parsing">
              <Loader2 size={16} />
              <span>解析中...</span>
            </div>
          )}
          {uploadStage === "error" && (
            <WKButton variant="secondary" onClick={() => fileInputRef.current?.click()}>重新选择文件</WKButton>
          )}

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
                <Box size={24} />
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
        title="确定离开？"
        size="md"
        footer={
          <>
            <WKButton variant="secondary" onClick={() => setConfirmClose(false)}>继续编辑</WKButton>
            <WKButton variant="danger" onClick={confirmLeave}>确认离开</WKButton>
          </>
        }
      >
        <p className="skill-market-confirm-text">
          {busy
            ? "确定离开？Skill 包正在上传/解析中，离开后当前进度将丢失，需要重新上传。"
            : "确定离开？尚未完成编辑，已上传的文件和填写的信息将丢失。"}
        </p>
      </WKModal>
    </>
  );
}
