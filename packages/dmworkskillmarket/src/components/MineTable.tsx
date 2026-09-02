import React from "react";
import {
  ArrowDownFromLine,
  Building2,
  Check,
  Clock,
  Globe,
  Lock,
  Pencil,
  Plug,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { t } from "@octo/base";
import type { PluginDisplayStatus } from "../types/skill";
import {
  displayStatusLabel,
  displayStatusTone,
  pluginTypeLabel,
  visibilityLabel,
} from "../utils/labels";
import { formatCount } from "../utils/format";

/** The four personal-asset kinds. `squad` is this table's local name for the
 *  `expert_team` wire type. */
export type MineAssetType = "skill" | "connector" | "expert" | "squad";

const WIRE_TYPE: Record<MineAssetType, string> = {
  skill: "skill",
  connector: "connector",
  expert: "expert",
  squad: "expert_team",
};

/**
 * One normalized row. Each page maps its own list item (Skill / McpListItem /
 * ExpertItem / ReviewRequest) onto this shape and builds the avatar node itself,
 * so MineTable stays market-agnostic.
 *
 * The same component now backs BOTH 我的发布 and 组织审核. The two pages differ
 * only in which action callbacks they supply and whether they pass `meta`.
 * Rendering them through one component is what keeps the layouts identical —
 * they were previously a CSS grid and a headerless flex card list sharing no
 * markup or CSS, which is exactly the inconsistency this replaces.
 */
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
  /** For an upgrade under review: the version being replaced, rendered as
   *  `v1.0.0 → v2.0.0` so a reviewer sees both without opening the drawer. */
  versionFrom?: string;
  /** Raw wire visibility: system / space / private / public. */
  visibility?: string;
  views?: number;
  downloads?: number;
  /** Server-computed `display_status`. The client never derives this. A
   *  published plugin with a pending upgrade reads 审核中, and getting that
   *  precedence right independently in three pages is what went wrong before. */
  status?: PluginDisplayStatus;
  /** Overrides the status cell with text this table cannot derive.
   *
   *  组织审核 needs it: its rows are review RECORDS, so the cell says what was
   *  decided (已通过 / 已撤回) — outcomes that are not plugin states and are
   *  deliberately absent from PluginDisplayStatus. Without the override the two
   *  vocabularies would have to be merged into one enum, which is exactly the
   *  conflation that made a settled decision appear to change months later. */
  statusLabel?: string;
  /** Tone for `statusLabel`, matching displayStatusTone's vocabulary. */
  statusTone?: string;
  /** Rejection reason, surfaced under the name and as the status tooltip. */
  rejectReason?: string;
  /** Secondary line under the name — 组织审核 puts 申请人 · 提交时间 here. */
  meta?: React.ReactNode;
  ariaLabel?: string;
  /** Value for data-track-item-type on the row (skill / mcp / expert …). */
  trackItemType?: string;
  onOpen?: () => void;

  /** ── Actions. Each button renders only when its callback is supplied, so the
   *  PAGE owns the gating and this table never inspects status or role to decide
   *  what somebody is allowed to do. That split is deliberate: the authorization
   *  rules live server-side, the page mirrors them for affordance, and the table
   *  is only a renderer. */
  onEdit?: () => void;
  onDelete?: () => void;
  /** Unlisted rows only. One button whose MEANING the backend decides from the
   *  plugin's declared visibility — list it now, or open an organization review.
   *  It is on the row (not only inside the edit modal) because connectors and
   *  experts are authored through wizards and a bot flow, so "open the editor
   *  just to press 发布" would be the only way to publish three of the four
   *  types. */
  onPublish?: () => void;
  onUpgrade?: () => void;
  onCancelReview?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onDelist?: () => void;
  editAria?: string;
  deleteAria?: string;
  publishAria?: string;
  upgradeAria?: string;
  cancelReviewAria?: string;
  approveAria?: string;
  rejectAria?: string;
  delistAria?: string;
  /** Disables every action on the row while one is in flight. */
  busy?: boolean;
}

interface MineTableProps {
  rows: MineRow[];
  /** Overrides the table's accessible name; 组织审核 passes its own. */
  ariaLabel?: string;
}

