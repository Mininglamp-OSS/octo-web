import React, { useCallback, useEffect, useState } from "react";
import { t, useI18n, WKApp } from "@octo/base";
import ReviewQueue from "../components/ReviewQueue";
import { getReviewPolicy, updateReviewPolicy } from "../api/skillApi";
import { useSpaceRole } from "../hooks/useSpaceRole";

/**
 * "组织发布管理" — the Space reviewer queue, mounted at /mcp-market/review as the
 * sidebar's fifth entry (see dmworkmcp/components/MarketSidebar.tsx). Owner and
 * admin only.
 *
 * The label says 发布管理 rather than 审核 because the page also delists (下架),
 * not only approves/rejects. The route, the component names and the
 * `/plugins/review_requests` read underneath deliberately keep the review
 * wording: only the user-facing label changed.
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
 * Space-change handling lives inside `ReviewQueue`, not here: MarketSidebar's
 * replaceToRoot renders the right pane back into the same slot with the same
 * component type and no key, so React KEEPS this page and the queue mounted
 * across a `space-changed` — it does not remount them. `ReviewQueue` therefore
 * subscribes to `space-changed` itself and refetches, the same way the 我的
 * tabs do; this shell needs no wiring of its own.
 */
export default function SpaceReviewPage() {
  useI18n();
  const { role } = useSpaceRole();
  const isOwner = role === 1;
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPolicy = useCallback(() => {
    setLoading(true);
    setError(null);
    getReviewPolicy()
      .then((policy) => setEnabled(policy.isAutoApproveEnabled))
      .catch((err) => setError(err instanceof Error ? err.message : t("skillMarket.review.policyLoadFailed")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPolicy();
    WKApp.mittBus.on("space-changed", loadPolicy);
    return () => WKApp.mittBus.off("space-changed", loadPolicy);
  }, [loadPolicy]);

  async function handlePolicyChange(next: boolean) {
    if (!next && !window.confirm(t("skillMarket.review.policyDisableConfirm"))) return;
    setSaving(true);
    setError(null);
    try {
      const policy = await updateReviewPolicy(next);
      setEnabled(policy.isAutoApproveEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.policySaveFailed"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="skill-market-page skill-market-page--review">
      <header className="skill-market-topbar">
        <div className="skill-market-hero-title">
          {/* `review.orgTab` predates the sidebar restructure (this used to be
              an in-page tab) but its copy — "组织发布管理" — is exactly the page
              title, and it is the only review heading key that exists. Renaming
              it to `review.pageTitle` is an i18n-owner call; do not add a second
              key with the same string. */}
          <h1>{t("skillMarket.review.orgTab")}</h1>
        </div>
      </header>
      <main className="skill-market-content">
        {isOwner && (
          <section className="skill-market-review-policy" aria-label={t("skillMarket.review.policyTitle")}>
            <div>
              <strong>{t("skillMarket.review.policyTitle")}</strong>
              <p>{t("skillMarket.review.policyDescription")}</p>
              {error && <p className="skill-market-review-policy__error">{error}</p>}
            </div>
            <label className="skill-market-review-policy__toggle">
              <input
                type="checkbox"
                checked={enabled}
                disabled={loading || saving}
                onChange={(event) => void handlePolicyChange(event.target.checked)}
              />
              <span>{enabled ? t("skillMarket.review.policyEnabled") : t("skillMarket.review.policyDisabled")}</span>
            </label>
          </section>
        )}
        <ReviewQueue mode="space" />
      </main>
    </div>
  );
}
