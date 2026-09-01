import React, { useState } from "react";
import {
  Building2,
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
  XCircle,
} from "lucide-react";
import { t } from "@octo/base";
import type { ReviewRequest } from "../types/skill";
import { formatCount } from "../utils/format";

/** The four personal-asset kinds shown in "我的发布". The type marker in the
 *  bottom-right of each row's avatar disambiguates them (the tabs are per-type
 *  today, but the marker keeps the row self-describing and matches the design). */
export type MineAssetType = "skill" | "connector" | "expert" | "squad";

/** Derived review badge for an owner row. `state` is the union of visibility
 *  and the latest pending/rejected review attached to the plugin (computed by
 *  the page from `deriveSkillReviewState`); the table just renders it. */
export type MineReviewBadge =
  | "private"
  | "pending"
  | "pending-upgrade"
  | "rejected"
  | "live";

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
  /** ── Review state (owner-view only). Absent on non-owner rows and on
   *  market packages (mcp / experts) that don't participate in the skill
   *  review flow. */
  reviewBadge?: MineReviewBadge;
  /** Rejection reason, surfaced as a title / tooltip on the 已拒绝 badge. */
  rejectReason?: string;
  /** Callbacks gated by the page on the derived state; the table only renders
   *  a button when its callback is present, matching the existing edit/delete
   *  idiom. */
  onSubmitReview?: () => void;
  onCancelReview?: () => void;
  onResubmit?: () => void;
  onPublishVersion?: () => void;
  submitReviewAria?: string;
  cancelReviewAria?: string;
  resubmitAria?: string;
  publishVersionAria?: string;
}

interface MineTableProps {
  rows: MineRow[];
  /** Maps a raw visibility key -> its localized label. Passed per package so the
   *  连接器/专家 tabs (mcp namespace) and 技能 tab (skillMarket namespace) keep
   *  their own wording (全平台 / 本组织 / 仅自己). */
  visibilityLabel: (key: string) => string;
  /** Show the 浏览 / 下载 columns. Connectors hide them (no meaningful per-row
   *  view/download); skills and experts show them. Defaults to true. */
  showStats?: boolean;
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

function badgeLabel(badge: MineReviewBadge): string {
  switch (badge) {
    case "private":
      return t("skillMarket.review.badgePrivate");
    case "pending":
      return t("skillMarket.review.statusPending");
    case "pending-upgrade":
      return t("skillMarket.review.badgePendingUpgrade");
    case "rejected":
      return t("skillMarket.review.statusRejected");
    case "live":
      return t("skillMarket.review.badgeLive");
    default:
      return "";
  }
}

export default function MineTable({ rows, visibilityLabel, showStats = true }: MineTableProps) {
  return (
    <div
      className={`wk-mine-table${showStats ? "" : " wk-mine-table--nostats"}`}
      role="table"
      aria-label={t("skillMarket.mineTable.ariaLabel")}
    >
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
        {showStats && (
          <>
            <span className="wk-mine-table__col wk-mine-table__col--num" role="columnheader">
              {t("skillMarket.mineTable.views")}
            </span>
            <span className="wk-mine-table__col wk-mine-table__col--num" role="columnheader">
              {t("skillMarket.mineTable.downloads")}
            </span>
          </>
        )}
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
                    {r.reviewBadge && (
                      <span
                        className={`wk-mine-review-badge wk-mine-review-badge--${r.reviewBadge}`}
                        title={r.reviewBadge === "rejected" ? r.rejectReason : undefined}
                      >
                        {r.reviewBadge === "pending" || r.reviewBadge === "pending-upgrade" ? (
                          <Clock size={11} aria-hidden="true" />
                        ) : r.reviewBadge === "rejected" ? (
                          <XCircle size={11} aria-hidden="true" />
                        ) : null}
                        {badgeLabel(r.reviewBadge)}
                      </span>
                    )}
                  </span>
                  {r.description && (
                    <span className="wk-mine-table__desc" title={r.description}>
                      {r.description}
                    </span>
                  )}
                  {r.reviewBadge === "rejected" && r.rejectReason && (
                    <span className="wk-mine-table__review-reason" title={r.rejectReason}>
                      {t("skillMarket.review.reasonInline", { values: { reason: r.rejectReason } })}
                    </span>
                  )}
                </span>
              </button>
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
            {showStats && (
              <>
                <span className="wk-mine-table__col wk-mine-table__col--num" role="cell">
                  {formatCount(r.views ?? 0)}
                </span>
                <span className="wk-mine-table__col wk-mine-table__col--num" role="cell">
                  {formatCount(r.downloads ?? 0)}
                </span>
              </>
            )}
            <span
              className="wk-mine-table__col wk-mine-table__col--actions"
              role="cell"
              data-track-ignore=""
              onClick={(e) => e.stopPropagation()}
            >
              {/* Review actions — rendered only when the page hands us the
                  corresponding callback. The page is responsible for gating
                  them on the derived state (private / pending / rejected /
                  listed) so this table never inspects role or visibility. */}
              {r.reviewBadge === "pending" && r.onCancelReview && (
                <button
                  type="button"
                  className="wk-mine-table__action"
                  aria-label={r.cancelReviewAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onCancelReview!();
                  }}
                >
                  <Clock size={13} aria-hidden="true" />
                  {t("skillMarket.review.cancelRequest")}
                </button>
              )}
              {r.reviewBadge === "rejected" && r.onResubmit && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--primary"
                  aria-label={r.resubmitAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onResubmit!();
                  }}
                >
                  {t("skillMarket.review.cardResubmit")}
                </button>
              )}
              {r.reviewBadge === "private" && r.onSubmitReview && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--primary"
                  aria-label={r.submitReviewAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onSubmitReview!();
                  }}
                >
                  {t("skillMarket.review.submitAction")}
                </button>
              )}
              {(r.reviewBadge === "live" || r.reviewBadge === "pending-upgrade") && r.onPublishVersion && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--primary"
                  aria-label={r.publishVersionAria}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onPublishVersion!();
                  }}
                >
                  <Upload size={13} aria-hidden="true" />
                  {t("skillMarket.review.publishNewVersion")}
                </button>
              )}
              {r.onEdit && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--icon"
                  aria-label={r.editAria}
                  title={t("skillMarket.common.edit")}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onEdit!();
                  }}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
              {r.onDelete && (
                <button
                  type="button"
                  className="wk-mine-table__action wk-mine-table__action--danger wk-mine-table__action--icon"
                  aria-label={r.deleteAria}
                  title={t("skillMarket.common.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.onDelete!();
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
