// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  safeJsonParse,
  normalizeArrayData,
  extractArrayFromJson,
  parseJsonl,
  formatJsonl,
  renderCellContent,
  extractColumns,
  countJsonlLines,
} from "../json-utils";

describe("safeJsonParse", () => {
  it("should parse valid JSON", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  it("should return fallback for invalid JSON", () => {
    expect(safeJsonParse("not json", "fallback")).toBe("fallback");
    expect(safeJsonParse("{invalid}", [])).toEqual([]);
  });

  it("should return fallback for null/undefined", () => {
    expect(safeJsonParse(null, "default")).toBe("default");
    expect(safeJsonParse(undefined, "default")).toBe("default");
    expect(safeJsonParse("", "default")).toBe("default");
  });
});

describe("normalizeArrayData", () => {
  it("should keep objects as-is", () => {
    const input = [{ a: 1 }, { b: 2 }];
    expect(normalizeArrayData(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should wrap primitives in value object", () => {
    expect(normalizeArrayData([1, "str", true])).toEqual([
      { value: 1 },
      { value: "str" },
      { value: true },
    ]);
  });

  it("should filter out null/undefined", () => {
    expect(normalizeArrayData([{ a: 1 }, null, undefined, { b: 2 }])).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it("should wrap arrays in value object", () => {
    expect(normalizeArrayData([[1, 2], [3, 4]])).toEqual([
      { value: [1, 2] },
      { value: [3, 4] },
    ]);
  });
});

describe("extractArrayFromJson", () => {
  it("should return array as-is if input is array", () => {
    expect(extractArrayFromJson([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it("should extract from common props (data, items, results)", () => {
    expect(extractArrayFromJson({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(extractArrayFromJson({ items: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(extractArrayFromJson({ results: [{ c: 3 }] })).toEqual([{ c: 3 }]);
  });

  it("should find first array property if no common props", () => {
    expect(extractArrayFromJson({ custom: [{ x: 1 }] })).toEqual([{ x: 1 }]);
  });

  it("should wrap single object in array", () => {
    expect(extractArrayFromJson({ id: 1, name: "test" })).toEqual([
      { id: 1, name: "test" },
    ]);
  });

  it("should parse JSON string input", () => {
    expect(extractArrayFromJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("should return empty array for null/undefined", () => {
    expect(extractArrayFromJson(null)).toEqual([]);
    expect(extractArrayFromJson(undefined)).toEqual([]);
  });
});

describe("parseJsonl", () => {
  it("should parse multiple JSON lines", () => {
    const input = '{"a":1}\n{"b":2}\n{"c":3}';
    expect(parseJsonl(input)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("should handle Windows line endings", () => {
    const input = '{"a":1}\r\n{"b":2}';
    expect(parseJsonl(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should skip empty lines", () => {
    const input = '{"a":1}\n\n{"b":2}\n';
    expect(parseJsonl(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should wrap primitives in value object", () => {
    const input = "1\n\"string\"\ntrue";
    expect(parseJsonl(input)).toEqual([
      { value: 1 },
      { value: "string" },
      { value: true },
    ]);
  });

  it("should skip invalid JSON lines", () => {
    const input = '{"a":1}\ninvalid\n{"b":2}';
    expect(parseJsonl(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("should return empty array for empty input", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("   \n  \n  ")).toEqual([]);
  });
});

describe("formatJsonl", () => {
  it("should format each JSON object with indentation", () => {
    const input = '{"a":1}\n{"b":2}';
    const result = formatJsonl(input);
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b": 2');
    expect(result).toContain("// ---");
  });

  it("should preserve invalid lines as-is", () => {
    const input = '{"a":1}\ninvalid line\n{"b":2}';
    const result = formatJsonl(input);
    expect(result).toContain("invalid line");
  });

  it("should return empty string for empty input", () => {
    expect(formatJsonl("")).toBe("");
  });
});

describe("renderCellContent", () => {
  it("should return dash for null/undefined", () => {
    expect(renderCellContent(null)).toBe("-");
    expect(renderCellContent(undefined)).toBe("-");
  });

  it("should return dash for empty or whitespace-only strings", () => {
    expect(renderCellContent("")).toBe("-");
    expect(renderCellContent("   ")).toBe("-");
  });

  it("should stringify objects", () => {
    expect(renderCellContent({ a: 1 })).toBe('{"a":1}');
  });

  it("should convert primitives to string", () => {
    expect(renderCellContent(123)).toBe("123");
    expect(renderCellContent("str")).toBe("str");
    expect(renderCellContent(true)).toBe("true");
  });
});

describe("extractColumns", () => {
  it("should extract all unique keys from data", () => {
    const data = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ];
    const columns = extractColumns(data);
    const keys = columns.map((c) => c.key);
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
  });

  it("should return empty array for empty data", () => {
    expect(extractColumns([])).toEqual([]);
  });

  it("should set title equal to key", () => {
    const columns = extractColumns([{ myKey: 1 }]);
    expect(columns[0]).toEqual({ key: "myKey", title: "myKey" });
  });

  it("should fall back to dash title for empty-string keys", () => {
    const columns = extractColumns([{ "": 1 }]);
    expect(columns[0]).toEqual({ key: "", title: "-" });
  });
});

describe("countJsonlLines", () => {
  it("should count non-empty lines", () => {
    expect(countJsonlLines('{"a":1}\n{"b":2}\n{"c":3}')).toBe(3);
  });

  it("should skip empty lines", () => {
    expect(countJsonlLines('{"a":1}\n\n{"b":2}\n')).toBe(2);
  });

  it("should return 0 for empty input", () => {
    expect(countJsonlLines("")).toBe(0);
  });
});
