import React, { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { t, useI18n, WKButton, WKModal } from "@octo/base";
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

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!reviewId) {
      setReview(null);
      setError(null);
      setIconError(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setIconError(false);
    getReviewRequest(reviewId)
      .then((item) => {
        if (alive) setReview(item);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reviewId, reloadKey]);

  async function handleApprove() {
    if (!review) return;
    setActing(true);
    setError(null);
    try {
      await approveReview(review.id);
      onDecided();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.review.approveFailed"));
    } finally {
      setActing(false);
    }
  }

  const displayName = review?.pluginName ?? "";
  const typeLabel = review ? pluginTypeLabel(review.pluginType) : "";
  const canAct = canReview && review?.status === "pending";

  return (
    <>
      <WKModal
        visible={Boolean(reviewId)}
        onCancel={onClose}
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
                      onClick={onClose}
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
              <WKButton variant="secondary" onClick={onClose} disabled={acting}>
                {t("skillMarket.common.cancel")}
              </WKButton>
              <WKButton variant="danger" onClick={() => setRejectOpen(true)} disabled={acting}>
                {t("skillMarket.review.reject")}
              </WKButton>
              <WKButton
                variant="primary"
                onClick={() => void handleApprove()}
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
            <WKButton
              variant="secondary"
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={retry}
            >
              {t("skillMarket.list.retry")}
            </WKButton>
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
          visible={rejectOpen}
          pluginName={review.pluginName}
          onClose={() => setRejectOpen(false)}
          onConfirm={async (reason) => {
            // Defect 2 fix: wrap with try/catch so CONFLICT surfaces as an
            // inline error instead of leaving the drawer open with no feedback.
            // On success, propagate to parent (which refreshes queues).
            try {
              await rejectReview(review.id, reason);
            } catch (err) {
              setError(err instanceof Error ? err.message : t("skillMarket.review.actionFailed"));
              setRejectOpen(false);
              // Reload to reconcile any concurrent-decision state.
              retry();
              throw err;
            }
            setRejectOpen(false);
            onDecided();
            onClose();
          }}
        />
      )}
    </>
  );
}
