import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Copy, Download, FileArchive, Lock, Pencil, Terminal, Trash2, Users } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import type { Category, Skill, SkillVersion } from "../types/skill";
import { downloadSkill, getSkill, listVersions } from "../api/skillApi";
import { formatFileSize, formatRelativeTime } from "../utils/format";
import { buildInstallPrompt, resolveAPIBaseURL } from "../utils/installPrompt";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";

interface SkillDetailModalProps {
  skillId: string | null;
  categories: Category[];
  refreshKey?: number;
  onClose: () => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onFeedback?: (message: string) => void;
}

type DetailTab = "intro" | "versions";

function visibilityText(value: Skill["visibility"]): string {
  if (value === "private") return t("skillMarket.detail.visibilityPrivate");
  if (value === "space") return t("skillMarket.detail.visibilitySpace");
  return t("skillMarket.detail.visibilityPublic");
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
  onFeedback,
}: SkillDetailModalProps) {
  useI18n();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("intro");
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      setActiveTab("intro");
      setVersions([]);
      setIconError(false);
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
          setError(t("skillMarket.detail.notFound"));
        } else {
          setError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
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
    const spaceId = WKApp.shared.currentSpaceId;
    if (!spaceId) return;
    const apiBaseURL = resolveAPIBaseURL(WKApp.apiClient.config.apiURL, window.location.origin);
    const prompt = buildInstallPrompt(skill.id, spaceId, apiBaseURL);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt).then(() => {
        onFeedback?.(t("skillMarket.detail.promptCopied"));
      });
    }
  }

  async function downloadSkillPackage() {
    if (!skill) return;
    try {
      await downloadSkill(skill.id);
      onFeedback?.(t("skillMarket.detail.downloadStarted"));
    } catch (err) {
      onFeedback?.(err instanceof Error ? err.message : t("skillMarket.detail.downloadFailed"));
    }
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
              <h2>{skill?.name ?? t("skillMarket.detail.title")}</h2>
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
                <span>{t("skillMarket.detail.updatedAt", { values: { time: formatRelativeTime(skill.updatedAt) } })}</span>
                <span>
                  {skill.visibility === "private" ? <Lock size={12} /> : <Users size={12} />}
                  {visibilityText(skill.visibility)}
                </span>
              </div>
            )}
            {hasOwnerActions && skill && (
              <div className="skill-market-detail-header__actions">
                {onEdit && (
                  <button type="button" aria-label={t("skillMarket.card.editAriaLabel", { values: { name: skill.name } })} title={t("skillMarket.common.edit")} onClick={() => onEdit(skill)}>
                    <Pencil size={16} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" aria-label={t("skillMarket.card.deleteAriaLabel", { values: { name: skill.name } })} title={t("skillMarket.common.delete")} onClick={() => onDelete(skill)}>
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
      {loading && <div className="skill-market-modal-state">{t("skillMarket.common.loading")}</div>}
      {error && <div className="skill-market-modal-state is-error">{error}</div>}
      {skill && !loading && (
        <div className="skill-market-detail">
          <p className="skill-market-detail__desc">{skill.description}</p>

          {/* Tabs */}
          <div className="skill-market-detail__tabs">
            <button
              type="button"
              className={activeTab === "intro" ? "is-active" : ""}
              onClick={() => setActiveTab("intro")}
            >
              {t("skillMarket.detail.tabIntro")}
            </button>
            <button
              type="button"
              className={activeTab === "versions" ? "is-active" : ""}
              onClick={() => setActiveTab("versions")}
            >
              {t("skillMarket.detail.tabVersions")}
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
                    <strong>{t("skillMarket.detail.installTitle")}</strong>
                  </div>
                  <p className="skill-market-install__hint">{t("skillMarket.detail.installHint")}</p>
                  <div className="skill-market-install__actions">
                    <WKButton variant="primary" icon={<Copy size={15} />} onClick={copyInstallPrompt}>
                      {t("skillMarket.detail.copyPrompt")}
                    </WKButton>
                  </div>
                </section>
                <section className="skill-market-install__section">
                  <div className="skill-market-install__title">
                    <FileArchive size={17} />
                    <strong>{t("skillMarket.detail.downloadTitle")}</strong>
                  </div>
                  <div className="skill-market-install__file">
                    <span>{skill.fileName}</span>
                    <strong>{formatFileSize(skill.fileSize)}</strong>
                  </div>
                  <div className="skill-market-install__actions">
                    <WKButton variant="secondary" icon={<Download size={15} />} onClick={downloadSkillPackage}>
                      {t("skillMarket.detail.downloadBtn")}
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
                <strong>{t("skillMarket.detail.tabVersions")}</strong>
              </div>
              {versionsLoading && <div className="skill-market-versions__loading">{t("skillMarket.common.loading")}</div>}
              {!versionsLoading && (
                <div className="skill-market-versions__timeline">
                  {versions.map((v, idx) => (
                    <div key={v.id} className={`skill-market-versions__item${idx === 0 ? " is-current" : ""}`}>
                      <div className="skill-market-versions__dot" />
                      <div className="skill-market-versions__content">
                        <div className="skill-market-versions__row">
                          <span className="skill-market-versions__ver">v{v.version}</span>
                          {idx === 0 && <span className="skill-market-versions__badge">{t("skillMarket.detail.latest")}</span>}
                          <span className="skill-market-versions__date">{formatDate(v.createdAt)}</span>
                        </div>
                        {v.changelog && <p className="skill-market-versions__desc">{v.changelog}</p>}
                      </div>
                    </div>
                  ))}
                  {versions.length === 0 && !versionsLoading && (
                    <p className="skill-market-versions__empty">{t("skillMarket.detail.noVersions")}</p>
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
