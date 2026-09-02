import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { t, useI18n } from "@octo/base";
import {
  MineTable,
  getMySkills,
  type MineAssetType,
  type MineRow,
  type Skill,
} from "@dmwork/skillmarket";
import { getMcpAvatarColor, getMcpAvatarText } from "../utils/mcpAvatar";

const PAGE_SIZE = 50;

/** Wire plugin type -> MineTable's local row type. */
const ROW_TYPE: Record<string, MineAssetType> = {
  skill: "skill",
  connector: "connector",
  expert: "expert",
  expert_team: "squad",
};

/**
 * The 全部 tab of 我的发布: every plugin the caller owns, of every type, in one
 * table.
 *
 * It exists because the per-type tabs answer "what skills do I have" but nobody
 * could answer "what have I got waiting on review" without visiting four tabs.
 * The backend made this expressible by allowing `plugin_type` to be omitted on
 * the `mode=mine` listing.
 *
 * Deliberately READ-ONLY apart from opening a row. 编辑 and 升级版本 need the
 * owning market's modal (a connector edits through McpCreateModal, an expert
 * through the bot flow), and reproducing that dispatch here would mean this tab
 * silently drifting from the four that own those flows. Clicking a row takes you
 * to the tab that can act on it. The status column is the point of this view;
 * the actions live one click away.
 */
export default function AllAssetsList({ onOpenType }: { onOpenType: (type: string) => void }) {
  useI18n();
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against an out-of-order response overwriting a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getMySkills({ limit: PAGE_SIZE }, { pluginType: "all" });
      if (version !== requestRef.current) return;
      setItems(page.items);
    } catch (err) {
      if (version !== requestRef.current) return;
      setError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
    } finally {
      if (version === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <div className="skill-market-review-list--loading">
        <RefreshCw size={16} className="skill-market-spin" />
        {t("skillMarket.common.loading")}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="skill-market-state is-error">
        <AlertCircle size={28} />
        <strong>{t("skillMarket.common.loadFailed")}</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="skill-market-state">
        <PackageOpen size={48} />
        <strong>{t("mcp.mine.emptyAll")}</strong>
      </div>
    );
  }

  const rows: MineRow[] = items.map((item) => {
    const wireType = (item as Skill & { pluginType?: string }).pluginType ?? "skill";
    return {
      id: item.id,
      type: ROW_TYPE[wireType] ?? "skill",
      trackItemType: wireType,
      icon: item.iconUrl ? (
        <img className="wk-mine-table__avatar-img" src={item.iconUrl} alt="" />
      ) : (
        <span
          className="wk-mine-table__avatar-tile"
          style={{ background: getMcpAvatarColor(item.id) }}
        >
          {getMcpAvatarText(item.displayName || item.name)}
        </span>
      ),
      name: item.displayName || item.name,
      description: item.description,
      version: item.version,
      visibility: item.visibility,
      views: item.viewCount,
      downloads: item.downloadCount,
      status: item.displayStatus,
      ariaLabel: item.name,
      // Hands off to the tab that owns this type's edit/publish flows.
      onOpen: () => onOpenType(wireType),
    };
  });

  return <MineTable rows={rows} ariaLabel={t("mcp.mine.allAriaLabel")} />;
}
