import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Download, Eye, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import type { Category, Skill, SkillVersion } from "../types/skill";
import { getSkill, getSkillMd, listVersions, trackSkillView } from "../api/skillApi";
import { formatCount, formatFullDateTime, formatRecentOrDate } from "../utils/format";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";

interface SkillDetailModalProps {
  skillId: string | null;
  categories: Category[];
  refreshKey?: number;
  onClose: () => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
}

type DetailTab = "intro" | "versions";
type TagTooltipState = { text: string; style: React.CSSProperties } | null;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?\r?\n)---\r?\n?/;
const FRONTMATTER_FIELD_ORDER = ["name", "description", "version", "tags", "id", "forked_from"];

function formatDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed[0] === "\"" && trimmed.endsWith("\"")) || (trimmed[0] === "'" && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw: string): { rows: Array<[string, string]>; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { rows: [], body: raw };

  const values = new Map<string, string>();
  let activeArrayKey: string | null = null;
  const arrayValues = new Map<string, string[]>();

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (activeArrayKey && trimmed.startsWith("- ")) {
      arrayValues.set(activeArrayKey, [...(arrayValues.get(activeArrayKey) ?? []), stripYamlQuotes(trimmed.slice(2))]);
      continue;
    }

    activeArrayKey = null;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;

    if (!value) {
      activeArrayKey = key;
      arrayValues.set(key, []);
      continue;
    }

    values.set(key, stripYamlQuotes(value));
  }

  for (const [key, items] of arrayValues) {
    if (items.length > 0) values.set(key, items.join(", "));
  }

  const keys = [
    ...FRONTMATTER_FIELD_ORDER.filter((key) => values.has(key)),
    ...Array.from(values.keys()).filter((key) => !FRONTMATTER_FIELD_ORDER.includes(key)),
  ];

  return {
    rows: keys.map((key) => [key, values.get(key) ?? ""]),
    body: raw.slice(match[0].length),
  };
}

function fallbackFrontmatterRows(skill: Skill): Array<[string, string]> {
  return [
    ["name", skill.name],
    ["description", skill.description],
    ["version", skill.version],
    ...(skill.tags.length ? [["tags", skill.tags.join(", ")] as [string, string]] : []),
  ];
}

