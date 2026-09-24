export type SpaceUnreadMap = Readonly<Record<string, number>>;

export interface SpaceMembershipSnapshot {
  channel_id: string;
  space_id?: string;
  my_source_space_id?: string;
}

export interface SpaceUnreadSnapshot {
  totalBySpace: SpaceUnreadMap;
  newBySpace: SpaceUnreadMap;
  revision: number;
}

type Listener = () => void;

const EMPTY: SpaceUnreadSnapshot = {
  totalBySpace: Object.freeze({}),
  newBySpace: Object.freeze({}),
  revision: 0,
};

function normalizeCounts(counts: Record<string, number>): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [spaceId, raw] of Object.entries(counts || {})) {
    const count = Math.max(0, Math.floor(Number(raw)));
    if (spaceId && Number.isFinite(count) && count > 0) normalized[spaceId] = count;
  }
  return normalized;
}

function sameCounts(left: SpaceUnreadMap, right: SpaceUnreadMap): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

/** Web-only in-memory state for organization-level unread badges. */
export class SpaceUnreadStore {
  private snapshot: SpaceUnreadSnapshot = EMPTY;
  private listeners = new Set<Listener>();
  private authorityRevision = 0;
  private resetRevision = 0;
  private readonly lastLocalMutationBySpace = new Map<string, number>();
  private groupSpaceByChannelId = new Map<string, string>();
  private readonly seenMessageIds = new Set<string>();
  private readonly seenMessageQueue: string[] = [];

  constructor(private readonly messageIdCapacity = 512) {}

  getSnapshot = (): SpaceUnreadSnapshot => this.snapshot;

  getAuthorityRevision(): number {
    return this.authorityRevision;
  }

  getGroupSpaceId(channelId: string): string | undefined {
    return this.groupSpaceByChannelId.get(channelId);
  }

  replaceMemberships(memberships: readonly SpaceMembershipSnapshot[]): void {
    const next = new Map<string, string>();
    for (const membership of memberships) {
      const channelId = membership?.channel_id;
      const effectiveSpaceId = membership?.my_source_space_id || membership?.space_id;
      if (channelId && effectiveSpaceId) next.set(channelId, effectiveSpaceId);
    }
    this.groupSpaceByChannelId = next;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  replaceTotals(counts: Record<string, number>, expectedAuthorityRevision?: number): boolean {
    if (
      expectedAuthorityRevision !== undefined &&
      expectedAuthorityRevision < this.resetRevision
    ) {
      return false;
    }
    const authoritativeTotals = normalizeCounts(counts);
    const totalBySpace: Record<string, number> = {};
    const newBySpace: Record<string, number> = {};
    const spaceIds = new Set([
      ...Object.keys(this.snapshot.totalBySpace),
      ...Object.keys(this.snapshot.newBySpace),
      ...Object.keys(authoritativeTotals),
    ]);

    // A local unread change only invalidates the matching Space. Applying the
    // rest of the snapshot avoids losing unrelated totals during live traffic.
    for (const spaceId of spaceIds) {
      const changedDuringRequest = expectedAuthorityRevision !== undefined &&
        (this.lastLocalMutationBySpace.get(spaceId) ?? 0) > expectedAuthorityRevision;
      // The response has no message watermark, so a raced value cannot be
      // ordered precisely. Keep the larger value to preserve both a cold
      // server backlog and locally observed messages until the next snapshot.
      const total = changedDuringRequest
        ? Math.max(
          this.snapshot.totalBySpace[spaceId] || 0,
          authoritativeTotals[spaceId] || 0,
        )
        : (authoritativeTotals[spaceId] || 0);
      if (total > 0) totalBySpace[spaceId] = total;

      const nextNew = Math.min(this.snapshot.newBySpace[spaceId] || 0, total);
      if (nextNew > 0) newBySpace[spaceId] = nextNew;
    }

    if (expectedAuthorityRevision !== undefined) {
      for (const [spaceId, revision] of this.lastLocalMutationBySpace) {
        if (revision <= expectedAuthorityRevision) this.lastLocalMutationBySpace.delete(spaceId);
      }
    }
    // Server snapshots do not advance the local-mutation revision. The sync
    // runtime already enforces request ownership before this method is called.
    this.publishIfChanged(totalBySpace, newBySpace);
    return true;
  }

  setTotal(spaceId: string, rawTotal: number): void {
    if (!spaceId) return;
    const total = Math.max(0, Math.floor(Number(rawTotal)));
    if (!Number.isFinite(total)) return;
    const totalBySpace = { ...this.snapshot.totalBySpace };
    if (total > 0) totalBySpace[spaceId] = total;
    else delete totalBySpace[spaceId];
    const newBySpace = { ...this.snapshot.newBySpace };
    const nextNew = Math.min(newBySpace[spaceId] || 0, total);
    if (nextNew > 0) newBySpace[spaceId] = nextNew;
    else delete newBySpace[spaceId];
    if (!sameCounts(totalBySpace, this.snapshot.totalBySpace)) this.markLocalMutation(spaceId);
    this.publishIfChanged(totalBySpace, newBySpace);
  }

  recordIncoming(spaceId: string, messageId: string): boolean {
    if (!spaceId || !messageId || this.seenMessageIds.has(messageId)) return false;
    this.rememberMessageId(messageId);
    const totalBySpace = { ...this.snapshot.totalBySpace };
    const newBySpace = { ...this.snapshot.newBySpace };
    totalBySpace[spaceId] = (totalBySpace[spaceId] || 0) + 1;
    newBySpace[spaceId] = Math.min((newBySpace[spaceId] || 0) + 1, totalBySpace[spaceId]);
    this.markLocalMutation(spaceId);
    this.publishIfChanged(totalBySpace, newBySpace);
    return true;
  }

  clearNewUnreads(): void {
    if (Object.keys(this.snapshot.newBySpace).length === 0) return;
    this.publishIfChanged({ ...this.snapshot.totalBySpace }, {});
  }

  reset(): void {
    this.resetRevision = ++this.authorityRevision;
    this.lastLocalMutationBySpace.clear();
    this.groupSpaceByChannelId.clear();
    this.seenMessageIds.clear();
    this.seenMessageQueue.length = 0;
    if (this.snapshot === EMPTY) return;
    this.snapshot = { ...EMPTY, revision: this.snapshot.revision + 1 };
    this.emit();
  }

  private rememberMessageId(messageId: string): void {
    this.seenMessageIds.add(messageId);
    this.seenMessageQueue.push(messageId);
    while (this.seenMessageQueue.length > this.messageIdCapacity) {
      const oldest = this.seenMessageQueue.shift();
      if (oldest) this.seenMessageIds.delete(oldest);
    }
  }

  private markLocalMutation(spaceId: string): void {
    const revision = ++this.authorityRevision;
    this.lastLocalMutationBySpace.set(spaceId, revision);
  }

  private publishIfChanged(totalBySpace: Record<string, number>, newBySpace: Record<string, number>): void {
    if (
      sameCounts(this.snapshot.totalBySpace, totalBySpace) &&
      sameCounts(this.snapshot.newBySpace, newBySpace)
    ) return;
    this.snapshot = {
      totalBySpace: Object.freeze(totalBySpace),
      newBySpace: Object.freeze(newBySpace),
      revision: this.snapshot.revision + 1,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

export const spaceUnreadStore = new SpaceUnreadStore();
