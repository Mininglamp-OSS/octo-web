import { describe, expect, it, vi } from "vitest";

// 内容类经 `../../i18n` 间接拉入 semi-ui 加载链，在 vitest transform 下会炸；这里只用到
// `t` 作占位，直接 mock 掉 i18n，隔离出可测的 encode/decode/收窄逻辑。
vi.mock("../../../i18n", () => ({ t: (k: string) => k }));

import { DocumentShareCardContent } from "../DocumentShareCardContent";

describe("DocumentShareCardContent — encode/decode round-trip", () => {
  it("round-trips all fields through encodeJSON → decodeJSON", () => {
    const src = new DocumentShareCardContent();
    src.docId = "d_1";
    src.spaceId = "sp_1";
    src.kind = "sheet";
    src.title = "Q3 复盘";
    src.ownerName = "林澈";
    src.updatedAt = "今天 14:06";
    src.url = "https://x/d/d_1?sp=sp_1";
    src.permission = "writer";

    const wire = src.encodeJSON();
    expect(wire.type).toBe(18);

    const dst = new DocumentShareCardContent();
    dst.decodeJSON(wire);
    expect(dst.docId).toBe("d_1");
    expect(dst.spaceId).toBe("sp_1");
    expect(dst.kind).toBe("sheet");
    expect(dst.title).toBe("Q3 复盘");
    expect(dst.ownerName).toBe("林澈");
    expect(dst.updatedAt).toBe("今天 14:06");
    expect(dst.permission).toBe("writer");
  });
});

describe("DocumentShareCardContent.decodeJSON — untrusted-wire narrowing", () => {
  it("drops malformed doc_id / space_id at the boundary (P1-a)", () => {
    const c = new DocumentShareCardContent();
    c.decodeJSON({ doc_id: "../admin", space_id: "a/b", kind: "board", title: "T" });
    expect(c.docId).toBe("");
    expect(c.spaceId).toBe("");
  });

  it("narrows an unknown kind to 'doc' and unknown permission to 'reader'", () => {
    const c = new DocumentShareCardContent();
    c.decodeJSON({ doc_id: "d_1", kind: "evil", permission: "admin", title: "T" });
    expect(c.kind).toBe("doc");
    expect(c.permission).toBe("reader");
  });

  it("tolerates non-string / missing fields without throwing", () => {
    const c = new DocumentShareCardContent();
    expect(() => c.decodeJSON({ doc_id: 123, title: null })).not.toThrow();
    expect(c.docId).toBe("");
    expect(c.title).toBe("");
  });
});
