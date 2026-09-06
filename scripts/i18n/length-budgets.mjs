/**
 * Length-budget check for i18n resources.
 *
 * Consumed by scripts/i18n-scan.mjs (pnpm i18n:check). Extracted so the
 * pattern-matching and violation-detection logic can be unit-tested in
 * isolation from the file-walking scan pipeline.
 *
 * Budgets file shape (.i18n/length-budgets.json):
 *   {
 *     "budgets": [
 *       { "container": "navRailLabel", "maxChars": 10, "keyPatterns": ["app.navRail.*"] }
 *     ]
 *   }
 *
 * Pattern glob:
 *   `*`  — matches one dot-separated segment (i.e. `[^.]+`)
 *   `**` — matches one or more segments (i.e. `.+`)
 *   any other char — literal
 */

export function normalizeBudgets(raw, { onSkip, onRootError } = {}) {
  if (raw == null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    onRootError?.({ reason: `root must be an object with a "budgets" array, got ${Array.isArray(raw) ? "array" : typeof raw}` });
    return [];
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "budgets")) {
    // Blank scaffold ({ "$comment": "..." }) — legitimate empty state, not an error.
    return [];
  }
  if (!Array.isArray(raw.budgets)) {
    onRootError?.({ reason: `"budgets" must be an array, got ${typeof raw.budgets}` });
    return [];
  }
  const normalized = [];
  raw.budgets.forEach((entry, index) => {
    const reason = validateBudgetEntry(entry);
    if (reason) {
      onSkip?.({ index, entry, reason });
      return;
    }
    const patterns = entry.keyPatterns.filter((p) => typeof p === "string" && p.length > 0);
    normalized.push({
      container: typeof entry.container === "string" ? entry.container : "",
      maxChars: Number(entry.maxChars),
      notes: typeof entry.notes === "string" ? entry.notes : "",
      keyPatterns: patterns,
      matchers: patterns.map(compilePattern),
    });
  });
  return normalized;
}

function validateBudgetEntry(entry) {
  if (!entry || typeof entry !== "object") return "not an object";
  const maxChars = Number(entry.maxChars);
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "missing or non-positive maxChars";
  if (!Array.isArray(entry.keyPatterns)) return "keyPatterns is not an array";
  const patterns = entry.keyPatterns.filter((p) => typeof p === "string" && p.length > 0);
  if (patterns.length === 0) return "keyPatterns is empty (or contains only non-strings)";
  return null;
}

export function compilePattern(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped
    .replace(/\*\*/g, "__DOUBLESTAR__")
    .replace(/\*/g, "[^.]+")
    .replace(/__DOUBLESTAR__/g, ".+");
  return new RegExp(`^${source}$`);
}

export function findBudget(budgets, key) {
  for (const budget of budgets) {
    if (budget.matchers.some((m) => m.test(key))) return budget;
  }
  return undefined;
}

export function measureCopy(value) {
  const withoutTokens = typeof value === "string"
    ? value.replace(/\{\{\s*[\w.-]+\s*\}\}/g, "")
    : "";
  // Counts code points. Surrogate-pair emoji and CJK read as 1; combining
  // marks or ZWJ emoji sequences report their constituent count. Good enough
  // while the current locale files use neither.
  return Array.from(withoutTokens).length;
}

/**
 * Scan one package's locale entries for budget violations.
 *
 * The reported `shortKey` intentionally uses the same un-prefixed form as
 * the entries map so a developer who adds exactly the suggested key clears
 * the violation. Namespace-prefixing the hint while looking up un-prefixed
 * keys would silently mislead the developer on every package except the
 * mail namespace, which stores its keys pre-prefixed.
 *
 * @param {{[locale: string]: {[key: string]: string}}} entriesByLocale
 * @param {string} namespace  — package namespace used to prefix local keys
 * @param {ReturnType<typeof normalizeBudgets>} budgets
 * @param {string[]} locales  — locales to check
 */
export function checkResource(entriesByLocale, namespace, budgets, locales) {
  if (!budgets || budgets.length === 0) return [];
  const violations = [];
  const seen = new Set();
  for (const locale of locales) {
    const entries = entriesByLocale[locale];
    if (!entries) continue;
    for (const [rawKey, rawValue] of Object.entries(entries)) {
      if (typeof rawValue !== "string") continue;
      if (rawKey.endsWith(".short")) continue;
      const fullKey = rawKey.startsWith(`${namespace}.`) ? rawKey : `${namespace}.${rawKey}`;
      const budget = findBudget(budgets, fullKey);
      if (!budget) continue;
      const length = measureCopy(rawValue);
      if (length <= budget.maxChars) continue;
      const shortLookupKey = `${rawKey}.short`;
      const shortValue = entries[shortLookupKey];
      const shortLength = typeof shortValue === "string" ? measureCopy(shortValue) : null;
      if (shortLength !== null && shortLength <= budget.maxChars) continue;
      const dedupeKey = `${locale} | ${fullKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      violations.push({
        key: fullKey,
        locale,
        value: rawValue,
        length,
        budget: budget.maxChars,
        container: budget.container,
        // Un-prefixed lookup key — copy-pasteable straight into the locale
        // JSON file where the violation was found. Do NOT prefix with the
        // namespace here (see doc comment above).
        shortKey: shortLookupKey,
        shortAvailable: typeof shortValue === "string",
        shortLength,
      });
    }
  }
  return violations;
}
