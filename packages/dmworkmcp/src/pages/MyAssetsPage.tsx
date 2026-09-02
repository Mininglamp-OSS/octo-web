import React, { useState } from "react";
import { LayoutGrid, Plug, Sparkles, UserRound, Users } from "lucide-react";
import { useI18n, t } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "./McpMarketListPage";
import ExpertMarketListPage from "./ExpertMarketListPage";
import AllAssetsList from "./AllAssetsList";
import "../index.css";

/** Which personal-asset type the 我的 page is showing. Experts and squads are
 *  split into their own tabs, matching the marketing prototype. */
type MineType = "all" | "skills" | "experts" | "squads" | "mcp";

/** Initial tab, deep-linkable via `?type=` on the /mcp-market/mine URL so a
 *  direct link (or an e2e spec) can land on a specific market's mine view
 *  without first mounting — and fetching — the default 技能 tab. */
function initialType(): MineType {
  try {
    const value = new URLSearchParams(window.location.search).get("type");
    if (
      value === "all" ||
      value === "mcp" ||
      value === "experts" ||
      value === "squads" ||
      value === "skills"
    ) {
      return value;
    }
  } catch {
    // ignore — fall through to the default
  }
  return "all";
}

const TYPE_TABS: Array<{
  key: MineType;
  labelKey: string;
  icon: React.ReactElement;
}> = [
  // 全部 leads: it is the only view that answers "what have I got waiting on
  // review" without visiting four tabs.
  { key: "all", labelKey: "mcp.mine.tabAll", icon: <LayoutGrid size={15} aria-hidden="true" /> },
  { key: "skills", labelKey: "skillMarket.plugin.typeSkill", icon: <Sparkles size={15} aria-hidden="true" /> },
  { key: "mcp", labelKey: "skillMarket.plugin.typeConnector", icon: <Plug size={15} aria-hidden="true" /> },
  { key: "experts", labelKey: "skillMarket.plugin.typeExpert", icon: <UserRound size={15} aria-hidden="true" /> },
  { key: "squads", labelKey: "skillMarket.plugin.typeExpertTeam", icon: <Users size={15} aria-hidden="true" /> },
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
  const [type, setType] = useState<MineType>(initialType);
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
        {type === "all" && (
          <AllAssetsList
            onOpenType={(wireType) =>
              setType(
                wireType === "connector"
                  ? "mcp"
                  : wireType === "expert"
                    ? "experts"
                    : wireType === "expert_team"
                      ? "squads"
                      : "skills"
              )
            }
          />
        )}
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
