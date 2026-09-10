import { describe, expect, it } from "vitest";
import { normalizeDocsOrigin, validateDocsDocumentLink } from "./documentLink";

const origin = "https://example.com";
const document = { docId: "doc-1", url: `${origin}/d/doc-1` };

describe("trusted Docs origin", () => {
  it.each([origin, `${origin}/`, `${origin}/api/v1`, "https://EXAMPLE.com:443/"])(
    "normalizes trusted configuration %s",
    (value) => expect(normalizeDocsOrigin(value)).toBe(origin),
  );
  it.each([undefined, "", "invalid", "file:///docs", "javascript:alert(1)", "https://user:secret@example.com", `${origin}?token=secret`, `${origin}#secret`])(
    "rejects invalid or credential-bearing configuration %s",
    (value) => expect(normalizeDocsOrigin(value)).toBeUndefined(),
  );
});

describe("validateDocsDocumentLink", () => {
  it("accepts only a canonical document link and drops unrelated fields", () => {
    expect(validateDocsDocumentLink({ ...document, token: "ignored" }, origin)).toEqual(document);
  });
  it("resolves exact root-relative links only when explicitly allowed", () => {
    const relative = { docId: "doc-1", url: "/d/doc-1" };
    expect(validateDocsDocumentLink(relative, origin)).toBeUndefined();
    expect(validateDocsDocumentLink(relative, origin, true)).toEqual(document);
  });
  it.each([
    "https://evil.example/d/doc-1",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///d/doc-1",
    "//example.com/d/doc-1",
    "https://user@example.com/d/doc-1",
    `${origin}/d/doc-1?token=secret`,
    `${origin}/d/doc-1#fragment`,
    `${origin}/d/other`,
    `${origin}/d/../d/doc-1`,
    `${origin}/d/%64oc-1`,
    `${origin}/d/doc-1\n`,
    "/d/doc-1?extra=1",
    "/d/doc-1#fragment",
    "/d/../d/doc-1",
    "/\\evil.example/d/doc-1",
    "not a URL",
  ])("rejects unsafe or noncanonical URL %s", (url) => {
    expect(validateDocsDocumentLink({ docId: "doc-1", url }, origin, true)).toBeUndefined();
  });
  it.each(["", "../doc-1", "x?y", "a".repeat(129)])("rejects invalid docId %s", (docId) => {
    expect(validateDocsDocumentLink({ docId, url: `${origin}/d/${docId}` }, origin)).toBeUndefined();
  });
  it.each([undefined, null, [], "invalid", {}, { docId: 1, url: document.url }])(
    "rejects malformed documents %s",
    (value) => expect(validateDocsDocumentLink(value, origin)).toBeUndefined(),
  );
  it.each(["", "file://", "null", "https://user:secret@example.com"])(
    "fails closed without a trusted origin %s",
    (value) => expect(validateDocsDocumentLink(document, value)).toBeUndefined(),
  );
});
