import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { t, useI18n, WKApp, WKButton, WKModal } from "@octo/base";
import type { ReviewRequest } from "../types/skill";
import { approveReview, getReviewRequest, rejectReview } from "../api/skillApi";
import { formatFullDateTime } from "../utils/format";
import { pluginTypeLabel, reviewKindLabel } from "../utils/review";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import RejectReasonModal from "./RejectReasonModal";

interface ReviewDetailDrawerProps {
  /** Null closes the drawer. */
  reviewId: string | null;
  /** Cosmetic: show the approve/reject footer. Only the reviewer queue passes
   *  true; the server enforces the role regardless. */
  canReview: boolean;
  onClose: () => void;
  /** Fired after a successful approve or reject. */
  onDecided: () => void;
}

export default function ReviewDetailDrawer({
  reviewId,
  canReview,
  onClose,
  onDecided,
}: ReviewDetailDrawerProps) {
  useI18n();
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const spaceGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const actingRef = useRef<symbol | null>(null);
  const loadedSpaceRef = useRef<string | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    const handleSpaceChanged = () => {
      spaceGenerationRef.current += 1;
      generationRef.current += 1;
      actingRef.current = null;
      setReview(null);
      setError(null);
      setRejectOpen(false);
      setActing(false);
      setLoading(false);
      onCloseRef.current();
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      mountedRef.current = false;
      spaceGenerationRef.current += 1;
      generationRef.current += 1;
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, []);

  useLayoutEffect(() => {
    // This component remains mounted while reviewId changes. Reset every action
    // state before loading the next record so a reject dialog or in-flight
    // action from the previous review cannot attach itself to the new one.
    const generation = ++generationRef.current;
    const spaceId = WKApp.shared?.currentSpaceId;
    loadedSpaceRef.current = spaceId;
    actingRef.current = null;
    setReview(null);
    setError(null);
    setIconError(false);
    setRejectOpen(false);
    setActing(false);
    setLoading(Boolean(reviewId));
    if (reviewId) getReviewRequest(reviewId)
      .then((item) => {
        if (generation !== generationRef.current) return;
        if (spaceId !== WKApp.shared?.currentSpaceId) {
          setError(t("skillMarket.review.spaceChanged"));
          return;
        }
        setReview(item);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        setError(spaceId !== WKApp.shared?.currentSpaceId
          ? t("skillMarket.review.spaceChanged")
          : err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });
    return () => {
      generationRef.current += 1;
    };
  }, [reviewId, reloadKey]);

  function handleClose() {
    if (actingRef.current) return;
    onClose();
  }

  async function decide(action: "approve" | "reject", reason?: string) {
    if (!review || review.id !== reviewId || !canReview || review.status !== "pending" || actingRef.current) return;
    const spaceId = loadedSpaceRef.current;
    if (spaceId !== WKApp.shared?.currentSpaceId) {
      const changed = new Error(t("skillMarket.review.spaceChanged"));
      setError(changed.message);
      if (action === "reject") throw changed;
      return;
    }
    const actionReviewId = review.id;
    const generation = generationRef.current;
    const spaceGeneration = spaceGenerationRef.current;
    const isSession = () => mountedRef.current && generation === generationRef.current;
    const isCurrentSpace = () => mountedRef.current && spaceGeneration === spaceGenerationRef.current && spaceId === WKApp.shared?.currentSpaceId;
    const token = Symbol("review-decision");
    actingRef.current = token;
    setActing(true);
    setError(null);
    try {
      if (action === "approve") await approveReview(actionReviewId);
      else await rejectReview(actionReviewId, reason ?? "");
      if (!isCurrentSpace()) {
        // Do not report an old-Space outcome in this Space. A still-open
        // reason dialog must not interpret this dropped continuation as success.
        const changed = new Error(t("skillMarket.review.spaceChanged"));
        if (isSession()) setError(changed.message);
        if (action === "reject") throw changed;
        return;
      }
      // A completed decision still changes this Space's queue if the host has
      // switched drawers. Refresh it without touching the new drawer session.
      onDecided();
      if (!isSession() || !isCurrentSpace()) return;
      setRejectOpen(false);
      onClose();
    } catch (err) {
      const failure = isSession() && !isCurrentSpace()
        ? new Error(t("skillMarket.review.spaceChanged")) : err;
      if (isSession()) {
        setError(failure instanceof Error ? failure.message : t(action === "approve" ? "skillMarket.review.approveFailed" : "skillMarket.review.actionFailed"));
      }
      // The keyed reason modal belongs to this session. Rethrow even if it
      // became stale so a retained reason is never cleared as a fake success.
      if (action === "reject") throw failure;
    } finally {
      // Only this operation may release its slot. A silent global Space change
      // cannot strand the lock, and an old operation cannot unlock a new one.
      if (mountedRef.current && actingRef.current === token) {
        actingRef.current = null;
        setActing(false);
      }
    }
  }

  const displayName = review?.pluginName ?? "";
  const typeLabel = review ? pluginTypeLabel(review.pluginType) : "";
  const spaceChanged = loadedSpaceRef.current !== WKApp.shared?.currentSpaceId;
  const canAct = canReview && review?.status === "pending" && !spaceChanged;

  return (
    <>
      <WKModal
        visible={Boolean(reviewId)}
        onCancel={handleClose}
        options={{ closable: !acting, maskClosable: !acting, closeOnEsc: !acting }}
        title={null}
        size="lg"
        header={
          review ? (
            <div className="skill-market-detail-header">
              <span className="skill-market-detail-header__icon">
                {review.pluginIconUrl && !iconError ? (
                  <img
                    src={review.pluginIconUrl}
                    alt=""
                    onError={() => setIconError(true)}
                  />
                ) : (
                  <span style={{ background: getSkillAvatarColor(displayName) }}>
                    {getSkillAvatarText(displayName)}
                  </span>
                )}
              </span>
              <div className="skill-market-detail-header__main">
                <div className="skill-market-detail-header__top-row">
                  <div className="skill-market-detail-header__title-row">
                    <h2 title={displayName}>{displayName}</h2>
                    {typeLabel && (
                      <span className="skill-market-detail-header__badge">{typeLabel}</span>
                    )}
                    <span
                      className={`skill-market-detail-header__badge skill-market-review-badge--${review.kind}`}
                    >
                      {reviewKindLabel(review.kind)}
                    </span>
                  </div>
                  <div className="skill-market-detail-header__right">
                    <span className="skill-market-detail-header__version">v{review.version}</span>
                    <button
                      type="button"
                      title={t("skillMarket.review.close")}
                      aria-label={t("skillMarket.review.close")}
                      onClick={handleClose}
                      disabled={acting}
                      className="skill-market-review-close"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null
        }
        bodyStyle={{ maxHeight: "70vh", overflow: "auto" }}
        footer={
          canAct && review ? (
            <>
              <WKButton variant="secondary" onClick={handleClose} disabled={acting}>
                {t("skillMarket.common.cancel")}
              </WKButton>
              <WKButton variant="danger" onClick={() => setRejectOpen(true)} disabled={acting}>
                {t("skillMarket.review.reject")}
              </WKButton>
              <WKButton
                variant="primary"
                onClick={() => void decide("approve")}
                loading={acting}
                disabled={acting}
              >
                {t("skillMarket.review.approveAndPublish")}
              </WKButton>
            </>
          ) : null
        }
      >
        {loading && (
          <div className="skill-market-modal-state">{t("skillMarket.common.loading")}</div>
        )}
        {error && (
          <div className="skill-market-modal-state is-error">
            <AlertCircle size={20} />
            <span>{error}</span>
            {!spaceChanged && (
              <WKButton
                variant="secondary"
                size="small"
                icon={<RefreshCw size={14} />}
                onClick={retry}
                disabled={acting}
              >
                {t("skillMarket.list.retry")}
              </WKButton>
            )}
          </div>
        )}
        {review && !loading && (
          <div className="skill-market-detail">
            {review.kind === "upgrade" && review.currentVersion && (
              <div className="skill-market-review-upgrade-callout">
                {t("skillMarket.review.detailUpgradeCallout", {
                  values: { current: review.currentVersion, next: review.version },
                })}
              </div>
            )}
            {review.status === "rejected" && review.reason && (
              <div className="skill-market-review-rejected-callout">
                <strong>{t("skillMarket.review.statusRejected")}</strong>
                <span>
                  {t("skillMarket.review.reasonLabel", { values: { reason: review.reason } })}
                </span>
              </div>
            )}
            <table className="skill-market-detail__frontmatter">
              <tbody>
                <tr>
                  <th>{t("skillMarket.review.fieldType")}</th>
                  <td>{typeLabel}</td>
                </tr>
                <tr>
                  <th>{t("skillMarket.review.fieldApplicant")}</th>
                  <td>{review.applicantName}</td>
                </tr>
                <tr>
                  <th>{t("skillMarket.review.fieldSubmittedAt")}</th>
                  <td>{formatFullDateTime(review.submittedAt)}</td>
                </tr>
                <tr>
                  <th>{t("skillMarket.review.fieldKind")}</th>
                  <td>{reviewKindLabel(review.kind)}</td>
                </tr>
                <tr>
                  <th>{t("skillMarket.review.fieldVersion")}</th>
                  <td>v{review.version}</td>
                </tr>
                {review.changelog && (
                  <tr>
                    <th>{t("skillMarket.review.fieldChangelog")}</th>
                    <td>{review.changelog}</td>
                  </tr>
                )}
                {review.reviewerName && (
                  <tr>
                    <th>{t("skillMarket.review.fieldReviewer")}</th>
                    <td>{review.reviewerName}</td>
                  </tr>
                )}
                {review.reviewedAt && (
                  <tr>
                    <th>{t("skillMarket.review.fieldReviewedAt")}</th>
                    <td>{formatFullDateTime(review.reviewedAt)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {review.frozenRelations && (
              <section className="skill-market-review-relations" aria-label={t("skillMarket.review.relationsTitle")}>
                <h3>{t("skillMarket.review.relationsTitle")}</h3>
                {review.frozenRelations.length === 0 ? (
                  <p>{t("skillMarket.review.relationsEmpty")}</p>
                ) : (
                  <ul>
                    {review.frozenRelations.map((relation, index) => (
                      <li key={relation.relationId ?? `${relation.targetPluginId}-${relation.relationType}-${index}`}>
                        <div>
                          <strong>{relation.targetPluginId}</strong>
                          {relation.targetPluginType && <span>{relation.targetPluginType}</span>}
                          <span>{relation.relationType}</span>
                          <span>#{relation.sortOrder}</span>
                        </div>
                        {relation.data && Object.keys(relation.data).length > 0 && (
                          <pre>{JSON.stringify(relation.data, null, 2)}</pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {review.readmeContent && (
              // The frozen submission snapshot, i.e. exactly the SKILL.md that
              // would go live. Sanitized: it is untrusted applicant content.
              // The backend currently returns "" here; render only when
              // non-empty so we don't show an empty bordered box.
              <div className="skill-market-detail__readme">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {review.readmeContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </WKModal>
      {review && (
        <RejectReasonModal
          key={generationRef.current}
          visible={rejectOpen}
          pluginName={review.pluginName}
          onClose={() => {
            if (!actingRef.current) setRejectOpen(false);
          }}
          onConfirm={(reason) => decide("reject", reason)}
        />
      )}
    </>
  );
}
