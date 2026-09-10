import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextArea } from "@douyinfe/semi-ui";
import { versionErrorKey } from "@dmwork/skillmarket";
import { t, useI18n, WKApp, WKButton, WKInput, WKModal } from "@octo/base";
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
   * Resolve everything the submission must freeze, in ONE read.
   *
   * `content` is the live FROZEN manifest + package, required WITH an upgrade of
   * an already-listed container (专家 / 专家团): the backend refuses a contentless
   * submission for a listed plugin field-agnostically (freezeSubmission →
   * `manifest_json/required`, HTTP 400), because snapshotting the still-live row
   * would make the review theatre. A 专家/专家团 has no client-side authoring
   * surface, so the client echoes the live row's own content — the same contract
   * skill/connector upgrades follow through their full-form review modes.
   *
   * `relations` is the CURRENT child relation graph. The review payload treats an
   * absent `relations` as "the server freezes its own read" and a present one
   * (even `[]`) as "replace with exactly this", so a container has to name its
   * children or the snapshot is incomplete, while a leaf type (connector) must
   * not send the field at all.
   *
   * MUST be backed by a single detail read. Splitting this into per-half loaders
   * lets a write land between them and freezes content from one revision with
   * relations from another — bytes that were never live together, which nothing
   * downstream detects. See `loadExpertReviewSnapshot`.
   *
   * Absent entirely for a FIRST listing (the row is a private draft the server
   * can freeze as-is) and for leaf connectors (which upgrade through
   * McpCreateModal's review mode instead).
   */
  loadSnapshot?: () => Promise<{
    content?: { manifestJson: unknown; pluginJson: unknown };
    relations?: PluginReviewRelation[];
  }>;
  /**
   * Which halves this submission must carry. Drives the fail-closed gate, and has
   * to be known BEFORE the read resolves, so it cannot be inferred from the
   * snapshot itself.
   */
  needs?: { content?: boolean; relations?: boolean };
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
 *     own frozen content via `target.loadSnapshot` — the same single read that
 *     resolves the child relations — and echoes it: the backend refuses a
 *     contentless submission on an already-listed plugin, so the client submits
 *     the current bytes without disturbing the live row until approval.
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
  // Both reads and writes belong to one target/Space session, even when the
  // same target object is reopened after leaving it. Invalidate on every scope
  // change so stale success, failure and finally handlers cannot touch it.
  const generationRef = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    const handleSpaceChanged = () => {
      generationRef.current++;
      submittingRef.current = false;
      setSubmitting(false);
      setError(null);
      setRelations(undefined);
      setContent(undefined);
      setResolveError(null);
      setResolving(false);
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      generationRef.current++;
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, []);

  const needsRelations = Boolean(target?.needs?.relations);
  const needsContent = Boolean(target?.needs?.content);

  const resolveTarget = useCallback((item: ReviewSubmitTarget) => {
    const generation = ++generationRef.current;
    if (!item.loadSnapshot) {
      setRelations(undefined);
      setContent(undefined);
      setResolveError(null);
      setResolving(false);
      return;
    }
    setResolving(true);
    setResolveError(null);
    // ONE read backs both halves, so the frozen content and the frozen relation
    // graph are always the same revision of the record.
    item
      .loadSnapshot()
      .then((snapshot) => {
        if (generation !== generationRef.current) return;
        setRelations(snapshot.relations);
        setContent(snapshot.content);
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current) return;
        // Fail CLOSED. Submitting without relations would silently fall back to
        // "the server freezes its own read", producing exactly the incomplete
        // snapshot this resolution exists to prevent; submitting `[]` would wipe
        // the children on approve; submitting without content 400s on a listed
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
  useLayoutEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    setError(null);
    if (!target) {
      generationRef.current++;
      setRelations(undefined);
      setContent(undefined);
      setResolveError(null);
      setResolving(false);
    } else {
      setVersion(bumpPatch(target.version));
      setChangelog(target.initialChangelog ?? "");
      resolveTarget(target);
    }
    // Layout cleanup also covers replacement/unmount before passive effects
    // run, including a replacement triggered synchronously by onSubmitted.
    return () => {
      generationRef.current++;
      submittingRef.current = false;
    };
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
    if (!target || submittingRef.current) return;
    const generation = generationRef.current;
    const isCurrentSession = () => generation === generationRef.current;
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
    submittingRef.current = true;
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
      if (!isCurrentSession()) return;
      onSubmitted(t("skillMarket.review.submittedToast"));
      if (!isCurrentSession()) return;
      onClose();
    } catch (err) {
      if (!isCurrentSession()) return;
      setError(
        err instanceof Error ? err.message : t("skillMarket.review.submitFailed")
      );
    } finally {
      if (isCurrentSession()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  function cancel() {
    if (submittingRef.current) return;
    generationRef.current++;
    onClose();
  }

  return (
    <WKModal
      visible={Boolean(target)}
      onCancel={cancel}
      options={{
        closable: !submitting,
        maskClosable: !submitting,
        closeOnEsc: !submitting,
      }}
      title={
        target?.isUpgrade
          ? t("skillMarket.plugin.actionUpgrade")
          : t("skillMarket.plugin.actionPublish")
      }
      footer={
        <>
          <WKButton variant="secondary" onClick={cancel} disabled={submitting}>
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
