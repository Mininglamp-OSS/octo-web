import { MessageStatus, TaskStatus } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { getImageMessageImages } from "../../bridge/message/imageMessageImages";
import type { ImagePreviewSlide } from "../../Messages/Image/ImagePreview";

export interface GalleryImage extends ImagePreviewSlide {
  key: string;
}

export interface GalleryMessage {
  contentType: number;
  content?: unknown;
  clientMsgNo?: string;
  messageID?: string;
  status?: MessageStatus;
  revoke?: boolean;
  flame?: boolean;
  isDeleted?: boolean;
  message?: { isDeleted?: boolean };
  remoteExtra?: { revoke?: boolean };
}

export function imageGalleryKey(
  message: GalleryMessage,
  imageIndex: number,
  fallback?: number
): string {
  return JSON.stringify([
    message.clientMsgNo || message.messageID || `position:${fallback}`,
    imageIndex,
  ]);
}

interface CollectOptions {
  resolveUrl: (url: string) => string;
  getUploadStatus?: (clientMsgNo: string) => TaskStatus | undefined;
  /** Archived forwarded messages have no live delivery status. */
  forwarded?: boolean;
}

/** Input must already be ordered and filtered for the current conversation/Space. */
export function collectGalleryImages(
  messages: readonly GalleryMessage[],
  options: CollectOptions
): GalleryImage[] {
  const seen = new Set<string>();
  return messages.flatMap((message, position) => {
    const content = message.content as
      | { contentObj?: { flame?: number } }
      | undefined;
    if (
      message.contentType !== MessageContentTypeConst.image ||
      message.revoke ||
      message.remoteExtra?.revoke ||
      message.flame ||
      content?.contentObj?.flame === 1 ||
      message.isDeleted ||
      message.message?.isDeleted
    )
      return [];
    if (!options.forwarded) {
      // A live message without an identity cannot be safely followed across updates.
      if (!message.clientMsgNo && !message.messageID) return [];
      if (
        message.status === MessageStatus.Wait ||
        message.status === MessageStatus.Fail
      )
        return [];
      const uploadStatus = message.clientMsgNo
        ? options.getUploadStatus?.(message.clientMsgNo)
        : undefined;
      if (uploadStatus !== undefined && uploadStatus !== TaskStatus.success)
        return [];
    }
    return getImageMessageImages(message.content).flatMap((image) => {
      // Local previews never establish eligibility for the conversation gallery.
      if (!image.url.trim() || /^(?:data|blob):/i.test(image.url.trim()))
        return [];
      const src = options.resolveUrl(image.url);
      if (!src) return [];
      const key = imageGalleryKey(message, image.imageIndex, position);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          key,
          src,
          alt: "",
          filename: image.filename,
          ...(image.width && image.height
            ? { width: image.width, height: image.height }
            : {}),
        },
      ];
    });
  });
}
