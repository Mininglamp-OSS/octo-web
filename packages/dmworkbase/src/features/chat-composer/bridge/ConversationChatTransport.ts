import {
  MessageContent,
  MessageContentType,
  MessageText,
  Mention,
  Reply,
} from "wukongimjssdk";
import type {
  ChatMention,
  EditorContentBlock,
} from "../domain";
import type {
  BuiltInChatSendOperation,
  ChatSendOperation,
  ChatTransportResult,
} from "../domain/sendPlan";
import type { ChatTransportPort } from "./ChatTransportPort";
import {
  ChatSendOperationRegistry,
  type ChatSendOperationHandler,
} from "./ChatSendOperationRegistry";

/** The part of a Message needed to preserve the existing reply/edit behavior. */
export interface ConversationMessageTarget {
  messageID: string;
  messageSeq: number;
  fromUID: string;
  channel: {
    channelID: string;
    channelType: number;
  };
  content: MessageContent;
}

/** Public Conversation methods used by this bridge. */
export interface ConversationChatTransportConversation<
  TMessage extends ConversationMessageTarget = ConversationMessageTarget,
> {
  sendMessage(content: MessageContent): Promise<TMessage>;
  editMessage(
    messageID: String,
    messageSeq: number,
    channelID: String,
    channelType: number,
    content: String,
  ): Promise<void>;
}

/**
 * The old media/mixed-send helpers are local to Conversation.onSend, while the
 * text/ack and mixed helpers are private. Callers that already own those
 * closures can inject them without making the bridge reach through private
 * implementation details.
 */
export interface ConversationChatTransportHandlers<
  TMessage extends ConversationMessageTarget = ConversationMessageTarget,
> {
  sendTextAndWaitAck?: (content: MessageContent) => Promise<boolean>;
  sendImageFile?: (file: File) => Promise<boolean>;
  sendFileAttachment?: (file: File) => Promise<boolean>;
  sendRichTextMixed?: (
    blocks: EditorContentBlock[],
    reply?: Reply,
  ) => Promise<boolean>;
  resolveReplyFromName?: (message: ConversationMessageTarget) => string;
  /** Public extension registry. Registered operations run before built-ins. */
  operationRegistry?: ChatSendOperationRegistry<TMessage>;
  /** Compatibility hook for overriding built-in operations. */
  operationHandlers?: Partial<{
    [K in BuiltInChatSendOperation<TMessage>["kind"]]: (
      operation: Extract<BuiltInChatSendOperation<TMessage>, { kind: K }>,
    ) => Promise<ChatTransportResult>;
  }>;
}

export class UnsupportedChatSendOperationError extends Error {
  constructor(kind: string) {
    super(`Conversation chat transport cannot execute ${kind} without a handler`);
    this.name = "UnsupportedChatSendOperationError";
  }
}

function setMention(content: MessageText, mention: ChatMention): void {
  const sdkMention = new Mention();
  sdkMention.all = mention.all;
  sdkMention.uids = mention.uids;
  if (mention.humans) (sdkMention as any).humans = mention.humans;
  if (mention.ais) (sdkMention as any).ais = mention.ais;
  content.mention = sdkMention;

  const hasEntities = !!mention.entities?.length;
  const hasThreeState = !!(mention.humans || mention.ais);
  if (!hasEntities && !hasThreeState) return;

  if (!content.contentObj) content.contentObj = {};
  if (!content.contentObj.mention) content.contentObj.mention = {};
  if (hasEntities) content.contentObj.mention.entities = mention.entities;
  if (mention.humans) content.contentObj.mention.humans = mention.humans;
  if (mention.ais) content.contentObj.mention.ais = mention.ais;

  const originalEncode = content.encode.bind(content);
  content.encode = () => {
    try {
      const bytes = originalEncode();
      const json = JSON.parse(new TextDecoder().decode(bytes));
      json.mention ??= {};
      if (hasEntities) json.mention.entities = mention.entities;
      if (mention.humans) json.mention.humans = mention.humans;
      if (mention.ais) json.mention.ais = mention.ais;
      return new TextEncoder().encode(JSON.stringify(json));
    } catch {
      return originalEncode();
    }
  };
}

function buildTextContent(text: string, mention?: ChatMention): MessageText {
  const content = new MessageText(text);
  if (mention) setMention(content, mention);
  return content;
}

function buildReply(
  target: ConversationMessageTarget,
  resolveReplyFromName?: (message: ConversationMessageTarget) => string,
): Reply {
  const reply = new Reply();
  reply.messageID = target.messageID;
  reply.messageSeq = target.messageSeq;
  reply.fromUID = target.fromUID;
  reply.fromName = resolveReplyFromName?.(target) || "";
  reply.content = target.content;
  return reply;
}

function resultFor(
  operation: ChatSendOperation,
  enqueued: boolean,
  messageId?: string,
): ChatTransportResult {
  return {
    enqueuedPartIds: enqueued ? [...operation.partIds] : [],
    ...(messageId ? { messageId } : {}),
  };
}

