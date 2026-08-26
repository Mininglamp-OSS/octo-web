// Wire and render sentinels shared by composer parsing, clipboard guards, and
// message rendering. Keep this module dependency-free: it is a protocol layer.
export const MENTION_UID_LEGACY_ALL = "-1";
export const MENTION_UID_HUMANS = "-2";
export const MENTION_UID_AIS = "-3";
export const MENTION_LABEL_HUMANS = "所有人";
export const MENTION_LABEL_AIS = "所有AI";
export const MENTION_UID_RENDER_ALL = "all";

export function isBroadcastSentinelUid(uid: string): boolean {
  return (
    uid === MENTION_UID_LEGACY_ALL ||
    uid === MENTION_UID_HUMANS ||
    uid === MENTION_UID_AIS ||
    uid === MENTION_UID_RENDER_ALL
  );
}

// Internal marker for a broadcast mention that originated from a sanctioned
// editor node. It is stripped before draft persistence and wire encoding.
export const MENTION_TRUST_MARK = "\u0000";
