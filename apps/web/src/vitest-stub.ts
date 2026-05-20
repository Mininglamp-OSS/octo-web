// Production stub for vitest — prevents test framework from leaking into bundle
// Root cause: packages/dmworkbase/src/Utils/__tests__/*.test.ts live inside src/
// and get pulled into Vite's build graph via transitive resolution.

/* eslint-disable @typescript-eslint/no-explicit-any */

// Deep noop proxy: any property access or function call returns itself,
// so chains like vi.fn().mockResolvedValue(...) never throw.
const handler: ProxyHandler<any> = {
  get: (_t, _p) => deepNoop,
  apply: () => deepNoop,
}
const deepNoop: any = new Proxy(function () {}, handler)

export const vi = deepNoop
export const expect = deepNoop
export const describe = deepNoop
export const it = deepNoop
export const test = deepNoop
export const suite = deepNoop
export const bench = deepNoop
export const assert = deepNoop
export const beforeEach = deepNoop
export const afterEach = deepNoop
export const beforeAll = deepNoop
export const afterAll = deepNoop
export const onTestFailed = deepNoop
export const onTestFinished = deepNoop

// Set globals for bare describe()/it() usage (no import)
if (typeof globalThis !== 'undefined') {
  const g = globalThis as any
  const names = [
    'describe', 'it', 'test', 'expect', 'vi', 'suite', 'bench',
    'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'assert',
  ]
  for (const n of names) {
    if (!g[n]) g[n] = deepNoop
  }
}

export default {}