function isImageFile(file: File): boolean {
  if (file.type?.toLowerCase().startsWith("image/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return new Set([
    "bmp",
    "gif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
  ]).has(extension);
}

export class ConversationChatTransport<
    TMessage extends ConversationMessageTarget = ConversationMessageTarget,
  >
  implements ChatTransportPort<TMessage>
{
  private readonly builtInOperations =
    new ChatSendOperationRegistry<TMessage>();

  constructor(
    private readonly conversation: ConversationChatTransportConversation<TMessage>,
    private readonly handlers: ConversationChatTransportHandlers<TMessage> = {},
  ) {
    this.registerBuiltInOperations();
  }

  async execute(operation: ChatSendOperation<TMessage>): Promise<ChatTransportResult> {
    const publicHandler = this.handlers.operationRegistry?.get(operation);
    if (publicHandler) return publicHandler(operation);

    const override = (
      this.handlers.operationHandlers as
        | Record<string, ChatSendOperationHandler<TMessage> | undefined>
        | undefined
    )?.[operation.kind];
    if (override) return override(operation);

    const builtIn = this.builtInOperations.get(operation);
    if (builtIn) return builtIn(operation);
    throw new UnsupportedChatSendOperationError(operation.kind);
  }

  private registerBuiltInOperations(): void {
    this.builtInOperations.register<
      Extract<ChatSendOperation<TMessage>, { kind: "edit_text" }>
    >("edit_text", (operation) => this.executeEdit(operation));
    this.builtInOperations.register<
      Extract<ChatSendOperation<TMessage>, { kind: "send_text" }>
    >("send_text", (operation) => this.executeText(operation));
    this.builtInOperations.register<
      Extract<ChatSendOperation<TMessage>, { kind: "send_media" }>
    >("send_media", (operation) => this.executeMedia(operation));
    this.builtInOperations.register<
      Extract<ChatSendOperation<TMessage>, { kind: "send_rich_text" }>
    >("send_rich_text", (operation) => this.executeRichText(operation));
  }

  private targetFor(operation: ChatSendOperation<TMessage>): TMessage {
    const target = operation.sendTarget?.replyMessage;
    if (!target) {
      throw new Error(`${operation.kind} requires a captured send target`);
    }
    return target;
  }

  private async executeEdit(
    operation: Extract<ChatSendOperation<TMessage>, { kind: "edit_text" }>,
  ): Promise<ChatTransportResult> {
    const target = this.targetFor(operation);
    const editContent = new MessageText(operation.text);
    const json = editContent.encodeJSON();
    json.type = MessageContentType.text;
    await this.conversation.editMessage(
      target.messageID,
      target.messageSeq,
      target.channel.channelID,
      target.channel.channelType,
      JSON.stringify(json),
    );
    return resultFor(operation, true);
  }

  private async executeText(
    operation: Extract<ChatSendOperation<TMessage>, { kind: "send_text" }>,
  ): Promise<ChatTransportResult> {
    const content = buildTextContent(operation.text, operation.mention);
    const target = operation.sendTarget?.replyMessage;
    if (target) {
      content.reply = buildReply(target, this.handlers.resolveReplyFromName);
    }

    if (this.handlers.sendTextAndWaitAck) {
      return resultFor(
        operation,
        await this.handlers.sendTextAndWaitAck(content),
      );
    }

    const message = await this.conversation.sendMessage(content);
    return resultFor(operation, true, message.messageID);
  }

  private async executeMedia(
    operation: Extract<ChatSendOperation<TMessage>, { kind: "send_media" }>,
  ): Promise<ChatTransportResult> {
    const handler = isImageFile(operation.attachment.file)
      ? this.handlers.sendImageFile
      : this.handlers.sendFileAttachment;
    if (!handler) throw new UnsupportedChatSendOperationError(operation.kind);
    return resultFor(operation, await handler(operation.attachment.file));
  }

  private async executeRichText(
    operation: Extract<ChatSendOperation<TMessage>, { kind: "send_rich_text" }>,
  ): Promise<ChatTransportResult> {
    if (!this.handlers.sendRichTextMixed) {
      throw new UnsupportedChatSendOperationError(operation.kind);
    }
    const target = operation.sendTarget?.replyMessage;
    const reply = target
      ? buildReply(target, this.handlers.resolveReplyFromName)
      : undefined;
    return resultFor(
      operation,
      await this.handlers.sendRichTextMixed(operation.blocks, reply),
    );
  }
}

export function createConversationChatTransport<
  TMessage extends ConversationMessageTarget = ConversationMessageTarget,
>(
  conversation: ConversationChatTransportConversation<TMessage>,
  handlers?: ConversationChatTransportHandlers<TMessage>,
): ConversationChatTransport<TMessage> {
  return new ConversationChatTransport(conversation, handlers);
}
