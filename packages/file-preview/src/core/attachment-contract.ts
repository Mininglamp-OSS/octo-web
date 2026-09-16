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

export interface AttachmentPreviewHost {
  openFilePreview(request: AttachmentPreviewRequest): Promise<AttachmentPreviewResult>;
  cancelFilePreview(request: AttachmentPreviewCancel): Promise<void>;
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid attachment request");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error("Unexpected attachment field");
  return data;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid attachment identifier");
  return value;
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
  const requestId = text(data.requestId, 128);
  if (data.version !== FILE_PREVIEW_ATTACHMENT_VERSION || !/^[a-zA-Z0-9_-]+$/.test(requestId)) {
    throw new Error("Incompatible attachment request");
  }
  return { version: FILE_PREVIEW_ATTACHMENT_VERSION, requestId };
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
