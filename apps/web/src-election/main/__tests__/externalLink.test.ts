import { describe, expect, it } from "vitest";
import { decideWindowOpen, isExternalHttpUrl } from "../externalLink";

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

describe("decideWindowOpen", () => {
  it("routes http(s) popups to the system browser", () => {
    expect(decideWindowOpen("https://example.com/docs/1")).toBe("open-external");
    expect(decideWindowOpen("http://intranet.local:8080")).toBe("open-external");
  });

  it("denies every non-http URL including about:blank (planted negatives)", () => {
    // about:blank used to be allowed through for the renderer's
    // blocked/succeeded dance; the two call sites were migrated to the
    // IPC_OPEN_EXTERNAL_URL bridge, so any about:blank popup is now an
    // attack surface to deny, not a feature to keep.
    expect(decideWindowOpen("about:blank")).toBe("deny");
    expect(decideWindowOpen("about:blank?evil=1")).toBe("deny");
    expect(decideWindowOpen("about:srcdoc")).toBe("deny");
    expect(decideWindowOpen("blob:https://example.com/uuid")).toBe("deny");
    expect(decideWindowOpen("data:text/html,<script>1</script>")).toBe("deny");
    expect(decideWindowOpen("file:///C:/Windows/System32/calc.exe")).toBe("deny");
    expect(decideWindowOpen("javascript:alert(1)")).toBe("deny");
    expect(decideWindowOpen("octo://deep-link")).toBe("deny");
    expect(decideWindowOpen("shell:Documents")).toBe("deny");
    expect(decideWindowOpen("")).toBe("deny");
    expect(decideWindowOpen("not a url")).toBe("deny");
  });
});
