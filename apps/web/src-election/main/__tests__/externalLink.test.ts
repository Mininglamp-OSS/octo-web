import { describe, expect, it } from "vitest";
import { isExternalHttpUrl } from "../externalLink";

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
  });

  it("rejects unparseable URLs", () => {
    expect(isExternalHttpUrl("")).toBe(false);
    expect(isExternalHttpUrl("not a url")).toBe(false);
    expect(isExternalHttpUrl("http://")).toBe(false);
  });
});
