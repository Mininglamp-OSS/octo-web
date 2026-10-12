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
  | "sending";

interface AttachmentState {
  phase: AttachmentPhase;
  live: boolean;
  persisted: boolean;
  writePending: boolean;
  removeAfterWrite: boolean;
}

interface HostInstallation {
  host: LocalAttachmentDraftHost;
  active: boolean;
  revision: number;
}

const hostInstallations: HostInstallation[] = [];
const sendingByChannel = new Map<string, Set<string>>();

function channelKey(channel: LocalAttachmentDraftChannel): string {
  return `${channel.type}:${channel.id}`;
}

function sendingIds(channel: LocalAttachmentDraftChannel): Set<string> {
  const key = channelKey(channel);
  let ids = sendingByChannel.get(key);
  if (!ids) {
    ids = new Set();
    sendingByChannel.set(key, ids);
  }
  return ids;
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
  const installation: HostInstallation = { host, active: true, revision: 0 };
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
  sendingByChannel.clear();
}

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

class AttachmentDraftIntegrityError extends Error {}

export function createChatComposerAttachmentDraftPort(
  channel: LocalAttachmentDraftChannel
): ChatComposerAttachmentDraftPort | undefined {
  const installation = installedHost();
  if (!installation || installation.host.version !== 1) return undefined;
  const host = installation.host;
  const hostRevision = installation.revision;
  const isActive = () =>
    installation.active && installation.revision === hostRevision;
  const states = new Map<string, AttachmentState>();
  const restoreMetadataBarriers = new Set<Promise<void>>();
  let nextPosition = 0;
  let restoreInFlight = false;

  const remove = (attachmentId: string): void => {
    states.delete(attachmentId);
    void host.remove({ channel, attachmentId }).catch((error) => {
      console.warn("[attachment-drafts] remove failed", error);
    });
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
      restoreInFlight = true;
      const restored: RestoredLocalAttachmentDraft[] = [];
      let failedCount = 0;
      try {
        const metadata = await host.list({ channel });
        if (!isActive()) return { attachments: [], failedCount: 0 };
        for (const attachment of metadata) {
          nextPosition = Math.max(nextPosition, attachment.position + 1);
          if (
            states.has(attachment.id) ||
            sendingIds(channel).has(attachment.id)
          ) {
            continue;
          }
          states.set(attachment.id, {
            phase: "restoring",
            live: false,
            persisted: true,
            writePending: false,
            removeAfterWrite: false,
          });
        }
        releaseMetadata();
        for (const attachment of metadata) {
          const current = states.get(attachment.id);
          if (!current || current.phase !== "restoring") continue;
          if (sendingIds(channel).has(attachment.id)) continue;
          try {
            const result = await host.read({
              channel,
              attachmentId: attachment.id,
            });
            if (!isActive()) return { attachments: [], failedCount: 0 };
            if (
              result.attachment.id !== attachment.id ||
              result.attachment.size !== attachment.size
            ) {
              throw new AttachmentDraftIntegrityError(
                "Attachment draft metadata changed during restore"
              );
            }
            const content = bytes(result.bytes);
            if (content.byteLength !== attachment.size) {
              throw new AttachmentDraftIntegrityError(
                "Attachment draft byte length mismatch"
              );
            }
            const state = states.get(attachment.id);
            if (!state || state.phase !== "restoring") continue;
            restored.push({
              id: attachment.id,
              source: attachment.source,
              position: attachment.position,
              file: new File([content], attachment.name, {
                type: attachment.mimeType,
                lastModified: attachment.lastModified,
              }),
            });
          } catch (error) {
            failedCount += 1;
            console.warn("[attachment-drafts] restore failed", error);
            if (error instanceof AttachmentDraftIntegrityError) {
              remove(attachment.id);
            }
          }
        }
        const positionById = new Map(
          metadata.map((attachment) => [attachment.id, attachment.position])
        );
        return {
          attachments: restored.sort(
            (left, right) =>
              (positionById.get(left.id) ?? 0) -
              (positionById.get(right.id) ?? 0)
          ),
          failedCount,
        };
      } finally {
        releaseMetadata();
        restoreInFlight = false;
      }
    },

    async stage({ id, file, source }, position) {
      if (!isActive()) return false;
      const existing = states.get(id);
      if (existing?.persisted) return true;
      const state: AttachmentState = {
        phase: "staging",
        live: true,
        persisted: false,
        writePending: true,
        removeAfterWrite: false,
      };
      states.set(id, state);
      try {
        await Promise.all([...restoreMetadataBarriers]);
        if (!isActive() || states.get(id) !== state) return false;
        const resolvedPosition = position ?? nextPosition++;
        nextPosition = Math.max(nextPosition, resolvedPosition + 1);
        const content = await file.arrayBuffer();
        if (!isActive()) return false;
        await host.stage({
          channel,
          attachment: {
            id,
            position: resolvedPosition,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            lastModified: file.lastModified,
            source,
          },
          bytes: content,
        });
        if (!isActive()) return false;
        state.writePending = false;
        if (states.get(id) !== state) {
          if (state.removeAfterWrite) {
            void host.remove({ channel, attachmentId: id }).catch((error) => {
              console.warn("[attachment-drafts] remove failed", error);
            });
          }
          return true;
        }
        state.persisted = true;
        if (state.removeAfterWrite || (!state.live && state.phase !== "sending")) {
          remove(id);
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
        if (restoreInFlight && state.persisted) continue;
        if (state.phase === "restoring" && state.live) state.phase = "ready";
        if (state.live || state.phase === "sending") continue;
        if (state.phase === "staging" || state.phase === "restoring") continue;
        remove(id);
      }
    },

    discardUnready(attachmentIds) {
      if (!isActive()) return;
      for (const id of attachmentIds) {
        const state = states.get(id);
        if (
          !state ||
          state.phase === "ready" ||
          state.phase === "sending" ||
          state.persisted
        ) {
          continue;
        }
        state.live = false;
        if (state.persisted) remove(id);
      }
    },

    beginSend(attachmentIds) {
      if (!isActive()) return;
      for (const id of attachmentIds) {
        sendingIds(channel).add(id);
        const state = states.get(id);
        if (state) state.phase = "sending";
      }
    },

    settleSend({ attachmentIds, keepAttachmentIds }) {
      if (!isActive()) return;
      const keep = new Set(keepAttachmentIds);
      for (const id of attachmentIds) {
        sendingIds(channel).delete(id);
        const state = states.get(id);
        if (!state) continue;
        if (keep.has(id)) {
          state.live = true;
          state.removeAfterWrite = false;
          state.phase = state.persisted ? "ready" : state.writePending ? "staging" : "failed";
        } else {
          if (state.writePending) state.removeAfterWrite = true;
          remove(id);
        }
      }
    },

    canLeave(attachmentIds) {
      if (!isActive()) return attachmentIds.length === 0;
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
