import React, { useCallback, useEffect, useState } from "react";
import { TextArea } from "@douyinfe/semi-ui";
import { t, useI18n, WKButton, WKInput, WKModal } from "@octo/base";
import {
  submitPluginReview,
  type PluginReviewRelation,
} from "../api/pluginReview";

/**
 * What is being submitted. Built by the market page from the row it was clicked
 * on, so this component owns no fetching policy of its own beyond resolving the
 * child set.
 */
export interface ReviewSubmitTarget {
  pluginId: string;
  /** Display name, for the modal heading. */
  name: string;
  /** The live version label; seeds the default next version. */
  version?: string;
  /**
   * True when the plugin is ALREADY listed to the org (`space`). The live
   * version keeps serving until a reviewer decides, and the copy says so.
   * False = first listing of a private draft.
   */
  isUpgrade: boolean;
  /** Prefilled changelog — used by 重新提交 to carry the rejected attempt's text. */
  initialChangelog?: string;
  /**
   * Resolve the plugin's CURRENT child relation graph. Present ONLY for the
   * container types (专家 / 专家团): the review payload treats an absent
   * `relations` as "inherit the live graph" and a present one (even `[]`) as
   * "replace with exactly this", so a container has to name its children or the
   * snapshot is incomplete, while a leaf type (connector) must not send the
   * field at all.
   */
  loadRelations?: () => Promise<PluginReviewRelation[]>;
}

interface ReviewSubmitModalProps {
  /** null = closed. */
  target: ReviewSubmitTarget | null;
  onClose: () => void;
  /** Fired after a successful submit, with a ready-to-show message. */
  onSubmitted: (message: string) => void;
}

/** Next patch version off a `major.minor.patch` label; falls back to 1.0.0 for
 *  anything that doesn't parse (a bot-authored record may carry no version). */
export function bumpPatch(version: string | undefined): string {
  const parts = (version ?? "").trim().replace(/^v/i, "").split(".");
  if (parts.length !== 3) return "1.0.0";
  const [major, minor, patch] = parts.map((p) => Number.parseInt(p, 10));
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) {
    return "1.0.0";
  }
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * 提交审核 / 重新提交 / 发布新版本 for the connector and 专家 markets.
 *
 * Collects the version label + changelog and posts `POST
 * /plugins/review_requests`. Content is deliberately NOT collected here:
 *   - a first listing submits a private draft, so the plugin row IS the thing
 *     under review and the server freezes it,
 *   - a connector 发布新版本 carries genuinely new content and therefore goes
 *     through McpCreateModal's review mode instead (it needs the whole form),
 *   - a 专家 / 专家团 has no client-side content authoring at all (records are
 *     written by a Bot through octo-cli), so an upgrade freezes the live
 *     documents and refreezes the child set.
 */
export default function ReviewSubmitModal({
  target,
  onClose,
  onSubmitted,
}: ReviewSubmitModalProps) {
  useI18n();
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Child set for a container type. `undefined` = not resolved yet (submit is
  // blocked); an array — including an empty one — is a resolved answer.
  const [relations, setRelations] = useState<PluginReviewRelation[] | undefined>(
    undefined
  );
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [loadingRelations, setLoadingRelations] = useState(false);

  const needsRelations = Boolean(target?.loadRelations);

  const resolveRelations = useCallback(
    (item: ReviewSubmitTarget) => {
      if (!item.loadRelations) {
        setRelations(undefined);
        setRelationsError(null);
        setLoadingRelations(false);
        return;
      }
      setLoadingRelations(true);
      setRelationsError(null);
      item
        .loadRelations()
        .then((list) => {
          setRelations(list);
        })
        .catch((err: unknown) => {
          // Fail CLOSED. Submitting without the field would silently fall back
          // to "inherit the live graph", producing exactly the incomplete
          // snapshot this resolution exists to prevent; submitting `[]` would
          // wipe the children on approve. So neither — block and offer a retry.
          setRelations(undefined);
          setRelationsError(
            err instanceof Error ? err.message : t("mcp.review.relationsFailed")
          );
        })
        .finally(() => setLoadingRelations(false));
    },
    []
  );

  // Reseed on every open / target switch so a previous session's version label,
  // changelog or error never leaks into the next one.
  useEffect(() => {
    if (!target) {
      setRelations(undefined);
      setRelationsError(null);
      setLoadingRelations(false);
      return;
    }
    setVersion(bumpPatch(target.version));
    setChangelog(target.initialChangelog ?? "");
    setError(null);
    setSubmitting(false);
    resolveRelations(target);
  }, [target, resolveRelations]);

  const blocked =
    submitting || (needsRelations && (loadingRelations || relations === undefined));

  async function submit() {
    if (!target) return;
    if (!version.trim() || !changelog.trim()) {
      setError(t("skillMarket.review.versionAndChangelogRequired"));
      return;
    }
    if (needsRelations && relations === undefined) {
      setError(relationsError ?? t("mcp.review.relationsFailed"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitPluginReview({
        pluginId: target.pluginId,
        version: version.trim(),
        changelog: changelog.trim(),
        // Only ever passed for a container type; `undefined` here means
        // "inherit", which is correct for a leaf.
        ...(needsRelations ? { relations } : {}),
      });
      onSubmitted(t("skillMarket.review.submittedToast"));
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("skillMarket.review.submitFailed")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WKModal
      visible={Boolean(target)}
      onCancel={onClose}
      title={
        target?.isUpgrade
          ? t("skillMarket.review.publishNewVersion")
          : t("skillMarket.review.submitAction")
      }
      footer={
        <>
          <WKButton variant="secondary" onClick={onClose} disabled={submitting}>
            {t("mcp.review.cancel")}
          </WKButton>
          <WKButton
            variant="primary"
            onClick={() => void submit()}
            loading={submitting}
            disabled={blocked}
          >
            {target?.isUpgrade
              ? t("skillMarket.review.publishNewVersion")
              : t("skillMarket.review.submitAction")}
          </WKButton>
        </>
      }
    >
      <div className="wk-mcp-review-submit">
        <p className="wk-mcp-review-submit__notice">
          {target?.isUpgrade
            ? t("skillMarket.review.upgradeNotice", {
                values: { version: target?.version ?? "" },
              })
            : t("skillMarket.review.firstListingNotice")}
        </p>
        <label className="wk-mcp-review-submit__field">
          <span>{t("skillMarket.review.fieldVersion")}</span>
          <WKInput value={version} onChange={setVersion} maxLength={32} />
        </label>
        <label className="wk-mcp-review-submit__field">
          <span>{t("skillMarket.review.fieldChangelog")}</span>
          <TextArea
            value={changelog}
            onChange={setChangelog}
            rows={4}
            maxLength={1000}
            placeholder={t("skillMarket.review.changelogPlaceholder")}
          />
        </label>
        {needsRelations && (
          <p className="wk-mcp-review-submit__relations">
            {loadingRelations
              ? t("mcp.review.relationsLoading")
              : relations
                ? t("mcp.review.relationsFrozen", {
                    values: { count: relations.length },
                  })
                : (relationsError ?? t("mcp.review.relationsFailed"))}
            {!loadingRelations && relations === undefined && target && (
              <WKButton
                size="sm"
                variant="secondary"
                onClick={() => resolveRelations(target)}
              >
                {t("mcp.list.retry")}
              </WKButton>
            )}
          </p>
        )}
        {error && <p className="wk-mcp-review-submit__error">{error}</p>}
      </div>
    </WKModal>
  );
}
