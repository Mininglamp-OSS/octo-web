import React, { useCallback, useEffect, useRef, useState } from "react";
import { TextArea } from "@douyinfe/semi-ui";
import { versionErrorKey } from "@dmwork/skillmarket";
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
   * Fetch the live FROZEN content (manifest + package) to submit WITH an
   * upgrade. Present ONLY for an already-listed container (专家 / 专家团) upgrade:
   * the backend refuses a contentless submission for a listed plugin
   * field-agnostically (freezeSubmission → `manifest_json/required`, HTTP 400),
   * because snapshotting the still-live row would make the review theatre. A
   * 专家/专家团 has no client-side authoring surface, so the client echoes the
   * live row's own content — the same contract skill/connector upgrades follow
   * through their full-form review modes. Absent for a FIRST listing (the row is
   * a private draft the server can freeze as-is) and for leaf connectors (which
   * upgrade through McpCreateModal's review mode instead).
   */
  loadContent?: () => Promise<{ manifestJson: unknown; pluginJson: unknown }>;
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
 * /plugins/review_requests`. Whether CONTENT travels with it depends on the path:
 *   - a FIRST listing submits a private draft, so the plugin row IS the thing
 *     under review and the server freezes it — no content is sent,
 *   - a connector 发布新版本 carries genuinely new content and therefore goes
 *     through McpCreateModal's review mode instead (it needs the whole form),
 *   - a 专家 / 专家团 UPGRADE has no client-side content authoring (records are
 *     written by a Bot through octo-cli), so the modal fetches the live row's
 *     own frozen content via `target.loadContent` and echoes it: the backend
 *     refuses a contentless submission on an already-listed plugin, so the
 *     client submits the current bytes without disturbing the live row until
 *     approval.
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
  // Live frozen content for an upgrade. `undefined` = not resolved yet (submit
  // is blocked when `needsContent`); a resolved object carries the manifest and
  // package to echo. Never set for a first listing.
  const [content, setContent] = useState<
    { manifestJson: unknown; pluginJson: unknown } | undefined
  >(undefined);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Drops any async completion that belongs to a previous target. Without it, if
  // the modal switches from expert A to expert B while A's /plugins/detail is in
  // flight and A resolves AFTER B, A's child graph (and content) would land in
  // B's modal and be frozen onto B on approve — the exact corruption P1-4/🔴-1
  // guard against. Mirrors useSpaceRole's generationRef.
  const generationRef = useRef(0);

  const needsRelations = Boolean(target?.loadRelations);
  const needsContent = Boolean(target?.loadContent);

  const resolveTarget = useCallback((item: ReviewSubmitTarget) => {
    const generation = ++generationRef.current;
    if (!item.loadRelations && !item.loadContent) {
      setRelations(undefined);
      setContent(undefined);
      setResolveError(null);
      setResolving(false);
      return;
    }
    setResolving(true);
    setResolveError(null);
    // One detail read backs both loaders, but they are independent promises;
    // resolve them together so `resolving` clears only when BOTH are in.
    Promise.all([
      item.loadRelations ? item.loadRelations() : Promise.resolve(undefined),
      item.loadContent ? item.loadContent() : Promise.resolve(undefined),
    ])
      .then(([list, live]) => {
        if (generation !== generationRef.current) return;
        setRelations(list);
        setContent(live);
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current) return;
        // Fail CLOSED. Submitting without relations would silently fall back to
        // "inherit the live graph", producing exactly the incomplete snapshot
        // this resolution exists to prevent; submitting `[]` would wipe the
        // children on approve; submitting without content 400s on a listed
        // plugin. So on any failure, block and offer a retry.
        setRelations(undefined);
        setContent(undefined);
        setResolveError(
          err instanceof Error ? err.message : t("mcp.review.relationsFailed")
        );
      })
      .finally(() => {
        if (generation !== generationRef.current) return;
        setResolving(false);
      });
  }, []);

  // Reseed on every open / target switch so a previous session's version label,
  // changelog or error never leaks into the next one.
  useEffect(() => {
    if (!target) {
      generationRef.current++;
      setRelations(undefined);
      setContent(undefined);
      setResolveError(null);
      setResolving(false);
      return;
    }
    setVersion(bumpPatch(target.version));
    setChangelog(target.initialChangelog ?? "");
    setError(null);
    setSubmitting(false);
    resolveTarget(target);
  }, [target, resolveTarget]);

  // An upgrade must exceed the version currently listed, which is exactly what
  // the server compares against.
  const versionError = versionErrorKey(target?.version, version);
  const blocked =
    submitting ||
    Boolean(versionError) ||
    resolving ||
    (needsRelations && relations === undefined) ||
    (needsContent && content === undefined);

  async function submit() {
    if (!target) return;
    if (!version.trim() || !changelog.trim()) {
      setError(t("skillMarket.review.versionAndChangelogRequired"));
      return;
    }
    if (
      (needsRelations && relations === undefined) ||
      (needsContent && content === undefined)
    ) {
      setError(resolveError ?? t("mcp.review.relationsFailed"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitPluginReview({
        pluginId: target.pluginId,
        version: version.trim(),
        changelog: changelog.trim(),
        // A listed container upgrade must carry its own content, or the backend
        // refuses it (a contentless submission on a listed plugin 400s); a first
        // listing carries none (the server freezes the private draft row).
        ...(needsContent && content
          ? { manifestJson: content.manifestJson, pluginJson: content.pluginJson }
          : {}),
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
          ? t("skillMarket.plugin.actionUpgrade")
          : t("skillMarket.plugin.actionPublish")
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
              ? t("skillMarket.plugin.actionUpgrade")
              : t("skillMarket.plugin.actionPublish")}
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
          {versionError && <p className="skill-market-field-error">{t(versionError)}</p>}
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
            {resolving
              ? t("mcp.review.relationsLoading")
              : relations
                ? t("mcp.review.relationsFrozen", {
                    values: { count: relations.length },
                  })
                : (resolveError ?? t("mcp.review.relationsFailed"))}
            {!resolving && relations === undefined && target && (
              <WKButton
                size="sm"
                variant="secondary"
                onClick={() => resolveTarget(target)}
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