const TYPE_MARKERS: Record<MineAssetType, React.ReactElement> = {
  skill: <Sparkles size={11} aria-hidden="true" />,
  connector: <Plug size={11} aria-hidden="true" />,
  expert: <UserRound size={11} aria-hidden="true" />,
  squad: <Users size={11} aria-hidden="true" />,
};

/** system/public -> 全平台 globe, private -> lock, space -> org building. */
function visibilityIcon(key: string): { cls: string; icon: React.ReactElement } {
  const v = key === "public" ? "system" : key;
  if (v === "system") return { cls: "system", icon: <Globe size={13} aria-hidden="true" /> };
  if (v === "private") return { cls: "private", icon: <Lock size={13} aria-hidden="true" /> };
  return { cls: "space", icon: <Building2 size={13} aria-hidden="true" /> };
}

const COLUMNS: Array<{ key: string; labelKey: string }> = [
  { key: "name", labelKey: "skillMarket.plugin.columnName" },
  { key: "desc", labelKey: "skillMarket.plugin.columnDescription" },
  { key: "category", labelKey: "skillMarket.plugin.columnCategory" },
  { key: "version", labelKey: "skillMarket.plugin.columnVersion" },
  { key: "visibility", labelKey: "skillMarket.plugin.columnVisibility" },
  { key: "num", labelKey: "skillMarket.plugin.columnViews" },
  { key: "num", labelKey: "skillMarket.plugin.columnDownloads" },
  { key: "status", labelKey: "skillMarket.plugin.columnStatus" },
  { key: "actions", labelKey: "skillMarket.plugin.columnActions" },
];

