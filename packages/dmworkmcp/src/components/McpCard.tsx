import React from "react";
import { Tooltip } from "@douyinfe/semi-ui";
import type { McpListItem } from "../types/mcp";
import { t } from "@octo/base";
import { IconGlyph } from "../utils/icon";

interface McpCardProps {
  item: McpListItem;
  onClick: (item: McpListItem) => void;
  keyword?: string;
}

export function Highlight({ text, keyword = "" }: { text: string; keyword?: string }) {
  const index = text.toLowerCase().indexOf(keyword.trim().toLowerCase());
  if (!keyword.trim() || index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + keyword.trim().length)}</mark>{text.slice(index + keyword.trim().length)}</>;
}

export function parseMatchReason(reason: string): { key: string; value?: string } {
  const colon = reason.indexOf(":");
  const type = colon < 0 ? reason : reason.slice(0, colon);
  const value = colon < 0 ? undefined : reason.slice(colon + 1);
  const keys: Record<string, string> = { name: "name", description: "description", category: "category", usage_example: "usage", tool: "tool", tag: "tag", creator: "creator" };
  return { key: `mcp.card.matchReason.${keys[type] ?? "other"}`, value };
}

export function MatchReasons({ reasons, keyword = "" }: { reasons: string[]; keyword?: string }) {
  const revealing = reasons.filter((reason) => {
    const type = reason.split(":", 1)[0];
    return type === "tool" || type === "usage_example" || type === "creator";
  });
  if (!revealing.length) return null;
  return (
    <div className="wk-mcp-card__reasons">
      {revealing.map((reason) => {
        const parsed = parseMatchReason(reason);
        const value = parsed.value || keyword;
        return (
          <span className="wk-mcp-card__reason" key={reason}>
            <span className="wk-mcp-card__reason-label">{t(parsed.key)}</span>
            {value ? <Highlight text={value} keyword={keyword} /> : null}
          </span>
        );
      })}
    </div>
  );
}

/** How many tags the card renders before collapsing the rest into a `+N`
 *  chip. Product decision: 3 keeps the tag row on a single line for typical
 *  cases while still surfacing the most-relevant tags on a real record. */
const CARD_TAG_LIMIT = 3;

/** A single MCP server card in the list grid. */
const McpCard: React.FC<McpCardProps> = ({ item, onClick, keyword }) => {
  const visibleTags = item.tags.slice(0, CARD_TAG_LIMIT);
  const overflowTags = item.tags.slice(CARD_TAG_LIMIT);
  return (
    <div
      className="wk-mcp-card"
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(item);
        }
      }}
    >
      <div className="wk-mcp-card__header">
        <div className="wk-mcp-card__icon">
          <IconGlyph icon={item.icon} className="wk-mcp-card__icon-img" alt={item.name} />
        </div>
        <div className="wk-mcp-card__heading">
          <div className="wk-mcp-card__name">
            {/* Wrap the highlighted text in its own span so the ellipsis
                clamp only applies to the name — not the source chip that
                sits alongside it. `title` on the wrapper is the plain
                browser tooltip (fine here: users deliberately hover for
                a long name, and clicking still opens the detail modal
                with the full name in the header). */}
            <span className="wk-mcp-card__name-text" title={item.name}>
              <Highlight text={item.name} keyword={keyword} />
            </span>
            {/* Cards get an icon-only chip — real estate is tight and the
                name of the bot rarely helps disambiguation in a grid. Hover
                exposes the full "由 X 的 Bot 创建" tooltip. */}
            <SourceBadge item={item} variant="icon-only" />
          </div>
          <div className="wk-mcp-card__tags">
            {visibleTags.map((tag) => (
              <span key={tag} className="wk-mcp-tag wk-mcp-tag--accent">
                <Highlight text={tag} keyword={keyword} />
              </span>
            ))}
            {overflowTags.length > 0 && (
              /* +N chip: hover reveals the truncated tags via Semi Tooltip
                 as a mini pill cloud — matches the visual language of the
                 card's own tags so it reads as "the rest of the tag row".
                 100 ms delay so the reveal feels near-instant. Click still
                 bubbles up to the card's onClick — no separate detail path
                 for the +N. */
              <Tooltip
                content={
                  <div className="wk-mcp-tag-overflow">
                    {overflowTags.map((tag) => (
                      <span key={tag} className="wk-mcp-tag wk-mcp-tag--accent">
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
        </div>
      </div>
      <div className="wk-mcp-card__slogan"><Highlight text={item.slogan} keyword={keyword} /></div>
      {item.matchReasons?.length ? <MatchReasons reasons={item.matchReasons} keyword={keyword} /> : null}
      <div className="wk-mcp-card__footer">
        <span>
          {t("mcp.card.toolCount", { values: { count: item.toolCount } })}
        </span>
      </div>
    </div>
  );
};

/**
 * Small "created by whom" chip for bot-authored MCPs (issue #894). Two shapes:
 *   - `icon-only` (card grid): just the 🤖 glyph; hover for the full tooltip
 *     naming the bot and its owner. Keeps the list compact.
 *   - `labeled` (detail modal): 🤖 + bot name, so the source is legible
 *     without a hover — the detail page has the room.
 * Human/import/legacy rows never render a chip either way.
 */
export function SourceBadge({
  item,
  variant = "labeled",
}: {
  item: McpListItem;
  variant?: "icon-only" | "labeled";
}) {
  if (item.createdByType !== "bot") return null;
  const botName = item.createdByBotName || t("mcp.source.bot");
  const ownerHint = item.creatorName
    ? t("mcp.source.botTooltip", { values: { owner: item.creatorName } })
    : "";
  // Same tooltip shape for both variants — the labeled chip clips long bot
  // names with an ellipsis, so hover MUST reveal the full name (plus owner)
  // no matter which variant the caller picks.
  const tooltip = ownerHint ? `${botName} · ${ownerHint}` : botName;
  const chip = (
    <span
      className={
        variant === "icon-only"
          ? "wk-mcp-tag wk-mcp-source wk-mcp-source--bot wk-mcp-source--icon"
          : "wk-mcp-tag wk-mcp-source wk-mcp-source--bot"
      }
      aria-label={tooltip}
    >
      <span className="wk-mcp-source__icon" aria-hidden="true">🤖</span>
      {variant === "labeled" && (
        <span className="wk-mcp-source__label">{botName}</span>
      )}
    </span>
  );
  // Semi UI Tooltip — near-instant reveal (100 ms) instead of the browser's
  // sluggish 500-2000ms native title. Stopping propagation on the trigger
  // wrapper is unnecessary: the tooltip layer sits above but the click
  // bubble path still reaches the card, so clicking the chip still opens
  // the detail like any other card area.
  return (
    <Tooltip content={tooltip} mouseEnterDelay={100} position="top">
      {chip}
    </Tooltip>
  );
}

export default McpCard;
