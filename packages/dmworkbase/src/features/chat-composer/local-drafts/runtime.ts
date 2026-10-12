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
}

const hostInstallations: HostInstallation[] = [];

function installedHost(): LocalAttachmentDraftHost | undefined {
  for (let index = hostInstallations.length - 1; index >= 0; index -= 1) {
    const installation = hostInstallations[index];
    if (installation.active) return installation.host;
  }
  return undefined;
}

export function installLocalAttachmentDraftHost(
  host: LocalAttachmentDraftHost
): () => void {
  const installation: HostInstallation = { host, active: true };
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

function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function createChatComposerAttachmentDraftPort(
  channel: LocalAttachmentDraftChannel
): ChatComposerAttachmentDraftPort | undefined {
  const host = installedHost();
  if (!host || host.version !== 1) return undefined;
  const states = new Map<string, AttachmentState>();
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
      restoreInFlight = true;
      const restored: RestoredLocalAttachmentDraft[] = [];
      let failedCount = 0;
      try {
        const metadata = await host.list({ channel });
        for (const attachment of metadata) {
          nextPosition = Math.max(nextPosition, attachment.position + 1);
          states.set(attachment.id, {
            phase: "restoring",
            live: false,
            persisted: true,
            writePending: false,
            removeAfterWrite: false,
          });
        }
        for (const attachment of metadata) {
          try {
            const result = await host.read({
              channel,
              attachmentId: attachment.id,
            });
            if (
              result.attachment.id !== attachment.id ||
              result.attachment.size !== attachment.size
            ) {
              throw new Error("Attachment draft metadata changed during restore");
            }
            const content = bytes(result.bytes);
            if (content.byteLength !== attachment.size) {
              throw new Error("Attachment draft byte length mismatch");
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
        restoreInFlight = false;
      }
    },

    async stage({ id, file, source }, position) {
      const resolvedPosition = position ?? nextPosition++;
      nextPosition = Math.max(nextPosition, resolvedPosition + 1);
      const state: AttachmentState = {
        phase: "staging",
        live: true,
        persisted: false,
        writePending: true,
        removeAfterWrite: false,
      };
      states.set(id, state);
      try {
        const content = await file.arrayBuffer();
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
      for (const id of attachmentIds) {
        const state = states.get(id);
        if (
          !state ||
          state.phase === "ready" ||
          state.phase === "sending"
        ) {
          continue;
        }
        state.live = false;
        if (state.persisted) remove(id);
      }
    },

    beginSend(attachmentIds) {
      for (const id of attachmentIds) {
        const state = states.get(id);
        if (state) state.phase = "sending";
      }
    },

    settleSend({ attachmentIds, keepAttachmentIds }) {
      const keep = new Set(keepAttachmentIds);
      for (const id of attachmentIds) {
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
      return attachmentIds.every((id) => {
        const state = states.get(id);
        return (
          state === undefined ||
          state.phase === "restoring" ||
          (state.phase === "ready" && state.persisted)
        );
      });
    },
  };
}
