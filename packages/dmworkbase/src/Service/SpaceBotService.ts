import APIClient from "./APIClient";

/** One `/robot/space_bots` entry the forward Bot expander reads. */
export interface SpaceBotSnapshot {
  uid: string;
  name?: string;
  creator_uid?: string;
}

// IN-FLIGHT-ONLY dedup so the ForwardModal person-row preview and the 授权区 selected-target
// snapshot share ONE concurrent catalog request (feature: user+Bot grants, UX #4) WITHOUT caching a
// resolved result. Caching a success permanently would let a reopened modal preview/grant a stale
// catalog (Bots added / removed / reassigned since); production never invalidates. So the shared
// promise is dropped the instant it settles (success OR failure) in a `finally`: simultaneous
// callers dedupe onto the same request, but every later open / authoritative re-resolution starts a
// fresh fetch and sees the current catalog. Failures are naturally not retained, so retry re-fetches.
const inflight = new Map<string, Promise<SpaceBotSnapshot[]>>();

async function fetchSpaceBots(spaceId: string): Promise<SpaceBotSnapshot[]> {
  const data = await APIClient.shared.get<SpaceBotSnapshot[]>("/robot/space_bots", {
    param: { space_id: spaceId },
  });
  // Validate the shape: keep only array entries carrying a uid; anything else → [].
  return Array.isArray(data)
    ? data.filter((b): b is SpaceBotSnapshot => !!b && typeof b.uid === "string" && !!b.uid)
    : [];
}

/**
 * Space-wide Bot roster (`GET /robot/space_bots?space_id=`) — the source both the 授权区 Bot
 * expander (grouped by creator) and the ItemRow person-row preview read. Not viewer-scoped, so it
 * surfaces every Bot in the Space.
 */
const SpaceBotService = {
  /** Fetch the space Bot catalog directly (no dedup) — kept for callers that want a fresh read. */
  async list(spaceId: string): Promise<SpaceBotSnapshot[]> {
    if (!spaceId) return [];
    return fetchSpaceBots(spaceId);
  },

  /**
   * Shared catalog read for preview + snapshot resolution. Concurrent callers for the same space
   * share ONE in-flight request; once it settles the shared promise is released, so a later call
   * (a reopened modal, an authoritative re-resolution) issues a fresh fetch and sees the current
   * catalog — no stale result is ever cached. Fail-closed: a rejection is not retained, so a retry
   * re-fetches. This is a request-lifetime dedup, NOT a result cache.
   */
  listShared(spaceId: string): Promise<SpaceBotSnapshot[]> {
    if (!spaceId) return Promise.resolve([]);
    const hit = inflight.get(spaceId);
    if (hit) return hit;
    const p = fetchSpaceBots(spaceId).finally(() => {
      // Release only if this is still the current in-flight promise (guards a same-tick re-entry).
      if (inflight.get(spaceId) === p) inflight.delete(spaceId);
    });
    inflight.set(spaceId, p);
    return p;
  },
};

export default SpaceBotService;
