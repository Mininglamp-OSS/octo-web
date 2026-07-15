import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ArrowUpFromLine, Copy, Download, FileArchive, Lock, Pencil, Terminal, Trash2, Users } from "lucide-react";
import { WKApp, WKButton, WKModal } from "@octo/base";
import type { Category, Skill, SkillVersion } from "../types/skill";
import { downloadSkill, getSkill, listVersions } from "../api/skillApi";
import { formatFileSize, formatRelativeTime } from "../utils/format";
import { buildInstallPrompt } from "../utils/installPrompt";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import PublishVersionModal from "./PublishVersionModal";

interface SkillDetailModalProps {
  skillId: string | null;
  categories: Category[];
  refreshKey?: number;
  onClose: () => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onPublishVersion?: () => void;
  onFeedback?: (message: string) => void;
}

type DetailTab = "intro" | "versions";

function visibilityText(value: Skill["visibility"]): string {
  if (value === "private") return "私有";
  if (value === "space") return "空间可见";
  return "公开";
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function SkillDetailModal({
  skillId,
  categories,
  refreshKey = 0,
  onClose,
  onEdit,
  onDelete,
  onPublishVersion,
  onFeedback,
}: SkillDetailModalProps) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("intro");
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      setActiveTab("intro");
      setVersions([]);
      setIconError(false);
      setPublishing(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getSkill(skillId)
      .then((item) => {
        if (alive) setSkill(item);
      })
      .catch((err) => {
        if (!alive) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          setError("Skill 不存在或已被删除");
        } else {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [skillId, refreshKey]);

  // Fetch versions when tab switches to versions
  useEffect(() => {
    if (activeTab !== "versions" || !skillId) return;
    let alive = true;
    setVersionsLoading(true);
    listVersions(skillId)
      .then((items) => {
        if (alive) setVersions(items);
      })
      .catch(() => {
        if (alive) setVersions([]);
      })
      .finally(() => {
        if (alive) setVersionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTab, skillId, refreshKey]);

  const categoryName = skill ? categories.find((category) => category.id === skill.categoryId)?.name : "";
  const currentUid = (WKApp.loginInfo as { uid?: string } | undefined)?.uid;
  const isOwner = Boolean(skill && currentUid && skill.ownerId === currentUid);
  const hasOwnerActions = Boolean(skill && isOwner && (onEdit || onDelete));

  function copyInstallPrompt() {
    if (!skill) return;
    const prompt = buildInstallPrompt(skill.id);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt).then(() => {
        onFeedback?.("安装 Prompt 已复制");
      });
    }
  }

  function downloadSkillPackage() {
    if (!skill) return;
    downloadSkill(skill.id);
    onFeedback?.("下载已打开");
  }

  function handlePublishVersion() {
    if (!skill) return;
    setPublishing(true);
  }

  function handlePublished(updated: Skill) {
    setPublishing(false);
    setSkill(updated);
    onPublishVersion?.();
    onFeedback?.("新版本已发布");
  }

  return (
    <WKModal
      visible={Boolean(skillId)}
      onCancel={onClose}
      title={null}
      size="lg"
      header={
        <div className="skill-market-detail-header">
          <span className="skill-market-detail-header__icon">
            {skill?.iconUrl && !iconError ? (
              <img src={skill.iconUrl} alt="" onError={() => setIconError(true)} />
            ) : (
              <span style={{ background: getSkillAvatarColor(skill?.name ?? "") }}>
                {getSkillAvatarText(skill?.name ?? "")}
              </span>
            )}
          </span>
          <div className="skill-market-detail-header__center">
            <div className="skill-market-detail-header__title-row">
              <h2>{skill?.name ?? "Skill 详情"}</h2>
              {categoryName && <span className="skill-market-detail-header__badge">{categoryName}</span>}
            </div>
            {skill && (
              <div className="skill-market-detail-header__tags">
                {skill.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            )}
          </div>
          <div className="skill-market-detail-header__right">
            {skill && (
              <div className="skill-market-detail-header__meta">
                <span>@{skill.ownerName}</span>
                <span>{formatRelativeTime(skill.updatedAt)}更新</span>
                <span>
                  {skill.visibility === "private" ? <Lock size={12} /> : <Users size={12} />}
                  {visibilityText(skill.visibility)}
                </span>
              </div>
            )}
            {hasOwnerActions && skill && (
              <div className="skill-market-detail-header__actions">
                {onEdit && (
                  <button type="button" aria-label={`编辑 ${skill.name}`} title="编辑" onClick={() => onEdit(skill)}>
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" aria-label={`删除 ${skill.name}`} title="删除" onClick={() => onDelete(skill)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      }
      bodyStyle={{ maxHeight: "68vh", overflow: "auto" }}
    >
      {publishing && skill && (
        <PublishVersionModal
          skill={skill}
          embedded
          onClose={() => setPublishing(false)}
          onPublished={handlePublished}
        />
      )}
      {!publishing && loading && <div className="skill-market-modal-state">加载中...</div>}
      {!publishing && error && <div className="skill-market-modal-state is-error">{error}</div>}
      {!publishing && skill && !loading && (
        <div className="skill-market-detail">
          <p className="skill-market-detail__desc">{skill.description}</p>

          {/* Tabs */}
          <div className="skill-market-detail__tabs">
            <button
              type="button"
              className={activeTab === "intro" ? "is-active" : ""}
              onClick={() => setActiveTab("intro")}
            >
              Skill 介绍
            </button>
            <button
              type="button"
              className={activeTab === "versions" ? "is-active" : ""}
              onClick={() => setActiveTab("versions")}
            >
              版本历史
            </button>
          </div>

          {/* Tab content: intro */}
          {activeTab === "intro" && (
            <div className="skill-market-detail__layout">
              <div className="skill-market-detail__readme">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {skill.readmeContent}
                </ReactMarkdown>
              </div>
              <aside className="skill-market-install">
                <section className="skill-market-install__section">
                  <div className="skill-market-install__title">
                    <Terminal size={17} />
                    <strong>Agent 安装</strong>
                  </div>
                  <p className="skill-market-install__hint">复制安装 Prompt 粘贴到 Agent 对话中，自动完成安装。</p>
                  <div className="skill-market-install__actions">
                    <WKButton variant="primary" icon={<Copy size={15} />} onClick={copyInstallPrompt}>
                      复制安装 Prompt
                    </WKButton>
                  </div>
                </section>
                <section className="skill-market-install__section">
                  <div className="skill-market-install__title">
                    <FileArchive size={17} />
                    <strong>下载</strong>
                  </div>
                  <div className="skill-market-install__file">
                    <span>{skill.fileName}</span>
                    <strong>{formatFileSize(skill.fileSize)}</strong>
                  </div>
                  <div className="skill-market-install__actions">
                    <WKButton variant="secondary" icon={<Download size={15} />} onClick={downloadSkillPackage}>
                      下载 Skill 包
                    </WKButton>
                  </div>
                </section>
              </aside>
            </div>
          )}

          {/* Tab content: versions */}
          {activeTab === "versions" && (
            <div className="skill-market-versions">
              <div className="skill-market-versions__header">
                <strong>版本历史</strong>
                {isOwner && (
                  <button
                    type="button"
                    className="skill-market-versions__upload"
                    title="上传新版本"
                    onClick={handlePublishVersion}
                  >
                    <ArrowUpFromLine size={16} />
                  </button>
                )}
              </div>
              {versionsLoading && <div className="skill-market-versions__loading">加载中...</div>}
              {!versionsLoading && (
                <div className="skill-market-versions__timeline">
                  {versions.map((v, idx) => (
                    <div key={v.id} className={`skill-market-versions__item${idx === 0 ? " is-current" : ""}`}>
                      <div className="skill-market-versions__dot" />
                      <div className="skill-market-versions__content">
                        <div className="skill-market-versions__row">
                          <span className="skill-market-versions__ver">v{v.version}</span>
                          {idx === 0 && <span className="skill-market-versions__badge">最新</span>}
                          <span className="skill-market-versions__date">{formatDate(v.createdAt)}</span>
                        </div>
                        {v.changelog && <p className="skill-market-versions__desc">{v.changelog}</p>}
                      </div>
                    </div>
                  ))}
                  {versions.length === 0 && !versionsLoading && (
                    <p className="skill-market-versions__empty">暂无历史版本</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </WKModal>
  );
}
