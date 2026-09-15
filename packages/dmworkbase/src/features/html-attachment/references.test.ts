import { describe, it, expect } from "vitest";
import { attachmentFilename, attachmentObjectReference } from "./references";
import { isBrowserHtmlAttachment } from "./types";
const file = { url: "", name: "a.html", extension: "html" };
describe("attachment references", () => {
  it.each(["file/preview/chat/a%20b", "chat/a%20b"])(
    "preserves literal object-key escapes: %s",
    (sourceUrl) => {
      expect(
        attachmentObjectReference({ ...file, sourceUrl }, "/api/v1/")
      ).toBe("chat/a%20b");
    }
  );
  it("decodes the known display route exactly once", () => {
    expect(
      attachmentObjectReference(
        { ...file, url: "/file/chat/a%2520b" },
        "/api/v1/"
      )
    ).toBe("chat/a%20b");
  });
  it("keeps external storage prefix/bucket/query for the server", () => {
    const url = "https://storage.test/bucket/prefix/chat/a?sig=abc%2Bdef";
    expect(attachmentObjectReference({ ...file, url }, "/api/v1/")).toBe(url);
  });
  it("does not interpret an arbitrary external document as our storage key", () => {
    expect(() =>
      attachmentObjectReference(
        { ...file, url: "https://external.test/docs/index.html" },
        "/api/v1/"
      )
    ).toThrow();
  });
  it("keeps Unicode and extension while removing unsafe filename characters", () => {
    expect(attachmentFilename("报告 Q3.html")).toBe("报告 Q3.html");
    expect(attachmentFilename("../report\n.html")).toBe(".._report_.html");
    expect(attachmentFilename(" ")).toBe("file.html");
  });
  it("only opts browser HTML into this flow", () => {
    expect(isBrowserHtmlAttachment(file)).toBe(true);
    expect(isBrowserHtmlAttachment({ ...file, name: "a.pdf" })).toBe(false);
    window.__POWERED_ELECTRON__ = true;
    expect(isBrowserHtmlAttachment(file)).toBe(false);
    delete window.__POWERED_ELECTRON__;
  });
});
