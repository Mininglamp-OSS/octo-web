import { describe, expect, it } from "vitest";
import { isBlankPopupUrl, isExternalHttpUrl } from "../externalLink";

describe("isExternalHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isExternalHttpUrl("https://example.com/docs/1")).toBe(true);
    expect(isExternalHttpUrl("http://intranet.local:8080/page")).toBe(true);
    expect(isExternalHttpUrl("https://im.deepminer.com.cn/fleet/1/issues/A-2")).toBe(true);
  });

  it("rejects non-http protocols without ever routing them to the OS", () => {
    expect(isExternalHttpUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(isExternalHttpUrl("octo://deep-link/anything")).toBe(false);
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("mailto:someone@example.com")).toBe(false);
    expect(isExternalHttpUrl("shell:Documents")).toBe(false);
    expect(isExternalHttpUrl("blob:https://example.com/uuid")).toBe(false);
    expect(isExternalHttpUrl("data:text/html,<script>1</script>")).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(isExternalHttpUrl("")).toBe(false);
    expect(isExternalHttpUrl("not a url")).toBe(false);
    expect(isExternalHttpUrl("http://")).toBe(false);
  });
});

describe("isBlankPopupUrl", () => {
  it("accepts the about:blank shapes the renderer opens deliberately", () => {
    // The two call sites (realname verification, global-search doc open) both
    // call window.open("about:blank", "_blank") to get a truthful
    // blocked/succeeded signal before navigating the reference.
    expect(isBlankPopupUrl("about:blank")).toBe(true);
  });

  it("rejects every other URL, including other about: pages", () => {
    expect(isBlankPopupUrl("about:srcdoc")).toBe(false);
    expect(isBlankPopupUrl("https://example.com")).toBe(false);
    expect(isBlankPopupUrl("javascript:alert(1)")).toBe(false);
    expect(isBlankPopupUrl("")).toBe(false);
    expect(isBlankPopupUrl("about:blank?evil=1")).toBe(false);
  });
});