export default function SkillDetailModal({
  skillId,
  categories,
  refreshKey = 0,
  onClose,
  onEdit,
  onDelete,
}: SkillDetailModalProps) {
  useI18n();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("intro");
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [tagTooltip, setTagTooltip] = useState<TagTooltipState>(null);

  // SKILL.md content fetched from the new endpoint
  const [mdContent, setMdContent] = useState<string | null>(null);
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState(false);

  useEffect(() => {
    if (!skillId) return;
    void trackSkillView(skillId).catch(() => {
      // View tracking is best-effort and should not block the detail page.
    });
  }, [skillId]);

  useEffect(() => {
    if (!skillId) {
      setSkill(null);
      setActiveTab("intro");
      setVersions([]);
      setIconError(false);
      setMdContent(null);
      setMdError(false);
      setTagTooltip(null);
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

  // Fetch SKILL.md content from the dedicated endpoint
  const fetchSkillMd = useCallback((id: string) => {
    let alive = true;
    setMdLoading(true);
    setMdError(false);
    setMdContent(null);
    getSkillMd(id)
      .then((text) => {
        if (alive) setMdContent(text);
      })
      .catch((err) => {
        if (!alive) return;
        const status = (err as { status?: number }).status;
        if (status === 404) {
          // Fallback: no SKILL.md available, will use readmeContent
          setMdContent(null);
        } else {
          setMdError(true);
        }
      })
      .finally(() => {
        if (alive) setMdLoading(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!skillId) return;
    return fetchSkillMd(skillId);
  }, [skillId, refreshKey, fetchSkillMd]);

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
  const parsedMarkdown = skill ? parseFrontmatter(mdContent ?? skill.readmeContent) : { rows: [], body: "" };
  const frontmatterRows = skill ? (parsedMarkdown.rows.length > 0 ? parsedMarkdown.rows : fallbackFrontmatterRows(skill)) : [];
  const readmeBody = skill ? (parsedMarkdown.body || t("skillMarket.detail.noDetail")) : "";
  const creatorName = skill ? (skill.creatorName || skill.ownerName) : "";
  const ownerLabel = skill ? `@${creatorName}` : "";
  const showOwner = Boolean(skill && skill.visibility !== "public");
  const displayName = skill ? (skill.displayName || skill.name) : t("skillMarket.detail.title");
  const versionLabel = skill?.version ? `v${skill.version}` : "";
  const viewCountLabel = formatCount(skill?.viewCount ?? 0);
  const downloadCountLabel = formatCount(skill?.downloadCount ?? 0);
  const updatedTimeLabel = skill ? formatRecentOrDate(skill.updatedAt) : "";
  const updatedTimeTitle = skill ? formatFullDateTime(skill.updatedAt) : "";

  function showTagTooltip(event: React.MouseEvent<HTMLSpanElement> | React.FocusEvent<HTMLSpanElement>, tag: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportPadding = 12;
    const maxWidth = Math.max(180, Math.min(360, window.innerWidth - viewportPadding * 2));
    const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - maxWidth - viewportPadding);
    const top = Math.min(rect.bottom + 6, window.innerHeight - viewportPadding);
    setTagTooltip({ text: tag, style: { left, top, maxWidth } });
  }

  return (
    <>
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
          <div className="skill-market-detail-header__main">
            <div className="skill-market-detail-header__top-row">
              <div className="skill-market-detail-header__title-row">
                <h2 title={displayName}>{displayName}</h2>
                {categoryName && (
                  <span className="skill-market-detail-header__badge" title={categoryName}>
                    {categoryName}
                  </span>
                )}
              </div>
              <div className="skill-market-detail-header__right">
                {versionLabel && (
                  <span className="skill-market-detail-header__version" title={versionLabel}>
                    {versionLabel}
                  </span>
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
            {skill && (
              <div className="skill-market-detail-header__meta">
                <span className="skill-market-detail-header__name" title={skill.name}>{skill.name}</span>
                {showOwner && (
                  <>
                    <span className="skill-market-detail-header__separator">·</span>
                    <span className="skill-market-detail-header__owner" title={ownerLabel}>{ownerLabel}</span>
                  </>
                )}
                <span className="skill-market-detail-header__separator">·</span>
                <span className="skill-market-detail-header__updated" title={updatedTimeTitle}>
                  {t("skillMarket.detail.updatedAt", { values: { time: updatedTimeLabel } })}
                </span>
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
          <div className="skill-market-detail__stats" aria-label={t("skillMarket.card.statsAriaLabel")}>
            <span title={t("skillMarket.card.viewsTitle", { values: { count: skill.viewCount ?? 0 } })}>
              <Eye size={13} aria-hidden="true" />
              <strong>{viewCountLabel}</strong>
            </span>
            <span title={t("skillMarket.card.downloadsTitle", { values: { count: skill.downloadCount ?? 0 } })}>
              <Download size={13} aria-hidden="true" />
              <strong>{downloadCountLabel}</strong>
            </span>
          </div>
          {skill.tags.length > 0 && (
            <div className="skill-market-detail__tags" aria-label={t("skillMarket.filter.tags")}>
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  tabIndex={0}
                  onMouseEnter={(event) => showTagTooltip(event, tag)}
                  onMouseLeave={() => setTagTooltip(null)}
                  onFocus={(event) => showTagTooltip(event, tag)}
                  onBlur={() => setTagTooltip(null)}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

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
                {mdLoading && (
                  <div className="skill-market-modal-state">{t("skillMarket.common.loading")}</div>
                )}
                {mdError && (
                  <div className="skill-market-modal-state is-error">
                    <span>{t("skillMarket.common.loadFailed")}</span>
                    <WKButton
                      variant="secondary"
                      size="small"
                      icon={<RefreshCw size={14} />}
                      onClick={() => skillId && fetchSkillMd(skillId)}
                    >
                      {t("skillMarket.detail.retry")}
                    </WKButton>
                  </div>
                )}
                {!mdLoading && !mdError && (
                  <>
                    {frontmatterRows.length > 0 && (
                      <table className="skill-market-detail__frontmatter">
                        <tbody>
                          {frontmatterRows.map(([key, value]) => (
                            <tr key={key}>
                              <th>{key}</th>
                              <td>{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                      {readmeBody}
                    </ReactMarkdown>
                  </>
                )}
              </div>
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
    {tagTooltip &&
      createPortal(
        <div className="skill-market-detail__tag-tooltip" role="tooltip" style={tagTooltip.style}>
          {tagTooltip.text}
        </div>,
        document.body
      )}
    </>
  );
}
