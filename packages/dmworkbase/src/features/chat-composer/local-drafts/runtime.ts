import type {
  ChatComposerAttachmentDraftPort,
  LocalAttachmentDraftChannel,
  LocalAttachmentDraftHost,
  RestoredLocalAttachmentDraft,
} from "./contract";

type AttachmentPhase =
  | "restoring"
  | "staging"
  | "ready"
  | "failed"
  | "restore-failed"
  | "sending"
  | "removing";

interface AttachmentState {
  phase: AttachmentPhase;
  live: boolean;
  persisted: boolean;
  writePending: boolean;
  removeAfterWrite: boolean;
  generation: number;
}

interface SendOwnership {
  token: symbol;
  generation: number;
}

interface ChannelRuntime {
  generations: Map<string, number>;
  cancelled: Map<string, number>;
  consumed: Map<string, number>;
  sending: Map<string, SendOwnership>;
  mutations: Map<string, Promise<void>>;
}

interface HostRuntime {
  channels: Map<string, ChannelRuntime>;
}

interface HostInstallation {
  host: LocalAttachmentDraftHost;
  active: boolean;
  revision: number;
  runtime: HostRuntime;
}

const hostInstallations: HostInstallation[] = [];

function channelKey(channel: LocalAttachmentDraftChannel): string {
  return `${channel.type}:${channel.id}`;
}

function channelRuntime(
  runtime: HostRuntime,
  channel: LocalAttachmentDraftChannel
): ChannelRuntime {
  const key = channelKey(channel);
  let value = runtime.channels.get(key);
  if (!value) {
    value = {
      generations: new Map(),
      cancelled: new Map(),
      consumed: new Map(),
      sending: new Map(),
      mutations: new Map(),
    };
    runtime.channels.set(key, value);
  }
  return value;
}

function ensureGeneration(
  runtime: ChannelRuntime,
  attachmentId: string
): number {
  const current = runtime.generations.get(attachmentId);
  if (current !== undefined) return current;
  runtime.generations.set(attachmentId, 1);
  return 1;
}

function nextGeneration(runtime: ChannelRuntime, attachmentId: string): number {
  const generation = (runtime.generations.get(attachmentId) ?? 0) + 1;
  runtime.generations.set(attachmentId, generation);
  return generation;
}

function isCurrentGeneration(
  runtime: ChannelRuntime,
  attachmentId: string,
  generation: number
): boolean {
  return runtime.generations.get(attachmentId) === generation;
}

function cancelGeneration(
  runtime: ChannelRuntime,
  attachmentId: string,
  generation: number
): void {
  runtime.cancelled.set(
    attachmentId,
    Math.max(runtime.cancelled.get(attachmentId) ?? 0, generation)
  );
}

function isCancelled(
  runtime: ChannelRuntime,
  attachmentId: string,
  generation: number
): boolean {
  return (runtime.cancelled.get(attachmentId) ?? 0) >= generation;
}

function isSendOwned(
  runtime: ChannelRuntime,
  attachmentId: string,
  generation: number
): boolean {
  return runtime.sending.get(attachmentId)?.generation === generation;
}

function isOwnedOrConsumed(
  runtime: ChannelRuntime,
  attachmentId: string,
  generation: number
): boolean {
  return (
    isSendOwned(runtime, attachmentId, generation) ||
    (runtime.consumed.get(attachmentId) ?? 0) >= generation
  );
}

