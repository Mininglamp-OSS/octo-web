import React from "react";
import { Bot, Download, Eye, Pencil, ShieldCheck, Trash2, UserRound, Users } from "lucide-react";
import { t } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";
import { getMcpAvatarColor } from "../utils/mcpAvatar";
import { resolveExpertOwner } from "../utils/expertOwner";
import { isOfficialExpert } from "../utils/publisher";
import { formatCount } from "../utils/format";

interface ExpertCardProps {
  item: ExpertItem;
  onOpen: (item: ExpertItem) => void;
  /** When provided, renders the edit action in the card footer (我的 tab). */
  onEdit?: (item: ExpertItem) => void;
  /** When provided, renders the delete action in the card footer (我的 tab). */
  onDelete?: (item: ExpertItem) => void;
  /** When provided, renders the 添加到回路 action that opens the workspace/runtime
   *  picker and provisions directly — an agent for an expert, or the member
   *  agents + team for a squad. */
  onAddToLoop?: (item: ExpertItem) => void;
}

const MAX_TAGS = 3;

/**
 * Catalog card for an expert / expert squad. Deliberately reuses the MCP
 * card's class names (.wk-mcp-card*) so it inherits the exact same layout and
 * accent color scheme — icon + title, a bot/human owner row, summary, accent
 * tag pills, and a footer stat. The whole card is one click target (no inline
 * action button competing for the click); copying lives in the detail modal.
 */
export default function ExpertCard({ item, onOpen, onEdit, onDelete, onAddToLoop }: ExpertCardProps) {
  const isSquad = item.kind === "squad";
  const isOfficial = isOfficialExpert(item);
  const owner = resolveExpertOwner(item);
  const visibleTags = item.tags.slice(0, MAX_TAGS);
  const overflowTags = item.tags.slice(MAX_TAGS);
  // 添加到回路 is offered for both experts and squads.
  const showAddToLoop = Boolean(onAddToLoop);
  const hasActions = Boolean(onEdit || onDelete || showAddToLoop);
  const rawViewCount = item.viewCount ?? 0;
  const rawInstallCount = item.installCount ?? 0;

  return (
    <div
      className={`wk-mcp-card${isOfficial ? " wk-mcp-card--official" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      // Open on pointerdown, not click: when the market pane has just lost
      // focus (e.g. right after closing the detail modal), the browser spends
      // the first click restoring focus and cancels that `click` event — the
      // card looked dead until a second click. pointerdown fires at press time,
      // before any focus-driven click cancellation, so the first tap opens.
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Don't open the detail modal when pressing the footer action buttons
        // (pencil / trash) — they run their own handlers.
        if (event.target instanceof HTMLElement && event.target.closest("button")) {
          return;
        }
        onOpen(item);
      }}
      onKeyDown={(event) => {
        // Mirror the pointerdown guard: a keyboard activation on a footer
        // button (install / edit / delete) must run only that button's
        // handler, not also open the detail modal via bubbling.
        if (event.target instanceof HTMLElement && event.target.closest("button")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="wk-mcp-card__top">
        <div className="wk-mcp-card__icon">
          <span
            className="wk-mcp-card__icon-default"
            style={{ background: getMcpAvatarColor(item.id) }}
          >
            {item.shortName}
          </span>
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
          ) : (
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
          )}
        </div>
      </div>

      <div className="wk-mcp-card__slogan">{item.summary}</div>

      <div className="wk-mcp-card__tags">
        {visibleTags.map((tag) => (
          <span key={tag} className="wk-mcp-tag wk-mcp-tag--accent">
            {tag}
          </span>
        ))}
        {overflowTags.length > 0 && (
          <span
            className="wk-mcp-tag wk-mcp-tag--more"
            title={overflowTags.join("、")}
            aria-label={overflowTags.join(", ")}
          >
            +{overflowTags.length}
          </span>
        )}
      </div>

      <div className="wk-mcp-card__footer">
        <div className="wk-mcp-card__stats">
          {isSquad && (
            <span
              className="wk-mcp-card__stat"
              title={t("mcp.expert.memberCount", { values: { count: item.memberCount ?? item.members.length } })}
            >
              <Users size={14} aria-hidden="true" />
              {item.memberCount ?? item.members.length}
            </span>
          )}
          <span
            className="wk-mcp-card__stat"
            title={t("mcp.expert.viewCountTitle", { values: { count: rawViewCount } })}
            aria-label={t("mcp.expert.viewCountTitle", { values: { count: rawViewCount } })}
          >
            <Eye size={14} aria-hidden="true" />
            {formatCount(rawViewCount)}
          </span>
          <span
            className="wk-mcp-card__stat"
            title={t("mcp.expert.installCountTitle", { values: { count: rawInstallCount } })}
            aria-label={t("mcp.expert.installCountTitle", { values: { count: rawInstallCount } })}
          >
            <Download size={14} aria-hidden="true" />
            {formatCount(rawInstallCount)}
          </span>
        </div>
        {hasActions && (
          <div
            className="wk-mcp-card__footer-actions"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {showAddToLoop && (
              <button
                type="button"
                className="wk-mcp-expert-card__add-loop"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddToLoop?.(item);
                }}
              >
                {t("mcp.expert.addToLoop")}
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                className="wk-mcp-card__action-button"
                aria-label={t("mcp.expert.editAriaLabel", { values: { name: item.name } })}
                title={t("mcp.expert.edit")}
                onClick={(event) => {
                  event.stopPropagation();
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
                aria-label={t("mcp.expert.deleteAriaLabel", { values: { name: item.name } })}
                title={t("mcp.expert.delete")}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item);
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
