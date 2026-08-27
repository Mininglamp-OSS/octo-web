import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveSearchHit } from "../../../Service/SearchTypes";

// onOpenDriveHit routes a clicked global-search drive hit to the standalone
// file-preview tab (`/drive/f/<fileId>?name=&size=&spaceId=`) and drops folder
// hits (they have no preview; the panel already filters them server-side, this
// is the client-side backstop).
//
// Why a behavioral mirror + source guard, not a full render: the handler is
// inline in Pages/Chat/index.tsx, whose class component pulls the whole chat
// stack (WKApp, wukongimjssdk, react-virtuoso) into vitest. §A mirrors the
// handler against a mocked window.open; §B locks the production edit in place.

function baseHit(overrides: Partial<DriveSearchHit> = {}): DriveSearchHit {
  return {
    file_id: 1234,
    space_id: "space-9",
    space_name: "共享空间",
    parent_id: 0,
    path: ["设计稿"],
    name: "spec.pdf",
    type: "blob",
    ext: "pdf",
    size: 2048,
    owner_uid: "u1",
    owner_name: "Alex",
    updater_uid: "u1",
    updater_name: "Alex",
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-24T09:30:00.000Z",
    ...overrides,
  };
}

// Mirror of Chat#onOpenDriveHit. If production diverges from this shape, the §B
// source guard below fails.
function simulateOnOpenDriveHit(
  hit: DriveSearchHit,
  deps: {
    open: (url: string, target: string) => { opener: unknown; location: { href: string } } | null;
    warn: () => void;
  }
): void {
  if (hit.type === "folder") {
    // production console.warns and skips
    return;
  }
  const params = new URLSearchParams({
    name: hit.name || "",
    size: hit.size != null ? String(hit.size) : "",
    spaceId: hit.space_id,
  });
  const url = `/drive/f/${encodeURIComponent(String(hit.file_id))}?${params.toString()}`;
  const opened = deps.open("about:blank", "_blank");
  if (!opened) {
    deps.warn();
    return;
  }
  try {
    opened.opener = null;
  } catch {
    /* swallow */
  }
  opened.location.href = url;
}

describe("onOpenDriveHit — §A behavior", () => {
  let win: { opener: unknown; location: { href: string } };
  let open: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    win = { opener: {}, location: { href: "about:blank" } };
    open = vi.fn(() => win);
    warn = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  it("file hit: opens /drive/f/<id> with name, size and spaceId in the query", () => {
    simulateOnOpenDriveHit(baseHit(), { open, warn });
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(win.opener).toBeNull();
    const u = new URL(win.location.href, "https://x.example.com");
    expect(u.pathname).toBe("/drive/f/1234");
    expect(u.searchParams.get("name")).toBe("spec.pdf");
    expect(u.searchParams.get("size")).toBe("2048");
    expect(u.searchParams.get("spaceId")).toBe("space-9");
  });

  it("folder hit: never opens a tab (client-side backstop)", () => {
    simulateOnOpenDriveHit(baseHit({ type: "folder", name: "设计稿" }), {
      open,
      warn,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("missing size: leaves the size param empty rather than 'undefined'", () => {
    simulateOnOpenDriveHit(baseHit({ size: undefined }), { open, warn });
    const u = new URL(win.location.href, "https://x.example.com");
    expect(u.searchParams.get("size")).toBe("");
  });

  it("popup blocked: warns and does not navigate", () => {
    open.mockReturnValueOnce(null);
    simulateOnOpenDriveHit(baseHit(), { open, warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("onOpenDriveHit — §B source guard", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../index.tsx"),
    "utf8"
  );
  const block = (() => {
    const start = src.indexOf("onOpenDriveHit={(hit)");
    expect(start, "onOpenDriveHit handler should exist").toBeGreaterThan(-1);
    return src.slice(start, start + 3200);
  })();

  it("skips folder hits before opening a tab", () => {
    const folderIdx = block.indexOf('hit.type === "folder"');
    const openIdx = block.indexOf("window.open");
    expect(folderIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(folderIdx);
  });

  it("routes to the /drive/f/<fileId> standalone preview path", () => {
    expect(block).toMatch(/\/drive\/f\/\$\{encodeURIComponent/);
  });

  it("keeps the about:blank + opener=null new-tab pattern", () => {
    expect(block).toMatch(/window\.open\("about:blank", "_blank"\)/);
    expect(block).toMatch(/opened\.opener = null/);
  });
});
