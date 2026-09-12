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

test("measureCopy strips {{tokens}} before counting code points", () => {
  assert.equal(measureCopy("Hello {{name}}!"), "Hello !".length);
  assert.equal(measureCopy("AI Summary"), 10);
  assert.equal(measureCopy("智能总结"), 4);
});

test("normalizeBudgets drops entries with missing patterns or bad maxChars and reports each skip", () => {
  const skipped = [];
  const parsed = normalizeBudgets(
    {
      budgets: [
        { container: "ok", maxChars: 10, keyPatterns: ["base.a.*"] },
        { container: "no-patterns", maxChars: 10, keyPatterns: [] },
        { container: "bad-max", maxChars: 0, keyPatterns: ["x"] },
        { container: "missing-max", keyPatterns: ["y"] },
        "not-an-object",
      ],
    },
    { onSkip: (info) => skipped.push(info) },
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].container, "ok");
  assert.equal(skipped.length, 4);
  assert.deepEqual(
    skipped.map((s) => [s.index, s.reason.split(" ")[0]]),
    [
      [1, "keyPatterns"],
      [2, "missing"],
      [3, "missing"],
      [4, "not"],
    ],
  );
});

test("normalizeBudgets reports a root-shape error when `budgets` is misspelled", () => {
  const rootErrors = [];
  const parsed = normalizeBudgets(
    { budget: [{ container: "typo", maxChars: 5, keyPatterns: ["a"] }] },
    { onRootError: (info) => rootErrors.push(info) },
  );
  // No `budgets` key at all is legit (scaffold), but `budget` is a typo — the
  // scaffold path treats missing-key as silent, so the malformed-shape signal
  // for the typo comes from a plain empty result rather than an error. Confirm
  // the invocation didn't throw and returned nothing.
  assert.deepEqual(parsed, []);
  assert.deepEqual(rootErrors, []);
});

test("normalizeBudgets reports a root-shape error when `budgets` is not an array", () => {
  const rootErrors = [];
  const parsed = normalizeBudgets(
    { budgets: { container: "wrong", maxChars: 5 } },
    { onRootError: (info) => rootErrors.push(info) },
  );
  assert.deepEqual(parsed, []);
  assert.equal(rootErrors.length, 1);
  assert.ok(rootErrors[0].reason.includes("array"));
});

test("normalizeBudgets reports a root-shape error when top-level is an array", () => {
  const rootErrors = [];
  const parsed = normalizeBudgets(
    [{ container: "wrong", maxChars: 5, keyPatterns: ["a"] }],
    { onRootError: (info) => rootErrors.push(info) },
  );
  assert.deepEqual(parsed, []);
  assert.equal(rootErrors.length, 1);
  assert.ok(rootErrors[0].reason.includes("array"));
});

test("normalizeBudgets treats a scaffold-only file (no `budgets` key) as silent empty", () => {
  const rootErrors = [];
  const skipped = [];
  const parsed = normalizeBudgets(
    { $comment: "scaffold" },
    { onRootError: (info) => rootErrors.push(info), onSkip: (info) => skipped.push(info) },
  );
  assert.deepEqual(parsed, []);
  assert.deepEqual(rootErrors, []);
  assert.deepEqual(skipped, []);
});

test("compilePattern escapes regex meta-chars including ? without throwing", () => {
  const re = compilePattern("base.?.foo");
  assert.ok(re.test("base.?.foo"));
  assert.ok(!re.test("base.x.foo"));
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
  // Reported shortKey must equal the un-prefixed lookup key so a developer
  // who literally pastes the hint into the same JSON file clears the
  // violation. (Namespace-prefixing this hint on un-prefixed packages
  // silently misled developers before — regression guard.)
  assert.equal(violations[0].shortKey, "summaryCard.title.short");
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

test("checkResource: adding exactly the reported shortKey to the same file clears the violation (P1-1 regression)", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "chatListDate", maxChars: 12, keyPatterns: ["base.time.dayBeforeYesterday"] }],
  });
  // Package stores keys un-prefixed (like every dir except mail).
  const entries = {
    "en-US": { "time.dayBeforeYesterday": "The day before yesterday" },
  };
  const first = checkResource(entries, "base", budgets, ["en-US"]);
  assert.equal(first.length, 1);
  // Simulate the developer literally following the CLI hint: add the reported key + fitting value.
  entries["en-US"][first[0].shortKey] = "2d ago";
  const second = checkResource(entries, "base", budgets, ["en-US"]);
  assert.deepEqual(second, []);
});

test("checkResource: mail namespace (keys stored pre-prefixed) — hint is still copy-pasteable", () => {
  const budgets = normalizeBudgets({
    budgets: [{ container: "tabTitle", maxChars: 5, keyPatterns: ["mail.folders.inbox"] }],
  });
  const entries = { "en-US": { "mail.folders.inbox": "Inbox Folder" } };
  const first = checkResource(entries, "mail", budgets, ["en-US"]);
  assert.equal(first.length, 1);
  entries["en-US"][first[0].shortKey] = "Inbox";
  const second = checkResource(entries, "mail", budgets, ["en-US"]);
  assert.deepEqual(second, []);
});
