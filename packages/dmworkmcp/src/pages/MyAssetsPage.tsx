import React, { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, Plug, Sparkles, UserRound, Users } from "lucide-react";
import { useI18n, t, WKApp } from "@octo/base";
import {
  SearchBar,
  SkillListPage,
  type MineActionRequest,
  type MineAssetType,
} from "@dmwork/skillmarket";
import McpMarketListPage from "./McpMarketListPage";
import ExpertMarketListPage from "./ExpertMarketListPage";
import AllAssetsList from "./AllAssetsList";
import MineActionHost from "../features/mine/MineActionHost";
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

function tabForAssetType(type: MineAssetType | string): MineType {
  if (type === "connector") return "mcp";
  if (type === "expert") return "experts";
  if (type === "squad" || type === "expert_team") return "squads";
  return "skills";
}

const TYPE_TABS: Array<{
  key: MineType;
  labelKey: string;
  icon: React.ReactElement;
}> = [
  // 全部 leads: it is the only view that answers "what have I got waiting on
  // review" without visiting four tabs.
  {
    key: "all",
    labelKey: "mcp.mine.tabAll",
    icon: <LayoutGrid size={15} aria-hidden="true" />,
  },
  {
    key: "skills",
    labelKey: "skillMarket.plugin.typeSkill",
    icon: <Sparkles size={15} aria-hidden="true" />,
  },
  {
    key: "mcp",
    labelKey: "skillMarket.plugin.typeConnector",
    icon: <Plug size={15} aria-hidden="true" />,
  },
  {
    key: "experts",
    labelKey: "skillMarket.plugin.typeExpert",
    icon: <UserRound size={15} aria-hidden="true" />,
  },
  {
    key: "squads",
    labelKey: "skillMarket.plugin.typeExpertTeam",
    icon: <Users size={15} aria-hidden="true" />,
  },
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
  const [allQuery, setAllQuery] = useState("");
  const [allRefreshKey, setAllRefreshKey] = useState(0);
  const [mineActionRequest, setMineActionRequest] =
    useState<MineActionRequest | null>(null);
  const requestIdRef = useRef(0);
  const handleActionRequest = useCallback(
    (request: Omit<MineActionRequest, "requestId">) => {
      setMineActionRequest({ ...request, requestId: ++requestIdRef.current });
    },
    []
  );
  const handleDirectEditClose = useCallback(() => {
    setMineActionRequest(null);
  }, []);
  const handleDirectEditChanged = useCallback(() => {
    setAllRefreshKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const handleSpaceChanged = () => setMineActionRequest(null);
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, []);

  return (
    <div className="wk-mcp-mine">
      <header className="wk-mcp-mine__hero">
        <div className="wk-mcp-mine__hero-title">
          <h1>{t("mcp.mine.pageTitle")}</h1>
        </div>
        {type === "all" && (
          <div className="wk-mcp-mine__hero-actions">
            <SearchBar
              value={allQuery}
              onChange={setAllQuery}
              placeholder={t("mcp.mine.searchPlaceholder")}
            />
          </div>
        )}
      </header>
      <nav
        className="wk-mcp-mine__tabs"
        aria-label={t("mcp.mine.navAriaLabel")}
      >
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={type === tab.key ? "is-active" : ""}
            aria-pressed={type === tab.key}
            onClick={() => {
              setMineActionRequest(null);
              setType(tab.key);
            }}
          >
            <span className="wk-mcp-mine__tab-icon">{tab.icon}</span>
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>
      <div className="wk-mcp-mine__panel">
        {type === "all" && (
          <AllAssetsList
            query={allQuery}
            refreshKey={allRefreshKey}
            onOpenType={(wireType) => {
              setMineActionRequest(null);
              setType(tabForAssetType(wireType));
            }}
            onRequestAction={handleActionRequest}
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
        <MineActionHost
          request={type === "all" ? mineActionRequest : null}
          onClose={handleDirectEditClose}
          onChanged={handleDirectEditChanged}
        />
      </div>
    </div>
  );
}
