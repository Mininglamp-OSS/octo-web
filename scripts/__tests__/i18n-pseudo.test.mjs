import { strict as assert } from "node:assert";
import { test } from "node:test";
import { transformResource, transformString } from "../i18n/pseudo.mjs";

test("transformString wraps in brackets and pads visible text by exactly 40%", () => {
  const out = transformString("Confirm booking"); // 15 visible chars → ceil(15 * 0.4) = 6 pad chars
  assert.ok(out.startsWith("["), out);
  assert.ok(out.endsWith("]"), out);
  const bodyLength = Array.from(out).length - 2;
  // 14 accented letters + 1 preserved space + 6 pad chars = 21
  assert.equal(bodyLength, 21, `unexpected body length: ${out}`);
});

test("transformString padding ratio is configurable", () => {
  const out = transformString("Save", { paddingRatio: 1 }); // 4 chars → 4 pads
  const bodyLength = Array.from(out).length - 2;
  assert.equal(bodyLength, 8, `unexpected body length: ${out}`);
});

test("transformString accents ASCII letters", () => {
  const out = transformString("Hello");
  assert.ok(!out.includes("Hello"), `unexpected raw English: ${out}`);
  assert.ok(out.includes("Ĥ"), `expected accented H: ${out}`);
});

test("transformString preserves interpolation placeholders", () => {
  const out = transformString("Hello, {{name}}!");
  assert.ok(out.includes("{{name}}"), `placeholder missing: ${out}`);
});

test("transformString leaves a single visible character alone", () => {
  assert.equal(transformString("×"), "×");
  assert.equal(transformString(""), "");
});

test("transformResource walks nested objects and arrays", () => {
  const input = {
    a: "One",
    b: { c: "Two", d: ["Three", "Four"] },
    e: 42,
  };
  const out = transformResource(input);
  assert.equal(typeof out.a, "string");
  assert.ok(out.a.startsWith("["));
  assert.equal(typeof out.b.c, "string");
  assert.ok(Array.isArray(out.b.d));
  assert.ok(out.b.d[0].startsWith("["));
  // Non-string leaves survive unchanged
  assert.equal(out.e, 42);
});

test("transformString handles multiple placeholders and preserves their order", () => {
  const out = transformString("Hi {{first}} and {{second}}!");
  const firstIdx = out.indexOf("{{first}}");
  const secondIdx = out.indexOf("{{second}}");
  assert.ok(firstIdx !== -1 && secondIdx !== -1, `placeholders missing: ${out}`);
  assert.ok(firstIdx < secondIdx, `placeholder order changed: ${out}`);
});
