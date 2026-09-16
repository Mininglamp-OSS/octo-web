// Authoritative host-source contract, shipped with the Communication artifact.
export const FILE_PREVIEW_ATTACHMENT_VERSION = 1;

export interface MessageAttachmentLocator {
  kind: "message-attachment";
  channelId: string;
  channelType: number;
  messageId: string;
  messageSeq: number;
  attachmentIndex: number;
}

export interface AttachmentPreviewRequest {
  version: typeof FILE_PREVIEW_ATTACHMENT_VERSION;
  requestId: string;
  locator: MessageAttachmentLocator;
}

export interface AttachmentPreviewCancel {
  version: typeof FILE_PREVIEW_ATTACHMENT_VERSION;
  requestId: string;
}

export type AttachmentPreviewResult = {
  status: "accepted" | "unsupported" | "cancelled";
};

export interface AttachmentPreviewState {
  requestId: string;
  phase: "loading" | "ready" | "error";
  error?: string;
}

export interface AttachmentPreviewClosed {
  requestId: string;
}

export interface AttachmentPreviewHost {
  openFilePreview(request: AttachmentPreviewRequest): Promise<AttachmentPreviewResult>;
  /** Idempotent, including cancellation echoed after a host close notification. */
  cancelFilePreview(request: AttachmentPreviewCancel): Promise<void>;
}

function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid attachment request");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new Error("Invalid attachment record");
  const data = value as Record<string, unknown>;
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(data, key))) {
    throw new Error("Missing attachment field");
  }
  if (Reflect.ownKeys(data).some((key) =>
    typeof key !== "string" || (!keys.includes(key) && !optional.includes(key)) ||
    !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(data, key), "value"))) {
    throw new Error("Unexpected attachment field");
  }
  return data;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid attachment identifier");
  return value;
}

function requestId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid attachment request ID");
  return id;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error("Invalid attachment index");
  }
  return value;
}

export function parseMessageAttachmentLocator(value: unknown): MessageAttachmentLocator {
  const data = record(value, ["kind", "channelId", "channelType", "messageId", "messageSeq", "attachmentIndex"]);
  if (data.kind !== "message-attachment" || ![1, 2, 5].includes(data.channelType as number)) {
    throw new Error("Unsupported attachment source");
  }
  const messageId = text(data.messageId, 19);
  if (!/^[1-9]\d{0,18}$/.test(messageId) || BigInt(messageId) > BigInt("9223372036854775807")) {
    throw new Error("Invalid attachment message ID");
  }
  return {
    kind: "message-attachment",
    channelId: text(data.channelId, 256),
    channelType: integer(data.channelType, 1, 5),
    messageId,
    messageSeq: integer(data.messageSeq, 1, 0xffffffff),
    attachmentIndex: integer(data.attachmentIndex, 0, 4095),
  };
}

export function parseAttachmentPreviewCancel(value: unknown): AttachmentPreviewCancel {
  const data = record(value, ["version", "requestId"]);
  if (data.version !== FILE_PREVIEW_ATTACHMENT_VERSION) {
    throw new Error("Incompatible attachment request");
  }
  return { version: FILE_PREVIEW_ATTACHMENT_VERSION, requestId: requestId(data.requestId) };
}

export function parseAttachmentPreviewRequest(value: unknown): AttachmentPreviewRequest {
  const data = record(value, ["version", "requestId", "locator"]);
  return {
    ...parseAttachmentPreviewCancel({ version: data.version, requestId: data.requestId }),
    locator: parseMessageAttachmentLocator(data.locator),
  };
}

export function parseAttachmentPreviewResult(value: unknown): AttachmentPreviewResult {
  const data = record(value, ["status"]);
  if (data.status !== "accepted" && data.status !== "unsupported" && data.status !== "cancelled") {
    throw new Error("Invalid attachment response");
  }
  return { status: data.status };
}

/** Validate the complete inbound command before returning canonical state. */
export function parseAttachmentPreviewState(value: unknown): AttachmentPreviewState {
  const data = record(value, ["type", "requestId", "phase"], ["error"]);
  if (data.type !== "filePreviewState" ||
      (data.phase !== "loading" && data.phase !== "ready" && data.phase !== "error")) {
    throw new Error("Invalid attachment preview state");
  }
  return {
    requestId: requestId(data.requestId),
    phase: data.phase,
    ...(data.error === undefined ? {} : { error: text(data.error, 1000) }),
  };
}

export function parseAttachmentPreviewClosed(value: unknown): AttachmentPreviewClosed {
  const data = record(value, ["type", "requestId"]);
  if (data.type !== "filePreviewClosed") throw new Error("Invalid attachment close notification");
  return { requestId: requestId(data.requestId) };
}
