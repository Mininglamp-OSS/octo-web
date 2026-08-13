import { Toast } from "@douyinfe/semi-ui";
import {
  Channel,
  type MediaMessageContent,
  type MessageContent,
  type Reply,
} from "wukongimjssdk";
import { FileContent } from "../../../../Messages/File/FileContent";
import { ImageContent } from "../../../../Messages/Image/ImageContent";
import { precheckUploadCredentials } from "../../../../Service/UploadCredentials";
import { t } from "../../../../i18n";
import {
  buildChatSendPlan,
  executeChatSendPlan,
  settleChatSendExecution,
} from "../../application";
import type {
  ChatSendOutcome,
  ChatSendRequest,
  EditorContentBlock,
} from "../../domain";
import type { ChatSendOperationRegistry } from "../../extensions";
import {
  createConversationChatTransport,
  type ConversationChatTransportConversation,
  type ConversationMessageTarget,
} from "./ConversationChatTransport";

export interface ConversationChatSendHost<
  TMessage extends ConversationMessageTarget,
> {
  conversation: ConversationChatTransportConversation<TMessage>;
  channel(): Channel;
  sendTextAndWaitAck(
    content: MessageContent,
    onEnqueued: () => void,
  ): Promise<boolean>;
  sendMediaAndWait(
    content: MediaMessageContent,
    onEnqueued: () => void,
  ): Promise<boolean>;
  sendRichTextMixed(
    blocks: EditorContentBlock[],
    reply: Reply | undefined,
    onEnqueued: () => void,
  ): Promise<boolean>;
  resolveReplyFromName?(message: ConversationMessageTarget): string;
  submitVoiceFeedback?(text: string): void;
}

export interface ConversationChatSendDependencies<
  TMessage extends ConversationMessageTarget = ConversationMessageTarget,
> {
  precheckUpload?: typeof precheckUploadCredentials;
  readImagePreview?: (file: File) => Promise<string>;
  measureImage?: (
    previewUrl: string,
  ) => Promise<{ width: number; height: number }>;
  translate?: typeof t;
  toastError?: (message: string) => void;
  operationRegistry?: ChatSendOperationRegistry<TMessage>;
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.substring(dot + 1) : "";
}

async function readImagePreview(file: File): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve) => {
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function measureImage(
  previewUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = previewUrl;
  });
}

/** Conversation adapter for the full plan -> execute -> settle send boundary. */
export function createConversationChatSendHandler<
  TMessage extends ConversationMessageTarget,
>(
  host: ConversationChatSendHost<TMessage>,
  dependencies: ConversationChatSendDependencies<TMessage> = {},
): (request: ChatSendRequest<TMessage>) => Promise<ChatSendOutcome> {
  const precheckUpload =
    dependencies.precheckUpload ?? precheckUploadCredentials;
  const readPreview = dependencies.readImagePreview ?? readImagePreview;
  const readImageSize = dependencies.measureImage ?? measureImage;
  const translate = dependencies.translate ?? t;
  const toastError =
    dependencies.toastError ?? ((message: string) => Toast.error(message));

  return async (request) => {
    host.submitVoiceFeedback?.(request.text);

    const sendImageFile = async (
      file: File,
      onEnqueued: () => void,
    ): Promise<boolean> => {
      try {
        await precheckUpload(
          file,
          host.channel(),
          extension(file.name || ""),
        );
      } catch (error) {
        toastError(
          translate("base.conversation.upload.imageFailed", {
            values: {
              name: file.name,
              message:
                (error as { msg?: string })?.msg ||
                translate("base.conversation.upload.failed"),
            },
          }),
        );
        return false;
      }

      const previewUrl = await readPreview(file);
      if (!previewUrl) {
        toastError(
          translate("base.conversation.upload.imageReadFailed", {
            values: { name: file.name },
          }),
        );
        return false;
      }
      const { width, height } = await readImageSize(previewUrl);
      return host.sendMediaAndWait(
        new ImageContent(file, previewUrl, width, height),
        onEnqueued,
      );
    };

    const sendFileAttachment = async (
      file: File,
      onEnqueued: () => void,
    ): Promise<boolean> => {
      const name = file.name || "unknown";
      const ext = extension(name);
      try {
        await precheckUpload(file, host.channel(), ext);
      } catch (error) {
        toastError(
          translate("base.conversation.upload.fileFailed", {
            values: {
              name,
              message:
                (error as { msg?: string })?.msg ||
                translate("base.conversation.upload.failed"),
            },
          }),
        );
        return false;
      }
      return host.sendMediaAndWait(
        new FileContent(file, name, ext, file.size),
        onEnqueued,
      );
    };

    const plan = buildChatSendPlan(request);
    request.sendProgress?.setExpectedPartIds(
      plan.operations.flatMap(({ partIds }) => partIds),
    );

    const transport = createConversationChatTransport(host.conversation, {
      sendTextAndWaitAck: host.sendTextAndWaitAck,
      sendImageFile,
      sendFileAttachment,
      sendRichTextMixed: host.sendRichTextMixed,
      resolveReplyFromName: host.resolveReplyFromName,
      operationRegistry: dependencies.operationRegistry,
    });
    const execution = await executeChatSendPlan(plan, transport, {
      onPartsEnqueued: (partIds) =>
        request.sendProgress?.markPartsEnqueued(partIds),
    });

    execution.operations.forEach(({ operation, error }) => {
      if (!error) return;
      console.error(
        `[Conversation] ${operation.kind} operation failed:`,
        error,
      );
      if ((error as { toasted?: boolean })?.toasted) return;
      toastError(
        operation.kind === "send_media"
          ? translate("base.conversation.upload.fileSendFailed", {
              values: { name: operation.attachment.file.name },
            })
          : translate("base.conversation.message.sendFailed"),
      );
    });

    return settleChatSendExecution(request, execution);
  };
}
