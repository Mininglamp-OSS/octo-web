import {
  parseMessageAttachmentLocator,
  parseAttachmentPreviewResult,
  type AttachmentPreviewRequest,
  type AttachmentPreviewState,
  type MessageAttachmentLocator,
} from "@octo/file-preview";
import type { FilePreviewInfo } from "../../Components/FilePreviewPanel/types";
import type { HostFilePreviewLayout, LayoutAttachmentHost } from "./hostPreviewLayout";
export {
  parseAttachmentPreviewCancel,
  parseAttachmentPreviewClosed,
  parseAttachmentPreviewRequest,
  parseAttachmentPreviewResult,
  parseAttachmentPreviewState,
  parseMessageAttachmentLocator,
} from "@octo/file-preview";
export type {
  AttachmentPreviewHost,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
} from "@octo/file-preview";
export type { LayoutAttachmentHost as WebAttachmentHost } from "./hostPreviewLayout";

export type AttachmentTakeover = "taken" | "fallback" | "cancelled" | "error";

let host: LayoutAttachmentHost | null = null;
let active: {
  requestId: string;
  locator: MessageAttachmentLocator;
  accepted: boolean;
  cancel(): void;
} | undefined;
const previewListeners = new Set<(source: MessageAttachmentLocator | null) => void>();
const closeListeners = new Set<(requestId: string) => void>();
export type HostAttachmentState = AttachmentPreviewState;
let previewState: HostAttachmentState | undefined;
const stateListeners = new Set<(state: HostAttachmentState) => void>();
export function subscribeHostAttachmentState(listener: (state: HostAttachmentState) => void): () => void {
  stateListeners.add(listener);
  if (previewState && active?.requestId === previewState.requestId) listener(previewState);
  return () => { stateListeners.delete(listener); };
}
export function notifyHostAttachmentState(state: HostAttachmentState): void {
  if (active?.requestId !== state.requestId) return;
  previewState = state;
  for (const listener of stateListeners) listener(state);
}

export function subscribeHostAttachmentClosed(listener: (requestId: string) => void): () => void {
  closeListeners.add(listener);
  return () => { closeListeners.delete(listener); };
}

export function updateHostAttachmentLayout(layout: HostFilePreviewLayout): Promise<void> {
  if (active?.requestId !== layout.requestId) return Promise.resolve();
  return host?.setFilePreviewLayout?.(layout) ?? Promise.resolve();
}

export function releaseHostAttachmentPreview(requestId: string): void {
  if (active?.requestId === requestId) cancelHostAttachmentRequests();
}

function publishPreviewSource(): void {
  const source = active?.accepted ? active.locator : null;
  for (const listener of previewListeners) listener(source);
}

export function subscribeHostAttachmentPreview(
  listener: (source: MessageAttachmentLocator | null) => void
): () => void {
  previewListeners.add(listener);
  listener(active?.accepted ? active.locator : null);
  return () => { previewListeners.delete(listener); };
}

export function notifyHostAttachmentClosed(requestId: string): void {
  if (active?.requestId !== requestId) return;
  cancelHostAttachmentRequests();
  for (const listener of closeListeners) listener(requestId);
}

export function setWebAttachmentHost(next: LayoutAttachmentHost | null): void {
  if (host !== next) cancelHostAttachmentRequests();
  host = next;
}

export function getWebAttachmentHost(): LayoutAttachmentHost | null {
  return host;
}

function sourceLocator(file: FilePreviewInfo) {
  try {
    return parseMessageAttachmentLocator({
      kind: "message-attachment",
      channelId: file.sourceChannelId,
      channelType: file.sourceChannelType,
      messageId: file.messageId,
      messageSeq: file.messageSeq,
      attachmentIndex: file.attachmentIndex,
    });
  } catch {
    return null;
  }
}

/** Synchronous pre-check for a verifiable file source with a host installed. */
export function canForwardToHost(file: FilePreviewInfo): boolean {
  return host !== null && sourceLocator(file) !== null;
}

/** Only absent capabilities, unverifiable entries and explicit unsupported may fall back. */
export function tryHostTakeover(
  file: FilePreviewInfo,
  onInlineOpen?: (file: FilePreviewInfo) => void,
): Promise<AttachmentTakeover> {
  cancelHostAttachmentRequests();
  const currentHost = host;
  const locator = sourceLocator(file);
  if (!currentHost || !locator) return Promise.resolve("fallback");

  const request: AttachmentPreviewRequest = { version: 1, requestId: crypto.randomUUID(), locator };
  const inline = Boolean(onInlineOpen && currentHost.openFilePreviewInPlace && currentHost.setFilePreviewLayout);
  return new Promise((resolve) => {
    let cancelled = false;
    const operation = {
      requestId: request.requestId,
      locator,
      accepted: false,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        resolve("cancelled");
        // A bridge may be gone during teardown. Cancellation must still settle locally.
        void Promise.resolve().then(() => currentHost.cancelFilePreview({
          version: 1, requestId: request.requestId,
        })).catch(() => {});
      },
    };
    active = operation;
    if (inline) onInlineOpen!({ ...file, hostPreview: { requestId: request.requestId } });
    let failureStage = "transport";
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      const response = await (inline
        ? currentHost.openFilePreviewInPlace!(request)
        : currentHost.openFilePreview(request));
      failureStage = "response-validation";
      const result = parseAttachmentPreviewResult(response);
      if (cancelled || active !== operation) return;
      failureStage = "lifecycle";
      if (result.status === "accepted") {
        operation.accepted = true;
        publishPreviewSource();
        resolve("taken");
      } else {
        active = undefined;
        if (result.status === "cancelled" && inline) {
          for (const listener of closeListeners) listener(request.requestId);
        }
        resolve(result.status === "unsupported" ? "fallback" : "cancelled");
      }
    }).catch(() => {
      if (cancelled || active !== operation) return;
      // Never log the response or transport error: either can contain credentials.
      console.debug("[file-preview] Native takeover failed", { stage: failureStage });
      resolve("error");
      operation.cancel();
      active = undefined;
    });
  });
}

/** Also releases an accepted source when the next entry stays in the Web preview. */
export function cancelHostAttachmentRequests(): void {
  previewState = undefined;
  const previous = active;
  active = undefined;
  previous?.cancel();
  if (previous?.accepted) publishPreviewSource();
}
