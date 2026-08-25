import { describe, expect, it } from "vitest";
import { fleetTrustDialogCopy } from "../fleetTrustDialog";

describe("fleetTrustDialogCopy", () => {
  const host = "onprem.customer.com";
  const href = "https://onprem.customer.com/fleet/1/issues/WS-4";

  it("returns zh copy for Chinese locales", () => {
    for (const locale of ["zh-CN", "zh-TW", "zh-Hans", "zh"]) {
      const copy = fleetTrustDialogCopy(locale, host, href);
      expect(copy.title).toBe("在浏览器中打开链接？");
      expect(copy.message).toContain(host);
      expect(copy.detail).toContain(href);
      expect(copy.buttons).toEqual(["打开", "取消"]);
      expect(copy.checkboxLabel).toBe("信任此域名，下次不再询问");
    }
  });

  it("returns en copy for non-Chinese locales", () => {
    for (const locale of ["en-US", "en-GB", "ja-JP", "fr-FR", "de-DE", "en"]) {
      const copy = fleetTrustDialogCopy(locale, host, href);
      expect(copy.title).toBe("Open this link in the browser?");
      expect(copy.message).toContain(host);
      expect(copy.detail).toContain(href);
      expect(copy.buttons).toEqual(["Open", "Cancel"]);
      expect(copy.checkboxLabel).toBe("Trust this domain and don't ask again");
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
