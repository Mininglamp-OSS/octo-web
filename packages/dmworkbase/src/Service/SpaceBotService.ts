import APIClient from "./APIClient";

/** One `/robot/space_bots` entry the forward Bot expander reads. */
export interface SpaceBotSnapshot {
  uid: string;
  name?: string;
  creator_uid?: string;
}

/**
 * Space-wide Bot roster (`GET /robot/space_bots?space_id=`) — the source the 授权区 Bot expander
 * groups by creator. Not viewer-scoped, so it surfaces every Bot in the Space.
 */
const SpaceBotService = {
  async list(spaceId: string): Promise<SpaceBotSnapshot[]> {
    if (!spaceId) return [];
    const data = await APIClient.shared.get<SpaceBotSnapshot[]>("/robot/space_bots", {
      param: { space_id: spaceId },
    });
    // Validate the shape: keep only array entries carrying a uid; anything else → [].
    return Array.isArray(data)
      ? data.filter((b): b is SpaceBotSnapshot => !!b && typeof b.uid === "string" && !!b.uid)
      : [];
  },
};

export default SpaceBotService;
