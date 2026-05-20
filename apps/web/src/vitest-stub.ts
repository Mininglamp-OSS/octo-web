// Production stub for vitest — prevents test framework from leaking into bundle
const noop = () => {};
const noopProxy = new Proxy({}, { get: () => noop });
export const vi = noopProxy;
export const expect = () => noopProxy;
export const describe = noop;
export const it = noop;
export const test = noop;
export const beforeEach = noop;
export const afterEach = noop;
export const beforeAll = noop;
export const afterAll = noop;
export default {};
