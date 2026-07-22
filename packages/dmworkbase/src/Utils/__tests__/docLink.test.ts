import { describe, expect, it } from "vitest";
import { buildDocLink, parseDocLink } from "../docLink";

// jsdom serves window.location.origin (default http://localhost); build same-origin links from it so
// the tests do not hard-code a host.
const ORIGIN = window.location.origin;

describe("parseDocLink", () => {
  it("parses a same-origin /d/<docId>?sp=<space> link", () => {
    expect(parseDocLink(`${ORIGIN}/d/doc123?sp=space-1`)).toEqual({
      docId: "doc123",
      space: "space-1",
    });
  });

  it("parses a relative /d/ link (resolved against the current origin)", () => {
    expect(parseDocLink("/d/doc123?sp=space-1")).toEqual({
      docId: "doc123",
      space: "space-1",
    });
  });

  it("returns space undefined when the link carries no ?sp", () => {
    expect(parseDocLink(`${ORIGIN}/d/doc123`)).toEqual({ docId: "doc123", space: undefined });
  });

  it("tolerates a trailing slash", () => {
    expect(parseDocLink(`${ORIGIN}/d/doc123/`)).toEqual({ docId: "doc123", space: undefined });
  });

  it("rejects a cross-origin link that merely uses a /d/ path", () => {
    expect(parseDocLink("https://evil.example.com/d/doc123?sp=space-1")).toBeNull();
  });

  it("rejects non-document paths", () => {
    expect(parseDocLink(`${ORIGIN}/s/ST123`)).toBeNull();
    expect(parseDocLink(`${ORIGIN}/docs?doc=doc123`)).toBeNull();
    expect(parseDocLink(`${ORIGIN}/d/`)).toBeNull();
    expect(parseDocLink(`${ORIGIN}/d/a:b`)).toBeNull();
  });

  it("rejects empty / non-string input", () => {
    expect(parseDocLink(undefined)).toBeNull();
    expect(parseDocLink("")).toBeNull();
    expect(parseDocLink("not a url")).toBeNull();
  });

  it("round-trips with buildDocLink", () => {
    const link = buildDocLink({ docId: "doc123", space: "space-1" });
    expect(parseDocLink(link)).toEqual({ docId: "doc123", space: "space-1" });
  });
});
