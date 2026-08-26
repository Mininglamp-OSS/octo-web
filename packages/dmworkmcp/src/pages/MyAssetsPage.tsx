import React, { useState } from "react";
import { Plug, Sparkles, UserRound, Users } from "lucide-react";
import { useI18n, t } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "./McpMarketListPage";
import ExpertMarketListPage from "./ExpertMarketListPage";
import "../index.css";

/** Which personal-asset type the 我的 page is showing. Experts and squads are
 *  split into their own tabs, matching the marketing prototype. */
type MineType = "skills" | "experts" | "squads" | "mcp";

const TYPE_TABS: Array<{
  key: MineType;
  labelKey: string;
  icon: React.ReactElement;
}> = [
  { key: "skills", labelKey: "mcp.sidebar.skills", icon: <Sparkles size={15} aria-hidden="true" /> },
  { key: "experts", labelKey: "mcp.expert.typeAgent", icon: <UserRound size={15} aria-hidden="true" /> },
  { key: "squads", labelKey: "mcp.expert.typeSquad", icon: <Users size={15} aria-hidden="true" /> },
  { key: "mcp", labelKey: "mcp.sidebar.mcp", icon: <Plug size={15} aria-hidden="true" /> },
];

/**
 * "我的" personal-assets page — the sidebar's fourth entry. Owns the page title
 * and a type sub-tab strip (技能 / 专家 / 连接器); each tab mounts the matching
 * market page in its `variant="mine"` mode, which forces the mine data source,
 * hides that page's own tab strip + hero title, and exposes manage actions.
 * Reuses the existing pages wholesale so personal cards, publish states and
 * edit/delete flows stay in one place per market.
 */
export default function MyAssetsPage() {
  useI18n();
  const [type, setType] = useState<MineType>("skills");
  return (
    <div className="wk-mcp-mine">
      <header className="wk-mcp-mine__hero">
        <div className="wk-mcp-mine__hero-title">
          <h1>{t("mcp.mine.pageTitle")}</h1>
        </div>
      </header>
      <nav className="wk-mcp-mine__tabs" aria-label={t("mcp.mine.navAriaLabel")}>
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={type === tab.key ? "is-active" : ""}
            aria-pressed={type === tab.key}
            onClick={() => setType(tab.key)}
          >
            <span className="wk-mcp-mine__tab-icon">{tab.icon}</span>
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>
      <div className="wk-mcp-mine__panel">
        {type === "skills" && <SkillListPage variant="mine" />}
        {type === "experts" && (
          <ExpertMarketListPage variant="mine" mineType="agent" />
        )}
        {type === "squads" && (
          <ExpertMarketListPage variant="mine" mineType="squad" />
        )}
        {type === "mcp" && <McpMarketListPage variant="mine" />}
      </div>
    </div>
  );
}
