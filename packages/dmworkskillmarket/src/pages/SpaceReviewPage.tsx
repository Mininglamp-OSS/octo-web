import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import ReviewQueue from "../components/ReviewQueue";
import { getReviewPolicy, updateReviewPolicy } from "../api/skillApi";
import { isSpaceReviewerRole, useSpaceRole } from "../hooks/useSpaceRole";

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
  const { isReviewer, loading: roleLoading } = useSpaceRole();
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  // Loads and saves are tied to the Space that started them. Switching Space
  // invalidates every older request so a slow response from A cannot overwrite
  // the policy, error, or busy state currently shown for B.
  const requestGenerationRef = useRef(0);

  const loadPolicy = useCallback(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    setEnabled(undefined);
    setLoading(true);
    setSaving(false);
    setLoadError(null);
    setSaveError(null);
    getReviewPolicy()
      .then((policy) => {
        if (requestGeneration !== requestGenerationRef.current) return;
        setEnabled(policy.isAutoApproveEnabled);
      })
      .catch((err) => {
        if (requestGeneration !== requestGenerationRef.current) return;
        setLoadError(err instanceof Error ? err.message : t("skillMarket.review.policyLoadFailed"));
      })
      .finally(() => {
        if (requestGeneration !== requestGenerationRef.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handleSpaceChanged = (payload?: unknown) => {
      requestGenerationRef.current += 1;
      setEnabled(undefined);
      setLoading(true);
      setSaving(false);
      setLoadError(null);
      setSaveError(null);
      setDisableConfirmOpen(false);
      const role = (payload as { role?: unknown } | undefined)?.role;
      if (typeof role === "number" && isSpaceReviewerRole(role)) loadPolicy();
      else if (typeof role === "number") setLoading(false);
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      requestGenerationRef.current += 1;
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, []);

  useEffect(() => {
    if (roleLoading) return;
    if (!isReviewer) {
      requestGenerationRef.current += 1;
      setEnabled(undefined);
      setLoading(false);
      setSaving(false);
      setLoadError(null);
      setSaveError(null);
      setDisableConfirmOpen(false);
      return;
    }
    loadPolicy();
  }, [isReviewer, loadPolicy, roleLoading]);

  async function savePolicy(next: boolean): Promise<boolean> {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const policy = await updateReviewPolicy(next);
      if (requestGeneration !== requestGenerationRef.current) return false;
      setEnabled(policy.isAutoApproveEnabled);
      return true;
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current) return false;
      setSaveError(err instanceof Error ? err.message : t("skillMarket.review.policySaveFailed"));
      return false;
    } finally {
      if (requestGeneration === requestGenerationRef.current) setSaving(false);
    }
  }

  function handlePolicyChange(next: boolean) {
    if (!next) {
      setSaveError(null);
      setDisableConfirmOpen(true);
      return;
    }
    void savePolicy(true);
  }

  async function confirmDisable() {
    if (await savePolicy(false)) setDisableConfirmOpen(false);
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
        {isReviewer && (
          <section className="skill-market-review-policy" aria-label={t("skillMarket.review.policyTitle")}>
            <div>
              <strong>{t("skillMarket.review.policyTitle")}</strong>
              <p>{t("skillMarket.review.policyDescription")}</p>
              {(loadError || saveError) && (
                <p className="skill-market-review-policy__error">{loadError || saveError}</p>
              )}
            </div>
            {enabled !== undefined && !loadError && (
              <label className="skill-market-review-policy__toggle">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={saving}
                  onChange={(event) => void handlePolicyChange(event.target.checked)}
                />
                <span>{enabled ? t("skillMarket.review.policyEnabled") : t("skillMarket.review.policyDisabled")}</span>
              </label>
            )}
          </section>
        )}
        <ReviewQueue mode="space" />
      </main>
      <WKModal
        visible={disableConfirmOpen}
        onCancel={() => !saving && setDisableConfirmOpen(false)}
        title={t("skillMarket.review.policyDisableTitle")}
        footer={
          <>
            <WKButton variant="secondary" onClick={() => setDisableConfirmOpen(false)} disabled={saving}>
              {t("skillMarket.common.cancel")}
            </WKButton>
            <WKButton variant="danger" onClick={() => void confirmDisable()} loading={saving}>
              {t("skillMarket.review.policyDisableAction")}
            </WKButton>
          </>
        }
      >
        <div className="skill-market-review-policy-confirm">
          <span className="skill-market-review-policy-confirm__icon" aria-hidden="true">
            <AlertTriangle size={22} />
          </span>
          <div>
            <strong>{t("skillMarket.review.policyDisableHeading")}</strong>
            <p>{t("skillMarket.review.policyDisableConfirm")}</p>
            {saveError && <p className="skill-market-review-policy-confirm__error">{saveError}</p>}
          </div>
        </div>
      </WKModal>
    </div>
  );
}
