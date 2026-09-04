import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, PackageOpen, RefreshCw } from "lucide-react";
import { Toast } from "@douyinfe/semi-ui";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import {
  MineTable,
  cancelReview,
  deleteSkill,
  getMySkills,
  getSkillAvatarColor,
  getSkillAvatarText,
  publishPlugin,
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
 * The actions it offers are exactly the TYPE-AGNOSTIC ones — 发布, 取消审核 and
 * 删除 each go through an endpoint that takes a plugin id and nothing else. 编辑
 * and 升级版本 are absent because they need the owning market's authoring surface
 * (a connector edits through a wizard, an expert through a bot flow), and
 * reproducing that dispatch here would guarantee this tab drifts from the four
 * that own those flows. Clicking a row opens the tab that can do them.
 */
export default function AllAssetsList({ onOpenType }: { onOpenType: (type: string) => void }) {
  useI18n();
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
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

  // Re-read on a Space switch. Every per-type tab (SkillListPage,
  // McpMarketListPage) subscribes; the 全部 tab — which is the default view and
  // aggregates all four types — otherwise keeps rendering the previous Space's
  // rows with live 发布 / 取消审核 / 删除 bound to old-Space plugin ids. The right
  // pane is only remounted by MarketSidebar for the mcp-market menu, so this tab
  // cannot rely on a remount to reset it.
  useEffect(() => {
    const handleSpaceChanged = () => {
      void load();
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, [load]);

  /** Runs one row action and reloads either way — on a conflict the server
   *  already knows a state this page does not. The row stays disabled until the
   *  reload settles so a second click cannot race it. */
  const run = useCallback(
    async (id: string, action: () => Promise<void>, failKey: string) => {
      setBusyId(id);
      try {
        await action();
      } catch (err) {
        Toast.error(err instanceof Error ? err.message : t(failKey));
      } finally {
        await load();
        setBusyId(null);
      }
    },
    [load]
  );

  if (loading && items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-review-list--loading">
          <RefreshCw size={16} className="skill-market-spin" />
          {t("skillMarket.common.loading")}
        </div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-state is-error">
          <AlertCircle size={28} />
          <strong>{t("skillMarket.common.loadFailed")}</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="wk-mcp-mine__all">
        <div className="skill-market-state">
          <PackageOpen size={48} />
          <strong>{t("mcp.mine.emptyAll")}</strong>
        </div>
      </div>
    );
  }

  const rows: MineRow[] = items.map((item) => {
    const wireType = item.pluginType ?? "skill";
    const status = item.displayStatus ?? "draft";
    const pending = status === "pending_review";
    return {
      id: item.id,
      type: ROW_TYPE[wireType] ?? "skill",
      trackItemType: wireType,
      // Each type draws its avatar the way its OWN tab draws it — skills key the
      // tile off the name, the other markets off the id — so the same row does
      // not change appearance depending on which tab you found it in.
      icon: item.iconUrl ? (
        <img className="wk-mine-table__avatar-img" src={item.iconUrl} alt="" />
      ) : wireType === "skill" ? (
        <span
          className="wk-mine-table__avatar-tile"
          style={{ background: getSkillAvatarColor(item.name) }}
        >
          {getSkillAvatarText(item.name)}
        </span>
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
      status,
      ariaLabel: item.name,
      busy: busyId === item.id,
      onOpen: () => onOpenType(wireType),
      onPublish:
        item.listingState !== "published" && !pending
          ? () =>
              void run(
                item.id,
                async () => {
                  // The backend routes on the plugin's declared visibility, so the
                  // toast comes from the response rather than being guessed here.
                  const outcome = await publishPlugin({
                    pluginId: item.id,
                    version: item.version,
                  });
                  Toast.success(
                    outcome.displayStatus === "pending_review"
                      ? t("skillMarket.review.submittedToast")
                      : t("skillMarket.plugin.publishedToast")
                  );
                },
                "skillMarket.review.submitFailed"
              )
          : undefined,
      publishAria: t("skillMarket.plugin.ariaPublish", { values: { name: item.name } }),
      onCancelReview:
        pending && item.reviewId
          ? () =>
              void run(
                item.id,
                async () => {
                  await cancelReview(item.reviewId as string);
                  Toast.success(t("skillMarket.review.canceledToast"));
                },
                "skillMarket.review.cancelFailed"
              )
          : undefined,
      cancelReviewAria: t("skillMarket.plugin.ariaCancelReview", { values: { name: item.name } }),
      onDelete: () => setDeleting(item),
      deleteAria: t("skillMarket.plugin.ariaDelete", { values: { name: item.name } }),
    };
  });

  return (
    <div className="wk-mcp-mine__all">
      <MineTable rows={rows} ariaLabel={t("mcp.mine.allAriaLabel")} />
      <WKModal
        visible={Boolean(deleting)}
        onCancel={() => {
          if (!busyId) setDeleting(null);
        }}
        title={t("mcp.mine.deleteTitle")}
        footer={
          <>
            <WKButton
              variant="secondary"
              onClick={() => setDeleting(null)}
              disabled={Boolean(busyId)}
            >
              {t("skillMarket.common.cancel")}
            </WKButton>
            <WKButton
              variant="danger"
              loading={Boolean(busyId)}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                setDeleting(null);
                void run(
                  target.id,
                  async () => {
                    await deleteSkill(target.id);
                    Toast.success(t("mcp.mine.deletedToast"));
                  },
                  "skillMarket.review.actionFailed"
                );
              }}
            >
              {t("skillMarket.plugin.actionDelete")}
            </WKButton>
          </>
        }
      >
        <p>{t("mcp.mine.deleteHint", { values: { name: deleting?.name ?? "" } })}</p>
      </WKModal>
    </div>
  );
}
