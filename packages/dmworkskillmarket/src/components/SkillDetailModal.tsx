import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Copy, Download, FileArchive, Lock, Pencil, Trash2, Users } from "lucide-react";
import { WKButton, WKModal } from "@octo/base";
import type { Category, Skill } from "../types/skill";
import { downloadSkill, getSkill } from "../api/skillApi";
import { formatFileSize, formatRelativeTime } from "../utils/format";

interface SkillDetailModalProps {
  skillId: string | null;
  categories: Category[];
  refreshKey?: number;
  onClose: () => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onFeedback?: (message: string) => void;
}

function visibilityText(value: Skill["visibility"]): string {
  if (value === "private") return "私有";
  if (value === "space") return "空间可见";
  return "公开";
}

export default function SkillDetailModal({
  skillId,
  categories,
  refreshKey = 0,
  onClose,
  onEdit,
  onDelete,
  onFeedback,
}: SkillDetailModalProps) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installFeedback, setInstallFeedback] = useState<"copied" | "download" | null>(null);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setInstallFeedback(null);
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

  const categoryName = skill ? categories.find((category) => category.id === skill.categoryId)?.name : "";
  const hasOwnerActions = Boolean(skill && (onEdit || onDelete));

  function copyDownloadLink() {
    if (!skill) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(skill.fileUrl).then(() => {
        setInstallFeedback("copied");
        onFeedback?.("已复制");
      });
      return;
    }
    setInstallFeedback(null);
    onFeedback?.("复制失败");
  }

  function downloadSkillPackage() {
    if (!skill) return;
    downloadSkill(skill.id);
    setInstallFeedback("download");
    onFeedback?.("下载已打开");
  }

  return (
    <WKModal
      visible={Boolean(skillId)}
      onCancel={onClose}
      title={null}
      size="lg"
      header={
        <div className="skill-market-detail-header">
          <div className="skill-market-detail-header__main">
            <h2>{skill?.name ?? "Skill 详情"}</h2>
            {categoryName && <span>{categoryName}</span>}
          </div>
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
      }
      bodyStyle={{ maxHeight: "68vh", overflow: "auto" }}
    >
      {loading && <div className="skill-market-modal-state">加载中...</div>}
      {error && <div className="skill-market-modal-state is-error">{error}</div>}
      {skill && !loading && (
        <div className="skill-market-detail">
          <div className="skill-market-detail__summary">
            <div className="skill-market-detail__tags">
              {skill.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <div className="skill-market-detail__meta">
              <span>@{skill.ownerName}</span>
              <span>{formatRelativeTime(skill.updatedAt)}更新</span>
              <span>
                {skill.visibility === "private" ? <Lock size={13} /> : <Users size={13} />}
                {visibilityText(skill.visibility)}
              </span>
            </div>
            <p className="skill-market-detail__desc">{skill.description}</p>
          </div>
          <div className="skill-market-detail__layout">
            <div className="skill-market-detail__readme">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {skill.readmeContent}
              </ReactMarkdown>
            </div>
            <aside className="skill-market-install">
              <div className="skill-market-install__title">
                <FileArchive size={17} />
                <strong>安装方式</strong>
              </div>
              <ol>
                <li>点击「下载」获取 .zip 文件</li>
                <li>解压到 Agent 技能目录</li>
                <li>重启 Agent 或重新加载技能</li>
              </ol>
              <div className="skill-market-install__file">
                <span>{skill.fileName}</span>
                <strong>{formatFileSize(skill.fileSize)}</strong>
              </div>
              <div className="skill-market-install__actions">
                <WKButton variant="primary" icon={<Download size={15} />} onClick={downloadSkillPackage}>
                  下载 Skill 包
                </WKButton>
                <WKButton variant="secondary" icon={<Copy size={15} />} onClick={copyDownloadLink}>
                  复制下载链接
                </WKButton>
              </div>
              {installFeedback && (
                <div className="skill-market-install__feedback" role="status">
                  {installFeedback === "copied" ? (
                    <>
                      <strong>已复制</strong>
                      <span>已复制下载链接</span>
                    </>
                  ) : (
                    <>
                      <strong>下载已打开</strong>
                      <span>浏览器已打开下载链接</span>
                    </>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </WKModal>
  );
}
