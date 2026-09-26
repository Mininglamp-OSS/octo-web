/**
 * Shared navigation contract for every host-driven entry into the communication
 * renderer. `presentation` controls the shell layout, while `target.variant`
 * only selects behavior inside an individual conversation; a variant must never
 * choose or replace the outer layout.
 *
 * Keep these rules semantically aligned with the Client main-process contract
 * in `electron/main/communication/navigation-contract.ts`. The projects are
 * built independently, so boundary tests protect the shared protocol instead
 * of importing one project's source into the other.
 */
export type CommunicationPage = "chat" | "contacts";

/**
 * `workspace` is the complete Messages workspace; `conversation` is one
 * standalone conversation.
 */
export type CommunicationPresentation = "workspace" | "conversation";

export interface ConversationTarget {
  channelId: string;
  channelType: number;
  messageSeq?: number;
  openChannelSearch?: boolean;
  displayName?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
  /** Adds conversation-specific behavior without changing the requested presentation. */
  variant?: "app-bot" | "workspace-group";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid conversation target");
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid conversation target number");
  }
  return value;
}

export function parseConversationTarget(value: unknown): ConversationTarget {
  const input = record(value);
  const allowed = [
    "channelId",
    "channelType",
    "messageSeq",
    "openChannelSearch",
    "displayName",
    "avatar",
    "metadata",
    "variant",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unexpected conversation target field");
  if (
    typeof input.channelId !== "string" ||
    !input.channelId.trim() ||
    input.channelId.trim().length > 512
  ) {
    throw new Error("Invalid conversation identifier");
  }
  const target: ConversationTarget = {
    channelId: input.channelId.trim(),
    channelType: integer(input.channelType),
  };
  if (input.messageSeq !== undefined)
    target.messageSeq = integer(input.messageSeq);
  if (input.openChannelSearch !== undefined) {
    if (typeof input.openChannelSearch !== "boolean")
      throw new Error("Invalid channel search");
    target.openChannelSearch = input.openChannelSearch;
  }
  for (const key of ["displayName", "avatar"] as const) {
    if (input[key] !== undefined) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > (key === "avatar" ? 8192 : 512)
      ) {
        throw new Error("Invalid target text");
      }
      target[key] = input[key];
    }
  }
  if (input.metadata !== undefined) {
    const metadata = record(input.metadata);
    const encoded = JSON.stringify(metadata);
    if (!encoded || encoded.length > 64 * 1024)
      throw new Error("Invalid target metadata");
    target.metadata = metadata;
  }
  if (input.variant !== undefined) {
    if (input.variant === "app-bot" && target.channelType !== 1) {
      throw new Error("App-bot variant requires channelType 1");
    }
    if (input.variant === "workspace-group" && target.channelType !== 2) {
      throw new Error("Workspace-group variant requires channelType 2");
    }
    if (input.variant !== "app-bot" && input.variant !== "workspace-group") {
      throw new Error("Invalid target variant");
    }
    target.variant = input.variant;
  }
  return target;
}

/**
 * Validates relationships between independently supplied navigation fields.
 * Parsing a target proves that the target itself is valid; this check proves
 * that the page and presentation can display it without changing their meaning.
 */
export function assertConversationNavigation(
  page: CommunicationPage,
  presentation: CommunicationPresentation | undefined,
  target: ConversationTarget | undefined
): void {
  if (target && page !== "chat")
    throw new Error("Conversation target requires chat");
  if (target?.variant !== undefined && presentation !== "conversation") {
    throw new Error(
      "Variant conversation target requires conversation presentation"
    );
  }
}

/**
 * Rechecks typed targets received through renderer-local state rather than an
 * untrusted runtime payload.
 */
export function isCompatibleConversationTarget(
  target: ConversationTarget
): boolean {
  return (
    target.variant === undefined ||
    (target.variant === "app-bot" && target.channelType === 1) ||
    (target.variant === "workspace-group" && target.channelType === 2)
  );
}
