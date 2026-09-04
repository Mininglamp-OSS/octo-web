// Space review (组织审核) for the connector / 专家 / 专家团 markets.
//
// The review endpoints (`POST /plugins/review_requests`, `.../cancel`, the
// `mode=mine` list) are plugin-type agnostic and already implemented in
// @dmwork/skillmarket. This module is the ONLY place in dmworkmcp that reaches
// across to them, mirroring how MarketSidebar keeps its `useSpaceRole` /
// `useReviewRequests` coupling to the single named exports of that package.
//
// It is deliberately NOT folded into mcpService / expertService: those two
// modules are covered by unit suites that mock only `axios` + `@octo/base`, and
// pulling the skillmarket package graph into them would break those suites at
// import time. Keep this file free of anything they import.
import {
  cancelReview,
  createReviewRequest,
  delistPlugin,
  publishPlugin,
  pluginConflictReason,
  pluginRequiredRole,
  type PluginConflictReason,
  type PluginListingResult,
  type ReviewRelationInput,
} from "@dmwork/skillmarket";

/** One frozen child relation. Structurally identical to skillmarket's
 *  `ReviewRelationInput`; re-exported under a local name so the api modules in
 *  this package (expertService) can produce the shape without importing across
 *  packages. */
export type PluginReviewRelation = ReviewRelationInput;

export interface SubmitPluginReviewInput {
  pluginId: string;
  /** Version label of the submission. */
  version: string;
  changelog: string;
  /**
   * Frozen content. Omit BOTH for a first listing: the plugin row is still a
   * private draft nobody else can see, so the row *is* the thing under review
   * and the server freezes it. Supply both for an upgrade of an already-listed
   * plugin, where the live row is what already shipped.
   */
  manifestJson?: unknown;
  pluginJson?: unknown;
  /**
   * Child relation graph to freeze with the submission.
   *
   * Backend semantics are three-valued, so this field must be passed with care:
   *   - absent / `undefined` → inherit whatever the live relation graph is at
   *     approval time,
   *   - present (INCLUDING `[]`) → replace the graph with exactly this list.
   *
   * Container types (专家 / 专家团) must therefore always pass their CURRENT child
   * set explicitly — an expert whose skills are only inherited would approve
   * into whatever the graph happens to be later, not what the reviewer saw.
   * A leaf type (connector) passes nothing.
   */
  relations?: PluginReviewRelation[];
}

/** Submit a plugin for Space review. Rejects with the server message on 409
 *  (a request is already pending, or the version label is already published)
 *  and on 404 (the caller does not own the plugin / cross-Space). */
export async function submitPluginReview(
  input: SubmitPluginReviewInput
): Promise<void> {
  await createReviewRequest({
    pluginId: input.pluginId,
    version: input.version,
    changelog: input.changelog,
    ...(input.manifestJson !== undefined
      ? { manifestJson: input.manifestJson }
      : {}),
    ...(input.pluginJson !== undefined ? { pluginJson: input.pluginJson } : {}),
    // Spread-guarded rather than assigned: `relations: undefined` would still be
    // an own property, and "inherit" vs "replace with []" is a real distinction
    // on the wire.
    ...(input.relations !== undefined ? { relations: input.relations } : {}),
  });
}

/** Withdraw the caller's own pending request. */
export function cancelPluginReview(reviewId: string): Promise<void> {
  return cancelReview(reviewId);
}

// ─── 发布 / 下架 ────────────────────────────────────────────────────────────
//
// One door for both outcomes. The connector / 专家 / 专家团 pages must NOT inspect
// the plugin's visibility and then choose between "上架" and "提交审核": the
// backend makes that call and reports which one happened in the response. A
// private plugin is listed on the spot; a space plugin gets a review request and
// stays a draft until an admin approves it.
//
// Nothing about the plugin's CONTENT travels with these calls — the row was
// already written by the editor's save, and every save is a version snapshot
// server-side. (An upgrade of an already-listed plugin is the one case that does
// carry content, and that goes through `submitPluginReview` above, which freezes
// the new bytes without disturbing the live row.)

/** Re-exported so pages can name the result without importing across packages
 *  themselves — the same reason `PluginReviewRelation` is aliased above. */
export type PluginListingOutcome = PluginListingResult;
export type PluginListingConflict = PluginConflictReason;

export interface PublishPluginOptions {
  /** Version label for this listing; the server reuses the current one when
   *  omitted. */
  version?: string;
  /** Note for the reviewer. Only meaningful when the publish opens a review. */
  changelog?: string;
}

/**
 * Publish a plugin. Resolves with the new listing state; a `reviewId` on the
 * result means the call opened a review request instead of listing immediately,
 * which is what the UI should branch on rather than on a locally-guessed
 * visibility.
 *
 * Rejects on 409 (`already_published` / `review_pending` — read with
 * `pluginListingConflict`) and on 404 when the caller does not own the plugin.
 * There is deliberately no 403 here: a non-owner is told the plugin does not
 * exist rather than that it is not theirs.
 */
export function publishPluginListing(
  pluginId: string,
  options: PublishPluginOptions = {}
): Promise<PluginListingOutcome> {
  return publishPlugin({
    pluginId,
    // Spread-guarded: an own `version: undefined` property would serialize away
    // anyway, but keeping the body minimal makes the request log readable and
    // matches how submitPluginReview treats its optional fields.
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.changelog !== undefined ? { changelog: options.changelog } : {}),
  });
}

/**
 * Take a published plugin off the shelf. Space-admin only — and unlike publish,
 * this is normally aimed at somebody else's plugin, so it answers 403 with the
 * missing role (`pluginListingRequiredRole`) rather than hiding behind a 404.
 * 409 `not_published` means it is already down; refresh instead of erroring.
 */
export function delistPluginListing(
  pluginId: string,
  reason?: string
): Promise<PluginListingOutcome> {
  return delistPlugin({
    pluginId,
    ...(reason !== undefined ? { reason } : {}),
  });
}

/** Machine-readable refusal reason of a rejected publish/delist, so a page can
 *  pick its own copy per case instead of echoing a server message. */
export function pluginListingConflict(
  err: unknown
): PluginListingConflict | undefined {
  return pluginConflictReason(err);
}

/** Role the caller is missing on a 403 from delist (`space_admin` today). */
export function pluginListingRequiredRole(err: unknown): string | undefined {
  return pluginRequiredRole(err);
}
