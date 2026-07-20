import React from "react";
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

/** A single MCP server card in the list grid. */
const McpCard: React.FC<McpCardProps> = ({ item, onClick, keyword }) => {
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
          <div className="wk-mcp-card__name"><Highlight text={item.name} keyword={keyword} /></div>
          <div className="wk-mcp-card__tags">
            {item.tags.map((tag) => (
              <span key={tag} className="wk-mcp-tag wk-mcp-tag--accent">
                <Highlight text={tag} keyword={keyword} />
              </span>
            ))}
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

export default McpCard;
