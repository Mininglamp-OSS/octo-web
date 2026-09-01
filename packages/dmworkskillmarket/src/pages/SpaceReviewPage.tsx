import React from "react";
import { t, useI18n } from "@octo/base";
import ReviewQueue from "../components/ReviewQueue";

/**
 * "组织审核" — the Space reviewer queue, mounted at /mcp-market/review as the
 * sidebar's fifth entry (see dmworkmcp/components/MarketSidebar.tsx). Owner and
 * admin only.
 *
 * Deliberately a thin shell, mirroring how MyAssetsPage hosts the "我的" market
 * views: the page owns the chrome (hero title) and `ReviewQueue` owns the
 * 待审核/已处理 sub-tabs plus every loading / empty / error state, so the two do
 * not render competing empty states.
 *
 * The sidebar's reviewer gate is COSMETIC — it only hides the entry. A member
 * who deep-links here still gets this page; the `mode=space` read behind
 * `ReviewQueue` answers 403 and the queue renders its own error state, and the
 * sidebar moves them off the route as soon as the role probe resolves.
 *
 * No space-change handling is needed here: MarketSidebar re-renders the right
 * pane from scratch on `space-changed`, so this page (and the queue's fetch)
 * remount with the new Space.
 */
export default function SpaceReviewPage() {
  useI18n();
  return (
    <div className="skill-market-page skill-market-page--review">
      <header className="skill-market-topbar">
        <div className="skill-market-hero-title">
          {/* `review.orgTab` predates the sidebar restructure (this used to be
              an in-page tab) but its copy — "组织审核" — is exactly the page
              title, and it is the only review heading key that exists. Renaming
              it to `review.pageTitle` is an i18n-owner call; do not add a second
              key with the same string. */}
          <h1>{t("skillMarket.review.orgTab")}</h1>
        </div>
      </header>
      <main className="skill-market-content">
        <ReviewQueue mode="space" />
      </main>
    </div>
  );
}
