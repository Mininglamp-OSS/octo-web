import type {
  ChatComposerAttachmentDraftPort,
  LocalAttachmentDraftChannel,
  LocalAttachmentDraftHost,
  RestoredLocalAttachmentDraft,
} from "./contract";

type AttachmentPhase = "staging" | "ready" | "failed" | "sending";

interface AttachmentState {
  phase: AttachmentPhase;
  live: boolean;
  persisted: boolean;
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

  const remove = (attachmentId: string): void => {
    states.delete(attachmentId);
    void host.remove({ channel, attachmentId }).catch((error) => {
      console.warn("[attachment-drafts] remove failed", error);
    });
  };

  return {
    async restore() {
      const restored: RestoredLocalAttachmentDraft[] = [];
      const metadata = await host.list({ channel });
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
          states.set(attachment.id, {
            phase: "ready",
            live: true,
            persisted: true,
          });
          restored.push({
            id: attachment.id,
            source: attachment.source,
            file: new File([content], attachment.name, {
              type: attachment.mimeType,
              lastModified: attachment.lastModified,
            }),
          });
        } catch (error) {
          console.warn("[attachment-drafts] restore failed", error);
          remove(attachment.id);
        }
      }
      const positionById = new Map(
        metadata.map((attachment) => [attachment.id, attachment.position])
      );
      return restored.sort(
        (left, right) =>
          (positionById.get(left.id) ?? 0) -
          (positionById.get(right.id) ?? 0)
      );
    },

    async stage({ id, file, source }, position = 0) {
      const state: AttachmentState = {
        phase: "staging",
        live: true,
        persisted: false,
      };
      states.set(id, state);
      try {
        const content = await file.arrayBuffer();
        await host.stage({
          channel,
          attachment: {
            id,
            position,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            lastModified: file.lastModified,
            source,
          },
          bytes: content,
        });
        if (states.get(id) !== state) return;
        state.persisted = true;
        if (!state.live) {
          remove(id);
          return;
        }
        state.phase = "ready";
      } catch (error) {
        if (states.get(id) === state) state.phase = "failed";
        console.warn("[attachment-drafts] stage failed", error);
      }
    },

    syncLive(attachmentIds) {
      const live = new Set(attachmentIds);
      for (const [id, state] of states) {
        state.live = live.has(id);
        if (state.live || state.phase === "sending") continue;
        if (state.phase === "staging") continue;
        remove(id);
      }
    },

    discardUnready(attachmentIds) {
      for (const id of attachmentIds) {
        const state = states.get(id);
        if (!state || state.phase === "ready") continue;
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
          state.phase = "ready";
          state.live = true;
        } else {
          remove(id);
        }
      }
    },

    canLeave(attachmentIds) {
      return attachmentIds.every((id) => states.get(id)?.phase === "ready");
    },
  };
}
