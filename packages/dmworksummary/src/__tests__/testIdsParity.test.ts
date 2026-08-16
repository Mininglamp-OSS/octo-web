import { describe, it, expect } from 'vitest';
// Dynamic import of e2e T is not possible (TS outside project), but we load its
// source as text and eval dynamic-call results for actual sample invocations.
import { summaryTestIds } from '../utils/testIds';

/**
 * Guard: e2e _testids.ts must mirror production testIds.ts.
 *
 * Loads both files as text, extracts string literals and function templates
 * via regex (avoiding any React/Playwright import at Vitest time), and checks
 * that every production key/value is present with an identical string or
 * template body.
 *
 * Dynamic function params differ between files (e.g. versionNum vs v); we only
 * compare the produced template string, not parameter names. We additionally
 * evaluate a representative sample of dynamic calls against both prod and e2e
 * sources to catch template-body drift that regex normalization alone could miss.
 */

// Use vitest's vi to avoid requiring @types/node; fs/path/url are available in
// Node at runtime (vitest runs in Node). Fall back to require for environments
// without node: protocol support.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _path = require('path');

// When run via vitest from packages/dmworksummary, cwd is that package root.
// When run via turbo from repo root, cwd may be repo root. Resolve robustly.
const _cwd = process.cwd();
const _pkgRoot = _cwd.endsWith('dmworksummary') ? _cwd : _path.join(_cwd, 'packages/dmworksummary');
const _repoRoot = _path.resolve(_pkgRoot, '../..');
const prodPath = _path.join(_pkgRoot, 'src/utils/testIds.ts');
const e2ePath = _path.join(_repoRoot, 'apps/web/e2e-kit/tests/summary/_testids.ts');
const prodSrc = _fs.readFileSync(prodPath, 'utf-8');
const e2eSrc = _fs.readFileSync(e2ePath, 'utf-8');

/** Extract `key: "string-literal"` pairs from object source text. */
function extractStringEntries(src: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const re = /(\w+)\s*:\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    entries[m[1]] = m[2];
  }
  return entries;
}

/**
 * Extract `key: (params) => \`template-${expr}\`` pairs, returning the
 * template body text with ${...} placeholders replaced by a single `%s`
 * placeholder so we can compare template *shape* without caring about arg names.
 *
 * Only handles single-line arrow functions returning a template literal —
 * which is the form used throughout both testids files.
 */
function extractFunctionEntries(src: string): Record<string, string> {
  const entries: Record<string, string> = {};
  // Match  key: (params) => `template body with ${...} expressions`
  const re = /(\w+)\s*:\s*\([^)]*\)\s*=>\s*`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Normalise ${…} to %s so param-name differences (versionNum vs v) don't fail.
    entries[m[1]] = m[2].replace(/\$\{[^}]+\}/g, '%s');
  }
  return entries;
}

const prodStrings = extractStringEntries(prodSrc);
const prodFns = extractFunctionEntries(prodSrc);
const e2eStrings = extractStringEntries(e2eSrc);
const e2eFns = extractFunctionEntries(e2eSrc);

// Extract the object literal body from a source file (strip `export const X =`
// prefix and `as const;` suffix) so we can eval dynamic-call samples without
// involving the full TS toolchain.
function extractObjectBody(src: string, constName: string): string {
  const marker = `export const ${constName}`;
  const startIdx = src.indexOf(marker);
  if (startIdx < 0) throw new Error(`parity: cannot find const "${constName}" in source`);
  const eqIdx = src.indexOf('=', startIdx);
  // Find first '{' after =
  const braceStart = src.indexOf('{', eqIdx);
  // Walk braces to find matching close.
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(braceStart, i + 1);
}

// Build in-memory T objects from the source object bodies (JS-only, no TS
// types/as const/export). Used only to assert actual-call output parity for
// representative dynamic testids.
function evalTestIdsObject(src: string): Record<string, unknown> {
  // Strip TypeScript type annotations on arrow-function parameters to make the
  // object literal eval-able as plain JS. e.g. `(taskId: number) =>` → `(taskId) =>`
  // and `(v: number | string) =>` → `(v) =>`.
  const cleaned = src
    .replace(/\((\w+)\s*:\s*[^)]*\)/g, '($1)')
    .replace(/as const/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${cleaned};`)() as Record<string, unknown>;
}

