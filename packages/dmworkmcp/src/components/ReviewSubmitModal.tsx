import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextArea, Toast } from "@douyinfe/semi-ui";
import { isValidVersion, isVersionForward, versionErrorKey, upgradeVersionErrorKey } from "@dmwork/skillmarket";
import { t, useI18n, WKApp, WKButton, WKInput, WKModal } from "@octo/base";
import {
  submitPluginReview,
  type PluginReviewRelation,
} from "../api/pluginReview";

import ExpertBotPublishModal from "./ExpertBotPublishModal";

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
  /** Expert/team upgrade content is authored through the existing Bot prompt. */
  editKind?: "agent" | "squad";
  /** Prefilled changelog — used by 重新提交 to carry the rejected attempt's text. */
  initialChangelog?: string;
  /**
   * Resolve everything the submission must freeze, in ONE read.
   *
   * Expert/team upgrades load the owner's saved draft documents and relations,
   * never the catalog release. Explicit content freezes exactly that response.
   *
   * `relations` is the editable draft relation graph. The review payload treats an
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
    /** Editable draft label; may be ahead of the catalog release. */
    version?: string;
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
  /** Refresh owner state after returning from the Bot publishing workflow. */
  onBotReturn?: () => void;
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
 *   - an expert/team upgrade freezes saved draft content and exact pins from
 *     target.loadSnapshot. The old release remains live until approval.
 */
export default function ReviewSubmitModal({
  target,
  onClose,
  onSubmitted,
  onBotReturn,
}: ReviewSubmitModalProps) {
  useI18n();
  const [editingWithBot, setEditingWithBot] = useState(false);
  const [version, setVersion] = useState("");
  const [draftVersion, setDraftVersion] = useState<string>();
  const versionEditedRef = useRef(false);
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
      setEditingWithBot(false);
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
        setDraftVersion(snapshot.version);
        // Refresh content and pins without replacing a version the user chose,
        // including input typed while this asynchronous read was pending.
        if (snapshot.version && !versionEditedRef.current) {
          const draftIsNew = !item.isUpgrade || !isValidVersion(item.version ?? "") ||
            isVersionForward(bumpPatch(item.version), snapshot.version);
          setVersion(!versionErrorKey(item.version, snapshot.version) && draftIsNew
            ? snapshot.version
            : bumpPatch(item.version));
        }
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
    setEditingWithBot(false);
    versionEditedRef.current = false;
    setDraftVersion(undefined);
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
  const versionError = (target?.isUpgrade
    ? upgradeVersionErrorKey(target.version, version)
    : versionErrorKey(target?.version, version)) ||
    (target?.isUpgrade ? versionErrorKey(draftVersion, version) : null);
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
        // Freeze the draft snapshot previewed by this session. Never substitute
        // catalog content or silently omit failed relation reads.
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

  // Bot updates now submit publication themselves. Returning closes this
  // stale upgrade form and refreshes owner state without claiming success.
  if (editingWithBot && target?.isUpgrade && target.editKind) {
    const botGeneration = generationRef.current;
    return <ExpertBotPublishModal
      visible
      kind={target.editKind}
      mode="update"
      editingId={target.pluginId}
      onClose={() => {
        // A dismissed Bot may finish forwarding after another form has opened.
        if (generationRef.current !== botGeneration) return;
        generationRef.current++;
        setEditingWithBot(false);
        onBotReturn?.();
        if (generationRef.current === botGeneration + 1) onClose();
      }}
      onToast={message => Toast.success(message)}
    />;
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
        {target?.isUpgrade && target.editKind && (
          <div className="wk-mcp-review-submit__field">
            <p>{t("mcp.review.draftEditHint")}</p>
            <WKButton variant="secondary" disabled={submitting} onClick={() => setEditingWithBot(true)}>
              {t(target.editKind === "squad" ? "mcp.expert.botUpdateTitle" : "mcp.expert.botUpdateTitleAgent")}
            </WKButton>
            <WKButton variant="secondary" disabled={submitting || resolving} onClick={() => resolveTarget(target)}>
              {t("mcp.review.refreshDraft")}
            </WKButton>
          </div>
        )}
        <label className="wk-mcp-review-submit__field">
          <span>{t("skillMarket.review.fieldVersion")}</span>
          <WKInput value={version} onChange={(value) => { versionEditedRef.current = true; setVersion(value); }} maxLength={32} />
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