export default function MineTable({ rows, ariaLabel }: MineTableProps) {
  return (
    <div
      className="wk-mine-table"
      role="table"
      aria-label={ariaLabel ?? t("skillMarket.mineTable.ariaLabel")}
    >
      <div className="wk-mine-table__head" role="row">
        {COLUMNS.map((col, i) => (
          <span
            key={`${col.key}-${i}`}
            className={`wk-mine-table__col wk-mine-table__col--${col.key}`}
            role="columnheader"
          >
            {t(col.labelKey)}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const vis = r.visibility ? visibilityIcon(r.visibility) : null;
        const rejected = r.status === "rejected" || r.statusTone === "rejected";
        return (
          <div
            key={r.id}
            className="wk-mine-table__row"
            role="row"
            aria-label={r.ariaLabel ?? r.name}
          >
            <span className="wk-mine-table__col wk-mine-table__col--name" role="cell">
              {/* The row is structural (role="row"); the primary "open" action is
                  a real, keyboard-focusable button so screen readers announce it
                  and Enter/Space activate it natively. Tracking rides the button
                  so it only fires on an actual open, not on any row click. */}
              <button
                type="button"
                className="wk-mine-table__open"
                aria-label={r.ariaLabel ?? r.name}
                data-track="market_card_opened"
                data-object-id={r.id}
                data-track-item-type={r.trackItemType}
                onClick={() => r.onOpen?.()}
              >
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
                  <span className="wk-mine-table__namerow" title={r.name}>
                    <span className="wk-mine-table__name">{r.name}</span>
                    {/* The type is spelled out, not only shown as the avatar
                        marker: the 全部 tab mixes all four kinds in one table and
                        an 11px glyph is not a label. */}
                    <span className="wk-mine-table__typetag">
                      {pluginTypeLabel(WIRE_TYPE[r.type])}
                    </span>
                  </span>
                  {r.meta && <span className="wk-mine-table__meta">{r.meta}</span>}
                  {rejected && r.rejectReason && (
                    <span className="wk-mine-table__review-reason" title={r.rejectReason}>
                      {t("skillMarket.review.reasonInline", {
                        values: { reason: r.rejectReason },
                      })}
                    </span>
                  )}
                </span>
              </button>
            </span>
            <span
              className="wk-mine-table__col wk-mine-table__col--desc"
              role="cell"
              title={r.description}
            >
              {r.description || "—"}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--category" role="cell">
              {r.category || "—"}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--version" role="cell">
              {r.version ? (
                <span className="wk-mine-table__version">
                  {r.versionFrom ? `v${r.versionFrom} → v${r.version}` : `v${r.version}`}
                </span>
              ) : (
                "—"
              )}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--visibility" role="cell">
              {vis && r.visibility ? (
                <span className={`wk-mine-table__vis wk-mine-table__vis--${vis.cls}`}>
                  {vis.icon}
                  {visibilityLabel(r.visibility)}
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
            <span className="wk-mine-table__col wk-mine-table__col--status" role="cell">
              {r.statusLabel || r.status ? (
                <span
                  className={`wk-plugin-status wk-plugin-status--${
                    r.statusTone ?? (r.status ? displayStatusTone(r.status) : "draft")
                  }`}
                  title={rejected ? r.rejectReason : undefined}
                >
                  {(r.statusTone ?? (r.status ? displayStatusTone(r.status) : "")) === "pending" ? (
                    <Clock size={11} aria-hidden="true" />
                  ) : rejected ? (
                    <XCircle size={11} aria-hidden="true" />
                  ) : null}
                  {r.statusLabel ?? (r.status ? displayStatusLabel(r.status) : "")}
                </span>
              ) : (
                "—"
              )}
            </span>
            <span
              className="wk-mine-table__col wk-mine-table__col--actions"
              role="cell"
              data-track-ignore=""
              onClick={(e) => e.stopPropagation()}
            >
              <RowAction
                show={!!r.onApprove}
                busy={r.busy}
                primary
                aria={r.approveAria}
                onClick={r.onApprove}
                leading={<Check size={13} aria-hidden="true" />}
                label={t("skillMarket.review.approve")}
              />
              <RowAction
                show={!!r.onReject}
                busy={r.busy}
                aria={r.rejectAria}
                onClick={r.onReject}
                leading={<X size={13} aria-hidden="true" />}
                label={t("skillMarket.review.reject")}
              />
              <RowAction
                show={!!r.onPublish}
                busy={r.busy}
                primary
                aria={r.publishAria}
                onClick={r.onPublish}
                leading={<Upload size={13} aria-hidden="true" />}
                label={t("skillMarket.plugin.actionPublish")}
              />
              <RowAction
                show={!!r.onUpgrade}
                busy={r.busy}
                primary
                aria={r.upgradeAria}
                onClick={r.onUpgrade}
                leading={<Upload size={13} aria-hidden="true" />}
                label={t("skillMarket.plugin.actionUpgrade")}
              />
              <RowAction
                show={!!r.onCancelReview}
                busy={r.busy}
                aria={r.cancelReviewAria}
                onClick={r.onCancelReview}
                leading={<Clock size={13} aria-hidden="true" />}
                label={t("skillMarket.plugin.actionCancelReview")}
              />
              <RowAction
                show={!!r.onDelist}
                busy={r.busy}
                danger
                aria={r.delistAria}
                onClick={r.onDelist}
                // The mirror image of the Upload arrow that marks 发布/升级版本:
                // that one puts a plugin up, this one takes it back down off the
                // shelf, which is literally what 下架 says. An X (ArchiveX /
                // PackageX) would read as "destroy" and is already spoken for by
                // 拒绝; an eye-with-a-slash would read as a 可见性 change, which
                // this is not — the plugin keeps its declared visibility.
                leading={<ArrowDownFromLine size={13} aria-hidden="true" />}
                label={t("skillMarket.plugin.actionDelist")}
              />
              <RowAction
                show={!!r.onEdit}
                busy={r.busy}
                iconOnly
                aria={r.editAria}
                title={t("skillMarket.plugin.actionEdit")}
                onClick={r.onEdit}
                label={<Pencil size={14} aria-hidden="true" />}
              />
              <RowAction
                show={!!r.onDelete}
                busy={r.busy}
                iconOnly
                danger
                aria={r.deleteAria}
                title={t("skillMarket.plugin.actionDelete")}
                onClick={r.onDelete}
                label={<Trash2 size={14} aria-hidden="true" />}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RowAction(props: {
  show: boolean;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
  iconOnly?: boolean;
  aria?: string;
  title?: string;
  leading?: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
}) {
  if (!props.show) return null;
  const cls = [
    "wk-mine-table__action",
    props.primary ? "wk-mine-table__action--primary" : "",
    props.danger ? "wk-mine-table__action--danger" : "",
    props.iconOnly ? "wk-mine-table__action--icon" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      aria-label={props.aria}
      title={props.title}
      disabled={props.busy}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.();
      }}
    >
      {props.leading}
      {props.label}
    </button>
  );
}
