import { describe, it, expect } from "vitest";
import { attachmentIdFromSrc } from "../attachmentSrc";

const ID = "019f6039-eebb-72bf-8746-59e58476c47b";

describe("attachmentIdFromSrc", () => {
  it("extracts the id from a site-relative attachment URL", () => {
    expect(attachmentIdFromSrc(`/api/attachments/${ID}/download`)).toBe(ID);
  });

  it("extracts the id from an absolute attachment URL", () => {
    expect(
      attachmentIdFromSrc(`https://host.example.com/api/attachments/${ID}/download`),
    ).toBe(ID);
  });

  it("extracts the id when the URL has a query or fragment", () => {
    expect(attachmentIdFromSrc(`/api/attachments/${ID}/download?x=1`)).toBe(ID);
    expect(attachmentIdFromSrc(`/api/attachments/${ID}/download#frag`)).toBe(ID);
  });

  it("returns null for non-attachment URLs (loaded natively)", () => {
    expect(attachmentIdFromSrc("https://example.com/logo.png")).toBeNull();
    expect(attachmentIdFromSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(attachmentIdFromSrc("/api/attachments/not-a-uuid/download")).toBeNull();
    expect(attachmentIdFromSrc(`/api/attachments/${ID}`)).toBeNull();
    expect(attachmentIdFromSrc("")).toBeNull();
    expect(attachmentIdFromSrc(null)).toBeNull();
    expect(attachmentIdFromSrc(undefined)).toBeNull();
  });
});
