import { describe, it, expect } from "vitest";
import { attachmentIdFromSrc, isPublicAbsoluteUrl } from "../attachmentSrc";

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

describe("isPublicAbsoluteUrl", () => {
  const APP = "http://localhost:3000";

  it("is false for a site-relative (auth-only) download_url — keeps blob path", () => {
    expect(isPublicAbsoluteUrl(`/api/attachments/${ID}/download`, APP)).toBe(false);
  });

  it("is false for an absolute same-origin URL", () => {
    expect(isPublicAbsoluteUrl(`${APP}/api/attachments/${ID}/download`, APP)).toBe(false);
  });

  it("is true for a cross-origin absolute (signed CDN) URL — native <img>", () => {
    expect(isPublicAbsoluteUrl("https://cdn.example.com/x.png?sig=abc", APP)).toBe(true);
  });

  it("is false for empty / nullish / unknown origin", () => {
    expect(isPublicAbsoluteUrl("", APP)).toBe(false);
    expect(isPublicAbsoluteUrl(null, APP)).toBe(false);
    expect(isPublicAbsoluteUrl(undefined, APP)).toBe(false);
    expect(isPublicAbsoluteUrl("https://cdn.example.com/x.png", "")).toBe(false);
  });

  // A hostile download_url must never become a native <a href>/<img src>:
  // non-web schemes are rejected even though their "origin" differs from APP.
  it("is false for javascript:/data:/blob: schemes", () => {
    expect(isPublicAbsoluteUrl("javascript:alert(1)", APP)).toBe(false);
    expect(isPublicAbsoluteUrl("data:text/html,<script>alert(1)</script>", APP)).toBe(false);
    expect(isPublicAbsoluteUrl("blob:https://cdn.example.com/uuid", APP)).toBe(false);
  });
});
