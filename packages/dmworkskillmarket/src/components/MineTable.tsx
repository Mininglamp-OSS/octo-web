import React from "react";
import {
  Building2,
  Globe,
  Lock,
  Pencil,
  Plug,
  Sparkles,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { t } from "@octo/base";
import { formatCount, formatFullDate } from "../utils/format";

/** The four personal-asset kinds shown in "我的发布". The type marker in the
 *  bottom-right of each row's avatar disambiguates them (the tabs are per-type
 *  today, but the marker keeps the row self-describing and matches the design). */
export type MineAssetType = "skill" | "connector" | "expert" | "squad";

/** One normalized "我的发布" row. Each market page maps its own list item
 *  (Skill / McpListItem / ExpertItem) onto this shape and builds the avatar node
 *  itself (skill/connector use an image or color tile, experts a short-name
 *  tile), so MineTable stays market-agnostic. */
export interface MineRow {
  id: string;
  type: MineAssetType;
  /** Avatar node (image or color tile) rendered on the left; MineTable overlays
   *  the type marker on top of it. */
  icon: React.ReactNode;
  name: string;
  description?: string;
  category?: string;
  version?: string;
  /** Raw, already-normalized visibility key: system / space / private / public. */
  visibility?: string;
  views?: number;
  downloads?: number;
  updatedAt?: string;
  ariaLabel?: string;
  /** Value for data-track-item-type on the row (skill / mcp / expert …). */
  trackItemType?: string;
  onOpen?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Accessible labels for the edit/delete buttons; each page passes its own
   *  namespaced "编辑 {name}" / "删除 {name}" so the button name carries the item. */
  editAria?: string;
  deleteAria?: string;
}

interface MineTableProps {
  rows: MineRow[];
  /** Maps a raw visibility key -> its localized label. Passed per package so the
   *  连接器/专家 tabs (mcp namespace) and 技能 tab (skillMarket namespace) keep
   *  their own wording (全平台 / 本组织 / 仅自己). */
  visibilityLabel: (key: string) => string;
}

const TYPE_MARKERS: Record<MineAssetType, React.ReactElement> = {
  skill: <Sparkles size={11} aria-hidden="true" />,
  connector: <Plug size={11} aria-hidden="true" />,
  expert: <UserRound size={11} aria-hidden="true" />,
  squad: <Users size={11} aria-hidden="true" />,
};

/** system/public -> 全平台 globe, private -> lock, space -> org building. */
function visibilityMeta(key: string): { cls: string; icon: React.ReactElement } {
  const v = key === "public" ? "system" : key;
  if (v === "system") return { cls: "system", icon: <Globe size={13} aria-hidden="true" /> };
  if (v === "private") return { cls: "private", icon: <Lock size={13} aria-hidden="true" /> };
  return { cls: "space", icon: <Building2 size={13} aria-hidden="true" /> };
}

function safeDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return formatFullDate(iso);
  } catch {
    return iso.slice(0, 10) || "—";
  }
}

export default function MineTable({ rows, visibilityLabel }: MineTableProps) {
  return (
    <div className="wk-mine-table" role="table" aria-label={t("skillMarket.mineTable.ariaLabel")}>
      <div className="wk-mine-table__head" role="row">
        <span className="wk-mine-table__col wk-mine-table__col--name" role="columnheader">
          {t("skillMarket.mineTable.name")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--category" role="columnheader">
          {t("skillMarket.mineTable.category")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--version" role="columnheader">
          {t("skillMarket.mineTable.version")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--visibility" role="columnheader">
          {t("skillMarket.mineTable.visibility")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--num" role="columnheader">
          {t("skillMarket.mineTable.views")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--num" role="columnheader">
          {t("skillMarket.mineTable.downloads")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--updated" role="columnheader">
          {t("skillMarket.mineTable.updatedAt")}
        </span>
        <span className="wk-mine-table__col wk-mine-table__col--actions" role="columnheader">
          {t("skillMarket.mineTable.actions")}
        </span>
      </div>
      {rows.map((r) => {
        const vis = r.visibility ? visibilityMeta(r.visibility) : null;
        return (
          <div
            key={r.id}
            className="wk-mine-table__row"
            role="row"
            tabIndex={0}
            aria-label={r.ariaLabel ?? r.name}
            data-track="market_card_opened"
            data-object-id={r.id}
            data-track-item-type={r.trackItemType}
            onClick={() => r.onOpen?.()}
            onKeyDown={(e) => {
              if (e.target instanceof HTMLElement && e.target.closest("button")) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                r.onOpen?.();
              }
            }}
          >
            <span className="wk-mine-table__col wk-mine-table__col--name" role="cell">
              <span className="wk-mine-table__avatar">
                {r.icon}
                <span
                  className={`wk-mine-table__type wk-mine-table__type--${r.type}`}
                  aria-hidden="true"
                >
                  {TYPE_MARKERS[r.type]}
                </span>
              </span>
              <span className="wk-mine-table__namecol">
                <span className="wk-mine-table__name" title={r.name}>
                  {r.name}
                </span>
                {r.description && (
                  <span className="wk-mine-table__desc" title={r.description}>
                    {r.description}
                  </span>
                )}
              </span>
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--category" role="cell">
              {r.category || "—"}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--version" role="cell">
              {r.version ? <span className="wk-mine-table__version">v{r.version}</span> : "—"}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--visibility" role="cell">
              {vis ? (
                <span className={`wk-mine-table__vis wk-mine-table__vis--${vis.cls}`}>
                  {vis.icon}
                  {visibilityLabel(r.visibility as string)}
                </span>
              ) : (
                "—"
              )}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--num" role="cell">
              {formatCount(r.views ?? 0)}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--num" role="cell">
              {formatCount(r.downloads ?? 0)}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--updated" role="cell">
              {safeDate(r.updatedAt)}
            </span>
            <span
              className="wk-mine-table__col wk-mine-table__col--actions"
              role="cell"
              data-track-ignore=""
              onClick={(e) => e.stopPropagation()}
            >
              {r.onEdit && (
                <button
                  type="button"
                  className="wk-mine-table__action"
                  aria-label={r.editAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onEdit!();
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                  {t("skillMarket.common.edit")}
                </button>
              )}
              {r.onDelete && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--danger"
                  aria-label={r.deleteAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onDelete!();
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t("skillMarket.common.delete")}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
