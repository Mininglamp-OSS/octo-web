import React, { useRef, useState } from "react";
import { ArrowUpFromLine, Loader2, Upload } from "lucide-react";
import { WKButton, WKModal } from "@octo/base";
import type { Skill } from "../types/skill";
import { initReupload, uploadFile, triggerParse, pollParse, updateSkill } from "../api/skillApi";

interface PublishVersionModalProps {
  skill: Skill | null;
  /** When true, renders only the form content without WKModal wrapper */
  embedded?: boolean;
  onClose: () => void;
  onPublished: (skill: Skill) => void;
}

type Step = 1 | 2 | 3;
type UploadStage = "idle" | "uploading" | "parsing" | "done" | "error";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;

function bumpPatch(ver: string): string {
  const parts = ver.split(".");
  if (parts.length < 3) return ver;
  const patch = parseInt(parts[2], 10);
  parts[2] = String(isNaN(patch) ? 1 : patch + 1);
  return parts.join(".");
}

function validateZipFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".zip")) return "文件格式不正确";
  if (file.size > MAX_ZIP_SIZE) return "文件超过 20MB";
  return null;
}

export default function PublishVersionModal({ skill, embedded, onClose, onPublished }: PublishVersionModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef(false);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Parse results
  const [parseTaskId, setParseTaskId] = useState<string | null>(null);

  // Step 3 form
  const [version, setVersion] = useState(() => bumpPatch(skill?.version ?? "1.0.0"));
  const [changelog, setChangelog] = useState("");
  const [saving, setSaving] = useState(false);

  async function startUpload(file: File) {
    if (!skill) return;
    const validationError = validateZipFile(file);
    if (validationError) {
      setError(validationError);
      setUploadStage("error");
      return;
    }

    setStep(1);
    setUploadStage("uploading");
    setProgress(0);
    setError(null);
    abortRef.current = false;

    try {
      const { uploadId, presignedUrl, headers } = await initReupload(skill.id, file.name, file.size);
      if (abortRef.current) return;

      await uploadFile(presignedUrl, file, headers, (percent) => {
        if (!abortRef.current) setProgress(percent);
      });
      if (abortRef.current) return;

      // Move to step 2
      setStep(2);
      setUploadStage("parsing");

      const { taskId } = await triggerParse(uploadId);
      if (abortRef.current) return;

      let attempts = 0;
      while (attempts < 60) {
        if (abortRef.current) return;
        const status = await pollParse(taskId);
        if (abortRef.current) return;

        if (status.status === "success" && status.result) {
          setParseTaskId(taskId);
          setUploadStage("done");
          setStep(3);
          return;
        }
        if (status.status === "failed") {
          setUploadStage("error");
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
        setError(err instanceof Error ? err.message : "上传失败");
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void startUpload(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void startUpload(file);
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
  }

  async function submit() {
    if (!skill || !parseTaskId || !version.trim()) return;
    if (!changelog.trim()) {
      setError("请填写更新说明");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSkill(skill.id, {
        parseTaskId,
        version,
        changelog,
      });
      onPublished(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    abortRef.current = true;
    onClose();
  }

  if (!skill) return null;

  const content = (
    <div className="skill-market-publish">
      {/* Stepper */}
      <div className="skill-market-publish__stepper">
        <div className={`skill-market-publish__step${step >= 1 ? " is-active" : ""}`}>
          <span className="skill-market-publish__step-num">1</span>
          <span>上传 zip 包</span>
        </div>
        <div className="skill-market-publish__step-line" />
        <div className={`skill-market-publish__step${step >= 2 ? " is-active" : ""}`}>
          <span className="skill-market-publish__step-num">2</span>
          <span>解析版本</span>
        </div>
        <div className="skill-market-publish__step-line" />
        <div className={`skill-market-publish__step${step >= 3 ? " is-active" : ""}`}>
          <span className="skill-market-publish__step-num">3</span>
          <span>确认发布</span>
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && uploadStage !== "uploading" && (
        <div
          className="skill-market-publish__dropzone"
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={24} />
          <strong>点击或拖拽上传 Skill zip 包</strong>
          <span>zip 包需包含 SKILL.md，最大 10MB</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Step 1: Uploading progress */}
      {step === 1 && uploadStage === "uploading" && (
        <div className="skill-market-publish__status">
          <Loader2 size={32} className="skill-market-spinner" />
          <span>正在上传... {progress}%</span>
        </div>
      )}

      {/* Step 2: Parsing */}
      {step === 2 && uploadStage === "parsing" && (
        <div className="skill-market-publish__status">
          <Loader2 size={32} className="skill-market-spinner" />
          <span>正在解析 SKILL.md...</span>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="skill-market-publish__form">
          <label>
            <span>新版本号 *</span>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="例如 1.2.0"
            />
          </label>

          <label>
            <span>更新说明 *</span>
            <textarea
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="简述此版本变更内容"
              rows={4}
            />
          </label>
        </div>
      )}

      {/* Error */}
      {error && <div className="skill-market-publish__error">{error}</div>}

      {/* Footer */}
      <div className="skill-market-publish__footer">
        <WKButton variant="secondary" onClick={handleClose}>取消</WKButton>
        {step === 3 && (
          <WKButton
            variant="primary"
            icon={<ArrowUpFromLine size={15} />}
            onClick={submit}
            disabled={saving || !version.trim() || !changelog.trim()}
          >
            {saving ? "发布中..." : "发布版本"}
          </WKButton>
        )}
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <WKModal
      visible={true}
      onCancel={handleClose}
      title={`发布新版本 — ${skill.name}`}
      size="md"
      zIndex={1100}
      bodyStyle={{ minHeight: "320px" }}
    >
      {content}
    </WKModal>
  );
}
