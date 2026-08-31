import type { ImSubscriberLike } from "../../../im-runtime/channelRuntime"
import { mentionUidStateFromRobot } from "../../../Utils/mentionRender"

export interface ForwardSubscriberLike extends ImSubscriberLike {
  uid?: string
  orgData?: {
    robot?: unknown
    real_name?: string | null
    realname_verified?: boolean | number | string | null
    [key: string]: unknown
  } | null
}

export interface ForwardSubscriberPartition<T extends ForwardSubscriberLike> {
  humans: T[]
  bots: T[]
  unknown: T[]
}

/**
 * Classify a group-member snapshot for grant purposes.
 *
 * A positive Bot signal always wins: subscriber metadata can be stale while the
 * Space Bot roster is authoritative for every Bot it does contain. Absence from
 * that roster is not proof of being human, so missing/invalid `robot` metadata
 * remains `unknown` and grant-critical callers can fail closed.
 *
 * Duplicate rows are collapsed by uid with the precedence bot > human > unknown.
 */
export function partitionForwardSubscribers<T extends ForwardSubscriberLike>(
  subscribers: readonly T[],
  knownBotUids: ReadonlySet<string> = new Set<string>(),
): ForwardSubscriberPartition<T> {
  const byUid = new Map<string, { member: T; kind: "human" | "bot" | "unknown" }>()

  for (const member of subscribers) {
    const uid = typeof member?.uid === "string" ? member.uid : ""
    if (!uid) continue

    const robotState = mentionUidStateFromRobot(member.orgData?.robot)
    const kind = knownBotUids.has(uid) || robotState === "bot"
      ? "bot"
      : robotState === "user"
        ? "human"
        : "unknown"
    const previous = byUid.get(uid)
    if (
      !previous ||
      kind === "bot" ||
      (kind === "human" && previous.kind === "unknown")
    ) {
      byUid.set(uid, { member, kind })
    }
  }

  const humans: T[] = []
  const bots: T[] = []
  const unknown: T[] = []
  for (const { member, kind } of byUid.values()) {
    if (kind === "bot") bots.push(member)
    else if (kind === "human") humans.push(member)
    else unknown.push(member)
  }
  return { humans, bots, unknown }
}
