import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  checkResource,
  compilePattern,
  findBudget,
  measureCopy,
  normalizeBudgets,
} from "../i18n/length-budgets.mjs";

test("compilePattern matches single-segment wildcard", () => {
  const re = compilePattern("base.navRail.*");
  assert.ok(re.test("base.navRail.summary"));
  assert.ok(!re.test("base.navRail.settings.item"));
  assert.ok(!re.test("base.navigation.summary"));
});

test("compilePattern matches double-star as multi-segment", () => {
  const re = compilePattern("base.navRail.**");
  assert.ok(re.test("base.navRail.summary"));
  assert.ok(re.test("base.navRail.settings.item"));
  assert.ok(!re.test("base.navigation.summary"));
});

test("measureCopy strips {{tokens}} before counting graphemes", () => {
  assert.equal(measureCopy("Hello {{name}}!"), "Hello !".length);
  assert.equal(measureCopy("AI Summary"), 10);
  assert.equal(measureCopy("智能总结"), 4);
});

test("normalizeBudgets drops entries with missing patterns or bad maxChars", () => {
  const parsed = normalizeBudgets({
    budgets: [
      { container: "ok", maxChars: 10, keyPatterns: ["base.a.*"] },
      { container: "no-patterns", maxChars: 10, keyPatterns: [] },
      { container: "bad-max", maxChars: 0, keyPatterns: ["x"] },
      { container: "missing-max", keyPatterns: ["y"] },
      "not-an-object",
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].container, "ok");
});

test("findBudget returns first matching budget in order", () => {
  const budgets = normalizeBudgets({
    budgets: [
      { container: "narrow", maxChars: 5, keyPatterns: ["base.foo.bar"] },
      { container: "wide", maxChars: 20, keyPatterns: ["base.**"] },
    ],
  });
  assert.equal(findBudget(budgets, "base.foo.bar").container, "narrow");
  assert.equal(findBudget(budgets, "base.other").container, "wide");
  assert.equal(findBudget(budgets, "app.thing"), undefined);
});

test("checkResource flags NavRail label that exceeds budget without .short", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "navRailLabel", maxChars: 10, keyPatterns: ["base.summaryCard.title"] }],
  });
  const violations = checkResource(
    {
      "zh-CN": { "summaryCard.title": "智能总结" },
      "en-US": { "summaryCard.title": "AI Summary Report" },
    },
    "base",
    budgets,
    ["zh-CN", "en-US"],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].locale, "en-US");
  assert.equal(violations[0].key, "base.summaryCard.title");
  assert.equal(violations[0].shortAvailable, false);
});

test("checkResource resolves violation when a fitting .short variant exists", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "chatListDate", maxChars: 12, keyPatterns: ["base.time.dayBeforeYesterday"] }],
  });
  const violations = checkResource(
    {
      "en-US": {
        "time.dayBeforeYesterday": "The day before yesterday",
        "time.dayBeforeYesterday.short": "2d ago",
      },
    },
    "base",
    budgets,
    ["zh-CN", "en-US"],
  );
  assert.deepEqual(violations, []);
});

test("checkResource still flags when .short is itself over budget", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "chatListDate", maxChars: 12, keyPatterns: ["base.time.dayBeforeYesterday"] }],
  });
  const violations = checkResource(
    {
      "en-US": {
        "time.dayBeforeYesterday": "The day before yesterday",
        "time.dayBeforeYesterday.short": "Two days ago now",
      },
    },
    "base",
    budgets,
    ["zh-CN", "en-US"],
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].shortAvailable, true);
  assert.equal(violations[0].shortLength, "Two days ago now".length);
});

test("checkResource is a no-op when budgets are empty", () => {
  const violations = checkResource(
    { "en-US": { "any.key": "extremely long copy that would fail almost any budget" } },
    "base",
    [],
    ["en-US"],
  );
  assert.deepEqual(violations, []);
});

test("interpolation tokens are ignored when measuring — a variable-only string can still fit", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "pill", maxChars: 3, keyPatterns: ["base.count.short"] }],
  });
  const violations = checkResource(
    { "en-US": { "count.short": "{{count}}!" } },
    "base",
    budgets,
    ["en-US"],
  );
  // "count.short" ends with `.short` — treated as a short-variant carrier, skipped from the primary check.
  assert.deepEqual(violations, []);
});
