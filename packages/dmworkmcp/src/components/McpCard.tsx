import React from "react";
import { Tooltip } from "@douyinfe/semi-ui";
import { IconWrenchStroked } from "@douyinfe/semi-icons";
import { Bot, Pencil, Plug, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { McpListItem } from "../types/mcp";
import { t } from "@octo/base";
import { IconGlyph } from "../utils/icon";
import { getMcpAvatarColor, getMcpAvatarText } from "../utils/mcpAvatar";
import { isOfficialMcp } from "../utils/publisher";

interface McpCardProps {
  item: McpListItem;
  onClick: (item: McpListItem) => void;
  onEdit?: (item: McpListItem) => void;
  onDelete?: (item: McpListItem) => void;
  /** Show the footer stats row. Discovery hides it; the 我的 view keeps it. */
  showStats?: boolean;
  /** Render the horizontal "我的发布" row layout instead of the grid card. */
  row?: boolean;
}

/** Parse a backend `match_reasons` entry into an i18n key + optional value.
 *  Wire shape is `"<type>:<value>"` where `<type>` is one of the fixed set
 *  below; unknown types fall through to `other` so the card still renders a
 *  labelled chip rather than blowing up. */
export function parseMatchReason(reason: string): { key: string; value?: string } {
  const colon = reason.indexOf(":");
  const type = colon < 0 ? reason : reason.slice(0, colon);
  const value = colon < 0 ? undefined : reason.slice(colon + 1);
  const keys: Record<string, string> = {
    name: "name",
    description: "description",
    category: "category",
    usage_example: "usage",
    tool: "tool",
    tag: "tag",
    creator: "creator",
  };
  return { key: `mcp.card.matchReason.${keys[type] ?? "other"}`, value };
}

/** Renders the "为什么命中" chips under the card tags. Only reveals fields
 *  the card itself doesn't already show (tool / usage_example / creator) —
 *  matches on name / description / tag are visible in the card body and
 *  don't need their own chip. */
export function MatchReasons({ reasons, hideCreator = false }: { reasons: string[]; hideCreator?: boolean }) {
  const revealing = reasons.filter((reason) => {
    const type = reason.split(":", 1)[0];
    if (hideCreator && type === "creator") return false;
    return type === "tool" || type === "usage_example" || type === "creator";
  });
  if (!revealing.length) return null;
  return (
    <div className="wk-mcp-card__reasons">
      {revealing.map((reason) => {
        const parsed = parseMatchReason(reason);
        return (
          <span className="wk-mcp-card__reason" key={reason}>
            <span className="wk-mcp-card__reason-label">{t(parsed.key)}</span>
            {parsed.value ? <span>{parsed.value}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

const CARD_TAG_LIMIT = 3;

/** Compute what the card's meta-row shows for the "who published this" slot.
 *  Mirrors dmworkskillmarket's owner rendering:
 *   - bot rows: bot icon + bot 名 · human icon + human 名（两段用中点分隔）
 *   - human rows / legacy rows with only creatorName: human icon + human 名
 *   - `import` rows and rows with no attribution at all: return null so the
 *     meta-row folds — imports don't come from a marketplace user and must
 *     not be labelled with a human/bot chip. */
export function resolveOwner(item: McpListItem): { botName?: string; humanName?: string } | null {
  if (item.createdByType === "bot") {
    const botName = item.createdByBotName || t("mcp.source.bot");
    return {
      botName,
      humanName: item.creatorName || undefined,
    };
  }
  if (item.createdByType === "import") {
    return null;
  }
  if (item.creatorName) {
    return { humanName: item.creatorName };
  }
  return null;
}

/** A single MCP server card in the list grid. */
const McpCard: React.FC<McpCardProps> = ({ item, onClick, onEdit, onDelete, showStats = true, row = false }) => {
  const visibleTags = item.tags.slice(0, CARD_TAG_LIMIT);
  const overflowTags = item.tags.slice(CARD_TAG_LIMIT);
  const isOfficial = isOfficialMcp(item);
  const owner = isOfficial ? null : resolveOwner(item);
  // `.trim()` gates the fallback avatar so a whitespace-only icon string
  // (paste artifact, backend quirk) doesn't slip past the truthiness check
  // and render an empty box via IconGlyph.
  const hasIcon = !!item.icon?.trim();

  if (row) {
    return (
      <div
        className="wk-mcp-mine-row"
        role="button"
        tabIndex={0}
        aria-label={item.name}
        data-track="market_card_opened"
        data-object-id={item.id}
        data-track-item-type="mcp"
        onClick={() => onClick(item)}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLElement && e.target.closest("button")) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(item);
          }
        }}
      >
        <span className="wk-mcp-mine-row__icon">
          {hasIcon ? (
            <IconGlyph icon={item.icon} className="wk-mcp-mine-row__icon-img" alt={item.name} />
          ) : (
            <span
              className="wk-mcp-mine-row__icon-default"
              style={{ background: getMcpAvatarColor(item.id) }}
            >
              {getMcpAvatarText(item.name)}
            </span>
          )}
        </span>
        <div className="wk-mcp-mine-row__body">
          <div className="wk-mcp-mine-row__title" title={item.name}>
            {item.name}
          </div>
          {item.category && <div className="wk-mcp-mine-row__meta">{item.category}</div>}
          {item.slogan && <p className="wk-mcp-mine-row__desc">{item.slogan}</p>}
          {visibleTags.length > 0 && (
            <div className="wk-mcp-card__tags">
              {visibleTags.map((tag) => (
                <span key={tag} className="wk-mcp-tag">
                  {tag}
                </span>
              ))}
              {overflowTags.length > 0 && (
                <span className="wk-mcp-tag wk-mcp-tag--more">+{overflowTags.length}</span>
              )}
            </div>
          )}
          {item.version && (
            <div className="wk-mcp-mine-row__status">
              <span className="wk-mcp-mine-row__version">v{item.version}</span>
            </div>
          )}
        </div>
        <div
          className="wk-mcp-mine-row__actions"
          onClick={(e) => e.stopPropagation()}
          data-track-ignore=""
        >
          {onEdit && (
            <button
              type="button"
              className="wk-mcp-mine-row__action"
              aria-label={t("mcp.card.editAriaLabel", { values: { name: item.name } })}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
            >
              <Pencil size={15} aria-hidden="true" />
              {t("mcp.card.edit")}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="wk-mcp-mine-row__action wk-mcp-mine-row__action--danger"
              aria-label={t("mcp.card.deleteAriaLabel", { values: { name: item.name } })}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              {t("mcp.card.delete")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`wk-mcp-card${isOfficial ? " wk-mcp-card--official" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      data-track="market_card_opened"
      data-object-id={item.id}
      data-track-item-type="mcp"
      onKeyDown={(e) => {
        // Don't hijack Enter/Space when the focused element is one of the
        // inner action buttons (pencil / trash) — those buttons handle the
        // key themselves and we must not also open the detail modal on top.
        // Mirrors dmworkskillmarket's SkillCard.handleKeyDown.
        if (e.target instanceof HTMLElement && e.target.closest("button")) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(item);
        }
      }}
    >
      <button
        type="button"
        className="wk-mcp-card__primary-action"
        aria-label={t("mcp.card.connectAriaLabel", { values: { name: item.name } })}
        onClick={(e) => {
          e.stopPropagation();
          onClick(item);
        }}
      >
        <Plug size={14} aria-hidden="true" />
        {t("mcp.card.connect")}
      </button>
      <div className="wk-mcp-card__top">
        <div className="wk-mcp-card__icon">
          {hasIcon ? (
            <IconGlyph icon={item.icon} className="wk-mcp-card__icon-img" alt={item.name} />
          ) : (
            <span
              className="wk-mcp-card__icon-default"
              style={{ background: getMcpAvatarColor(item.id) }}
            >
              {getMcpAvatarText(item.name)}
            </span>
          )}
        </div>
        <div className="wk-mcp-card__header">
          <div className="wk-mcp-card__title-row">
            <h3 className="wk-mcp-card__name" title={item.name}>
              {item.name}
            </h3>
          </div>
          {isOfficial ? (
            <div className="wk-mcp-card__meta-row">
              <span className="wk-mcp-card__owner wk-mcp-card__owner--official">
                <ShieldCheck className="wk-mcp-card__owner-official-icon" size={13} aria-hidden="true" />
                <span className="wk-mcp-card__owner-name">{t("mcp.card.officialPublisher")}</span>
              </span>
            </div>
          ) : owner ? (
            <div className="wk-mcp-card__meta-row">
              {owner.botName && (
                <span className="wk-mcp-card__owner" title={owner.botName}>
                  <Bot className="wk-mcp-card__owner-bot-icon" size={13} aria-hidden="true" />
                  <span className="wk-mcp-card__owner-name">{owner.botName}</span>
                </span>
              )}
              {owner.botName && owner.humanName && (
                <span className="wk-mcp-card__meta-separator">·</span>
              )}
              {owner.humanName && (
                <span className="wk-mcp-card__owner" title={owner.humanName}>
                  <UserRound className="wk-mcp-card__owner-user-icon" size={13} aria-hidden="true" />
                  <span className="wk-mcp-card__owner-name">{owner.humanName}</span>
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="wk-mcp-card__slogan">{item.slogan}</div>
      <div className="wk-mcp-card__tags">
        {visibleTags.map((tag) => (
          <span key={tag} className="wk-mcp-tag">
            {tag}
          </span>
        ))}
        {overflowTags.length > 0 && (
          <Tooltip
            content={
              <div className="wk-mcp-tag-overflow">
                {overflowTags.map((tag) => (
                  <span key={tag} className="wk-mcp-tag">
                    {tag}
                  </span>
                ))}
              </div>
            }
            className="wk-mcp-tooltip-light"
            mouseEnterDelay={100}
            position="top"
          >
            <span className="wk-mcp-tag wk-mcp-tag--more" aria-label={overflowTags.join(", ")}>
              +{overflowTags.length}
            </span>
          </Tooltip>
        )}
      </div>
      {item.matchReasons?.length ? (
        <MatchReasons reasons={item.matchReasons} hideCreator={isOfficial} />
      ) : null}
      {(showStats || onEdit || onDelete) && (
      <div className="wk-mcp-card__footer">
        {showStats && (
        <div className="wk-mcp-card__stats">
          <span
            className="wk-mcp-card__stat"
            title={t("mcp.card.toolCount", { values: { count: item.toolCount } })}
            aria-label={t("mcp.card.toolCount", { values: { count: item.toolCount } })}
          >
            <IconWrenchStroked size="small" />
            {item.toolCount}
          </span>
        </div>
        )}
        {(onEdit || onDelete) && (
          <div
            className="wk-mcp-card__footer-actions"
            onClick={(e) => e.stopPropagation()}
            // The card root carries data-track="market_card_opened"; the global
            // click delegate runs in capture phase, BEFORE this stopPropagation,
            // so an edit/delete click here would still resolve closest('[data-track]')
            // to the card and emit a false view. data-track-ignore makes the
            // delegate skip any click landing inside this actions subtree.
            data-track-ignore=""
          >
            {onEdit && (
              <button
                type="button"
                className="wk-mcp-card__action-button"
                aria-label={t("mcp.card.editAriaLabel", { values: { name: item.name } })}
                title={t("mcp.card.edit")}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(item);
                }}
              >
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="wk-mcp-card__action-button is-danger"
                aria-label={t("mcp.card.deleteAriaLabel", { values: { name: item.name } })}
                title={t("mcp.card.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item);
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default McpCard;