function enqueueMutation<T>(
  runtime: ChannelRuntime,
  attachmentId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = runtime.mutations.get(attachmentId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  runtime.mutations.set(attachmentId, tail);
  void tail.then(() => {
    if (runtime.mutations.get(attachmentId) === tail) {
      runtime.mutations.delete(attachmentId);
    }
  });
  return result;
}

function installedHost(): HostInstallation | undefined {
  for (let index = hostInstallations.length - 1; index >= 0; index -= 1) {
    const installation = hostInstallations[index];
    if (installation.active) return installation;
  }
  return undefined;
}

export function installLocalAttachmentDraftHost(
  host: LocalAttachmentDraftHost
): () => void {
  const installation: HostInstallation = {
    host,
    active: true,
    revision: 0,
    runtime: { channels: new Map() },
  };
  hostInstallations.push(installation);
  return () => {
    installation.active = false;
    while (
      hostInstallations.length > 0 &&
      !hostInstallations[hostInstallations.length - 1].active
    ) {
      hostInstallations.pop();
    }
  };
}

export function invalidateLocalAttachmentDraftHost(
  host: LocalAttachmentDraftHost
): void {
  for (const installation of hostInstallations) {
    if (installation.active && installation.host === host) {
      installation.revision += 1;
    }
  }
}

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

class AttachmentDraftMetadataError extends Error {}
class AttachmentDraftCorruptionError extends Error {}

export function createChatComposerAttachmentDraftPort(
  channel: LocalAttachmentDraftChannel
): ChatComposerAttachmentDraftPort | undefined {
  const installation = installedHost();
  if (!installation || installation.host.version !== 1) return undefined;
  const host = installation.host;
  const hostRevision = installation.revision;
  const shared = channelRuntime(installation.runtime, channel);
  const isActive = () =>
    installation.active && installation.revision === hostRevision;
  const states = new Map<string, AttachmentState>();
  const ownedSends = new Map<string, symbol>();
  const restoreMetadataBarriers = new Set<Promise<void>>();
  let nextPosition = 0;
  let restoreInFlight = 0;

  const remove = (
    attachmentId: string,
    generation: number
  ): Promise<boolean> => {
    const state = states.get(attachmentId);
    if (state?.generation === generation) {
      state.phase = "removing";
      state.live = false;
    }
    const removal = enqueueMutation(shared, attachmentId, async () => {
      if (!isCurrentGeneration(shared, attachmentId, generation)) return false;
      await host.remove({ channel, attachmentId });
      return true;
    });
    void removal.then(
      () => {
        if (states.get(attachmentId)?.generation === generation) {
          states.delete(attachmentId);
        }
      },
      (error) => {
        const current = states.get(attachmentId);
        if (current?.generation === generation) {
          current.phase = current.persisted ? "ready" : "failed";
        }
        console.warn("[attachment-drafts] remove failed", error);
      }
    );
    return removal;
  };

  return {
    async restore() {
      if (!isActive()) return { attachments: [], failedCount: 0 };
      let releaseMetadata = () => {};
      const metadataBarrier = new Promise<void>((resolve) => {
        releaseMetadata = resolve;
      });
      restoreMetadataBarriers.add(metadataBarrier);
      void metadataBarrier.finally(() => {
        restoreMetadataBarriers.delete(metadataBarrier);
      });
      restoreInFlight += 1;
      const restored: RestoredLocalAttachmentDraft[] = [];
      let failedCount = 0;
      try {
        const metadata = await host.list({ channel });
        if (!isActive()) return { attachments: [], failedCount };
        for (const attachment of metadata) {
          if (Number.isFinite(attachment.position)) {
            nextPosition = Math.max(nextPosition, attachment.position + 1);
          }
          const generation = ensureGeneration(shared, attachment.id);
          if (
            states.has(attachment.id) ||
            isOwnedOrConsumed(shared, attachment.id, generation)
          ) {
            continue;
          }
          states.set(attachment.id, {
            phase: "restoring",
            live: false,
            persisted: true,
            writePending: false,
            removeAfterWrite: false,
            generation,
          });
        }
        releaseMetadata();
        for (const attachment of metadata) {
          if (!isActive()) break;
          const current = states.get(attachment.id);
          if (!current || current.phase !== "restoring") continue;
          const generation = current.generation;
          if (
            !isCurrentGeneration(shared, attachment.id, generation) ||
            isOwnedOrConsumed(shared, attachment.id, generation)
          ) {
            continue;
          }
          try {
            const result = await host.read({
              channel,
              attachmentId: attachment.id,
            });
            if (
              !isActive() ||
              !isCurrentGeneration(shared, attachment.id, generation) ||
              isOwnedOrConsumed(shared, attachment.id, generation)
            ) {
              continue;
            }
            if (
              result.attachment.id !== attachment.id ||
              result.attachment.size !== attachment.size
            ) {
              throw new AttachmentDraftMetadataError(
                "Attachment draft metadata changed during restore"
              );
            }
            const content = bytes(result.bytes);
            if (content.byteLength !== attachment.size) {
              throw new AttachmentDraftCorruptionError(
                "Attachment draft byte length mismatch"
              );
            }
            const state = states.get(attachment.id);
            if (
              !state ||
              state.phase !== "restoring" ||
              state.generation !== generation
            ) {
              continue;
            }
            restored.push({
              id: attachment.id,
              source: attachment.source,
              position: Number.isFinite(attachment.position)
                ? attachment.position
                : undefined,
              file: new File([content], attachment.name, {
                type: attachment.mimeType,
                lastModified: attachment.lastModified,
              }),
            });
          } catch (error) {
            failedCount += 1;
            console.warn("[attachment-drafts] restore failed", error);
            if (error instanceof AttachmentDraftCorruptionError) {
              void remove(attachment.id, generation);
            } else {
              const state = states.get(attachment.id);
              if (state?.generation === generation) {
                state.phase = "restore-failed";
              }
            }
          }
        }
        const positionById = new Map(
          metadata.map((attachment) => [
            attachment.id,
            Number.isFinite(attachment.position) ? attachment.position : 0,
          ])
        );
        return {
          attachments: restored
            .filter(({ id }) => {
              const state = states.get(id);
              return (
                state !== undefined &&
                isCurrentGeneration(shared, id, state.generation) &&
                !isOwnedOrConsumed(shared, id, state.generation)
              );
            })
            .sort(
              (left, right) =>
                (positionById.get(left.id) ?? 0) -
                (positionById.get(right.id) ?? 0)
            ),
          failedCount,
        };
      } finally {
        releaseMetadata();
        restoreInFlight -= 1;
      }
    },

    async stage({ id, file, source }, position) {
      if (!isActive()) {
        states.set(id, {
          phase: "failed",
          live: true,
          persisted: false,
          writePending: false,
          removeAfterWrite: false,
          generation: shared.generations.get(id) ?? 0,
        });
        return false;
      }
      const existing = states.get(id);
      if (existing?.persisted) return true;
      const generation = nextGeneration(shared, id);
      const state: AttachmentState = {
        phase: "staging",
        live: true,
        persisted: false,
        writePending: true,
        removeAfterWrite: false,
        generation,
      };
      states.set(id, state);
      try {
        await Promise.all([...restoreMetadataBarriers]);
        if (!isActive() || states.get(id) !== state) return false;
        const requestedPosition =
          position !== undefined && Number.isFinite(position)
            ? position
            : nextPosition++;
        nextPosition = Math.max(nextPosition, requestedPosition + 1);
        const content = await file.arrayBuffer();
        if (!isActive() || states.get(id) !== state) return false;
        const staged = await enqueueMutation(shared, id, async () => {
          if (
            !isCurrentGeneration(shared, id, generation) ||
            isCancelled(shared, id, generation)
          ) {
            return undefined;
          }
          return host.stage({
            channel,
            attachment: {
              id,
              position: requestedPosition,
              name: file.name,
              mimeType: file.type,
              size: file.size,
              lastModified: file.lastModified,
              source,
            },
            bytes: content,
          });
        });
        state.writePending = false;
        if (!staged) {
          if (states.get(id) === state && isCancelled(shared, id, generation)) {
            states.delete(id);
            return true;
          }
          return false;
        }
        if (Number.isFinite(staged.position)) {
          nextPosition = Math.max(nextPosition, staged.position + 1);
        }
        if (
          states.get(id) !== state ||
          !isCurrentGeneration(shared, id, generation)
        ) {
          if (isCancelled(shared, id, generation)) {
            await remove(id, generation);
          }
          return true;
        }
        state.persisted = true;
        if (!isActive() && state.phase !== "sending") {
          state.removeAfterWrite = true;
          await remove(id, generation);
          return false;
        }
        if (
          state.removeAfterWrite ||
          (!state.live && state.phase !== "sending")
        ) {
          const pendingRemoval = shared.mutations.get(id);
          if (pendingRemoval) await pendingRemoval;
          if (
            states.get(id) === state &&
            state.removeAfterWrite &&
            state.phase !== "removing"
          ) {
            await remove(id, generation);
          }
          return true;
        }
        if (state.phase !== "sending") state.phase = "ready";
        return true;
      } catch (error) {
        state.writePending = false;
        if (states.get(id) === state) {
          state.phase = "failed";
          state.persisted = false;
        }
        console.warn("[attachment-drafts] stage failed", error);
        return false;
      }
    },

    syncLive(attachmentIds) {
      if (!isActive()) return;
      const live = new Set(attachmentIds);
      for (const [id, state] of states) {
        state.live = live.has(id);
        if (restoreInFlight > 0 && state.persisted) continue;
        if (state.phase === "restoring" && state.live) state.phase = "ready";
        if (
          state.live ||
          state.phase === "restore-failed" ||
          state.phase === "sending" ||
          state.phase === "removing"
        ) {
          continue;
        }
        if (state.phase === "staging") {
          cancelGeneration(shared, id, state.generation);
          state.removeAfterWrite = true;
          continue;
        }
        if (state.phase === "failed") {
          if (isSendOwned(shared, id, state.generation)) continue;
          states.delete(id);
          continue;
        }
        void remove(id, state.generation);
      }
    },

    discardUnready(attachmentIds) {
      for (const id of attachmentIds) {
        const state = states.get(id);
        if (
          !state ||
          state.phase === "ready" ||
          state.phase === "sending" ||
          state.phase === "removing" ||
          state.persisted
        ) {
          continue;
        }
        state.live = false;
        if (state.phase === "failed") {
          states.delete(id);
          continue;
        }
        state.removeAfterWrite = true;
        cancelGeneration(shared, id, state.generation);
      }
    },

    beginSend(attachmentIds) {
      if (!isActive()) return;
      for (const id of attachmentIds) {
        const state = states.get(id);
        const generation = state?.generation ?? ensureGeneration(shared, id);
        const token = Symbol(id);
        shared.sending.set(id, { token, generation });
        ownedSends.set(id, token);
        if (state) state.phase = "sending";
      }
    },

    settleSend({ attachmentIds, keepAttachmentIds }) {
      const keep = new Set(keepAttachmentIds);
      for (const id of attachmentIds) {
        const token = ownedSends.get(id);
        const ownership = shared.sending.get(id);
        if (!token || ownership?.token !== token) continue;
        const { generation } = ownership;
        const releaseOwnership = () => {
          if (shared.sending.get(id)?.token === token) {
            shared.sending.delete(id);
          }
          if (ownedSends.get(id) === token) ownedSends.delete(id);
        };
        const state = states.get(id);
        if (keep.has(id)) {
          releaseOwnership();
          if (state?.generation === generation) {
            state.live = true;
            state.removeAfterWrite = false;
            state.phase = state.persisted
              ? "ready"
              : state.writePending
              ? "staging"
              : "failed";
          }
          continue;
        }
        if (state?.generation === generation && state.writePending) {
          state.removeAfterWrite = true;
        }
        const finishSettlement = () => {
          shared.consumed.set(
            id,
            Math.max(shared.consumed.get(id) ?? 0, generation)
          );
          releaseOwnership();
        };
        void remove(id, generation).then(
          finishSettlement,
          finishSettlement
        );
      }
    },

    canLeave(attachmentIds) {
      return attachmentIds.every((id) => {
        const state = states.get(id);
        return (
          state === undefined ||
          (state.phase === "restoring" && state.persisted) ||
          (state.phase === "ready" && state.persisted)
        );
      });
    },
  };
}