const _prodEval = evalTestIdsObject(extractObjectBody(prodSrc, 'summaryTestIds'));
const _e2eEval  = evalTestIdsObject(extractObjectBody(e2eSrc, 'T'));

describe('testIds parity guard (prod <-> e2e)', () => {
  it('all production string testids exist in e2e _testids.ts', () => {
    for (const [key, val] of Object.entries(prodStrings)) {
      expect(e2eStrings[key], `missing/incorrect string key "${key}"`).toBe(val);
    }
  });

  it('all production function testids produce matching templates in e2e', () => {
    for (const [key, template] of Object.entries(prodFns)) {
      expect(e2eFns[key], `missing/incorrect function key "${key}"`).toBe(template);
    }
  });

  it('e2e _testids has no extra string keys not in production', () => {
    for (const key of Object.keys(e2eStrings)) {
      expect(prodStrings[key], `e2e-only string key "${key}"`).toBeDefined();
    }
  });

  it('e2e _testids has no extra function keys not in production', () => {
    for (const key of Object.keys(e2eFns)) {
      expect(prodFns[key], `e2e-only function key "${key}"`).toBeDefined();
    }
  });

  it('detail() is present in production (sanity check)', () => {
    expect(typeof summaryTestIds.detail).toBe('function');
    expect(summaryTestIds.detail(123)).toBe('summary-detail-123');
  });

  it('detailMemberRow() is present and produces expected testid', () => {
    expect(typeof summaryTestIds.detailMemberRow).toBe('function');
    expect(summaryTestIds.detailMemberRow('user-1')).toBe('summary-detail-member-row-user-1');
  });

  // Dynamic-call parity: for representative dynamic testids, evaluate the
  // object literal extracted from each source and assert concrete sample
  // invocations produce identical strings. This catches cases where the
  // template-shape regex (${...}→%s) would mask a drift in literal prefix/suffix.
  const dynamicSamples: Array<{ key: string; args: unknown[]; expected: string }> = [
    { key: 'detail',        args: [123],            expected: 'summary-detail-123' },
    { key: 'card',          args: [250251],         expected: 'summary-card-250251' },
    { key: 'cardMenu',       args: [19019],          expected: 'summary-card-menu-19019' },
    { key: 'cardAcceptBtn', args: [250251],         expected: 'summary-card-accept-250251' },
    { key: 'cardRejectBtn', args: [250252],         expected: 'summary-card-reject-250252' },
    { key: 'detailMemberRow', args: ['e2e-user-1'], expected: 'summary-detail-member-row-e2e-user-1' },
    { key: 'versionCard',   args: [2],              expected: 'summary-version-card-2' },
  ];

  for (const { key, args, expected } of dynamicSamples) {
    it(`dynamic testid ${key}(${args.map(a => JSON.stringify(a)).join(', ')}) matches between prod and e2e`, () => {
      const prodFn = _prodEval[key];
      const e2eFn  = _e2eEval[key];
      expect(typeof prodFn, `prod missing dynamic key "${key}"`).toBe('function');
      expect(typeof e2eFn,  `e2e  missing dynamic key "${key}"`).toBe('function');
      // eslint-disable-next-line @typescript-eslint/ban-types
      const prodVal = (prodFn as Function)(...args);
      // eslint-disable-next-line @typescript-eslint/ban-types
      const e2eVal  = (e2eFn  as Function)(...args);
      expect(prodVal, `prod ${key} sample`).toBe(expected);
      expect(e2eVal,  `e2e ${key} sample diverges from prod`).toBe(prodVal);
    });
  }
});
