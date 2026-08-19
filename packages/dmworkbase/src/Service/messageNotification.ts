import { MessageContentTypeConst } from "./Const";

/** Passive in-chat tips that must not trigger desktop notifications or sound. */
export function isNotificationSuppressedContentType(
  contentType: number
): boolean {
  return contentType === MessageContentTypeConst.summaryNotify;
}
