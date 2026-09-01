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
