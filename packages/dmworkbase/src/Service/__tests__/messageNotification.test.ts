import { describe, expect, it } from "vitest";
import { MessageContentTypeConst } from "../Const";
import { isNotificationSuppressedContentType } from "../messageNotification";

describe("isNotificationSuppressedContentType", () => {
  it("suppresses the passive summary tip", () => {
    expect(
      isNotificationSuppressedContentType(MessageContentTypeConst.summaryNotify)
    ).toBe(true);
    expect(
      isNotificationSuppressedContentType(MessageContentTypeConst.summaryTip)
    ).toBe(true);
  });

  it("does not change existing screenshot or text notification behavior", () => {
    expect(
      isNotificationSuppressedContentType(MessageContentTypeConst.screenshot)
    ).toBe(false);
    expect(isNotificationSuppressedContentType(1)).toBe(false);
  });
});
