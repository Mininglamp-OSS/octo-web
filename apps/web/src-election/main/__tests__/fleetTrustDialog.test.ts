import { describe, expect, it } from "vitest";
import { fleetTrustDialogCopy } from "../fleetTrustDialog";

describe("fleetTrustDialogCopy", () => {
  const host = "onprem.customer.com";
  const href = "https://onprem.customer.com/fleet/1/issues/WS-4";

  it("returns zh copy for Chinese locales", () => {
    for (const locale of ["zh-CN", "zh-TW", "zh-Hans", "zh"]) {
      const copy = fleetTrustDialogCopy(locale, host, href);
      expect(copy.title).toBe("信任此域名以打开任务预览？");
      expect(copy.message).toContain(host);
      expect(copy.detail).toContain(href);
      expect(copy.buttons).toEqual(["允许", "拒绝"]);
      expect(copy.checkboxLabel).toBe("允许并记住此域名");
    }
  });

  it("returns en copy for non-Chinese locales", () => {
    for (const locale of ["en-US", "en-GB", "ja-JP", "fr-FR", "de-DE", "en"]) {
      const copy = fleetTrustDialogCopy(locale, host, href);
      expect(copy.title).toBe("Trust this domain to open task previews?");
      expect(copy.message).toContain(host);
      expect(copy.detail).toContain(href);
      expect(copy.buttons).toEqual(["Allow", "Deny"]);
      expect(copy.checkboxLabel).toBe("Allow and remember this domain");
    }
  });

  it("interpolates the host and href into the copy", () => {
    const en = fleetTrustDialogCopy("en-US", host, href);
    expect(en.message).toContain(host);
    expect(en.detail).toContain(href);
    const zh = fleetTrustDialogCopy("zh-CN", host, href);
    expect(zh.message).toContain(host);
    expect(zh.detail).toContain(href);
  });
});
