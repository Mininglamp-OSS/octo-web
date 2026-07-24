import { describe, expect, it } from "vitest";
import { parseMcpListQuery, serializeMcpListQuery } from "./mcpListQuery";

describe("parseMcpListQuery — URL → state", () => {
  it("collects repeated `tag` params (not comma-split)", () => {
    const parsed = parseMcpListQuery("?tag=v1.0&tag=beta&tag=v1.0,rc");
    expect(parsed.tagsSelected).toEqual(["v1.0", "beta", "v1.0,rc"]);
  });

  it("collects repeated `category` params the same way", () => {
    const parsed = parseMcpListQuery("?category=dev&category=data");
    expect(parsed.categoriesSelected).toEqual(["dev", "data"]);
  });

  it("preserves URL-encoded tag values on the way in", () => {
    // %2C encodes ',', %20 encodes ' ', %23 encodes '#'
    const parsed = parseMcpListQuery("?tag=v1.0%2Cbeta&tag=%23net&tag=c%2B%2B");
    expect(parsed.tagsSelected).toEqual(["v1.0,beta", "#net", "c++"]);
  });

  it("returns empty arrays when no filter params are set", () => {
    const parsed = parseMcpListQuery("");
    expect(parsed.tagsSelected).toEqual([]);
    expect(parsed.categoriesSelected).toEqual([]);
    expect(parsed.keyword).toBe("");
  });
});

describe("serializeMcpListQuery — state → URL", () => {
  it("emits one `tag=` key per tag (never comma-joined, never `tag[]=`)", () => {
    const q = serializeMcpListQuery({
      keyword: "",
      categoriesSelected: [],
      tagsSelected: ["v1.0", "beta"],
    });
    expect(q).toBe("tag=v1.0&tag=beta");
  });

  it("URL-encodes commas inside a tag value so the wire form stays unambiguous", () => {
    const q = serializeMcpListQuery({
      keyword: "",
      categoriesSelected: [],
      tagsSelected: ["v1.0,beta"],
    });
    expect(q).toBe("tag=v1.0%2Cbeta");
  });

  it("scrubs legacy `created_by_type` (removed provenance filter)", () => {
    const q = serializeMcpListQuery(
      { keyword: "", categoriesSelected: [], tagsSelected: [] },
      "?created_by_type=bot&other=keep"
    );
    // The known keys are stripped even when no new value replaces them; the
    // unknown `other` param survives.
    expect(q).toContain("other=keep");
    expect(q).not.toContain("created_by_type");
  });

  it("scrubs stale `tag`/`category`/`keyword` before appending fresh ones", () => {
    const q = serializeMcpListQuery(
      { keyword: "new", categoriesSelected: ["data"], tagsSelected: ["beta"] },
      "?keyword=old&tag=alpha&category=dev"
    );
    expect(q).toBe("keyword=new&category=data&tag=beta");
  });
});

describe("URL round-trip — parse ∘ serialize is identity for query-hostile chars", () => {
  it.each([
    ["v1.0,beta"],
    ["c++"],
    ["#net"],
    ["api/v1"],
    ["with space"],
    ["数据服务"],
  ])("preserves %s", (tag) => {
    const q = serializeMcpListQuery({
      keyword: "",
      categoriesSelected: [],
      tagsSelected: [tag],
    });
    expect(parseMcpListQuery("?" + q).tagsSelected).toEqual([tag]);
  });

  it("preserves multi-tag ordering and multiplicity", () => {
    const tags = ["v1.0", "beta", "v1.0,rc", "c++"];
    const q = serializeMcpListQuery({
      keyword: "",
      categoriesSelected: [],
      tagsSelected: tags,
    });
    expect(parseMcpListQuery("?" + q).tagsSelected).toEqual(tags);
  });
});
