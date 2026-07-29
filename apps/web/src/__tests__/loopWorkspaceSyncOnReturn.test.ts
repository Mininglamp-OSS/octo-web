import * as fs from 'fs';
import * as path from 'path';

/**
 * #631 回归:从 Personal/runtime 页切回 Loop 时,workspace 上下文可能被 Personal 页改写,
 * 导致 Loop 子页面用错误的 x-workspace-slug 发请求、数据串台。
 *
 * 根因两处:
 *   1. useLoopWorkspace 的 onNavMenuActivated 在重画右栏前没有重新断言 setWorkspaceContext
 *      和 resetWorkspaceCaches,Personal 页残留的 http 层 slug 没被纠正
 *   2. usePersonalWorkspace 的 onNavMenuActivated 没有清空 selectedWsRef,导致每次进
 *      Personal 都用上次记住的 workspace(而非 Loop 当前选中的)覆盖 http 层 slug
 */
describe('LoopPage — re-assert workspace context on nav-menu-activated', () => {
  let loopPage: string;

  beforeAll(() => {
    loopPage = fs.readFileSync(
      path.join(__dirname, '../../../../packages/dmloop/src/bridge/useLoopWorkspace.tsx'),
      'utf-8',
    );
  });

  it('onNavMenuActivated re-asserts setWorkspaceContext before repainting', () => {
    // Extract the onNavMenuActivated handler body (the one inside the wk:nav-menu-activated useEffect).
    // Anchor on the function declaration within the effect.
    const handlerStart = loopPage.search(/const\s+onNavMenuActivated\s*=\s*\(\{[^}]*menuId[^}]*\}\s*:\s*\{[^}]*menuId[^}]*\}\)/);
    expect(handlerStart).toBeGreaterThanOrEqual(0);

    // Bound the handler body: from the start of the function up to mittBus.on registration.
    const afterDecl = loopPage.slice(handlerStart);
    const handlerEnd = afterDecl.search(/mittBus\.on\(\s*["']wk:nav-menu-activated["']/);
    const handlerBody = handlerEnd > 0 ? afterDecl.slice(0, handlerEnd) : afterDecl;

    // Must call setWorkspaceContext in the normal (non-pending-re-resolve, non-empty-guide) path.
    expect(handlerBody).toMatch(/setWorkspaceContext\(/);
    // Must call resetWorkspaceCaches too.
    expect(handlerBody).toMatch(/resetWorkspaceCaches\(\s*\)/);
    // Both calls must come BEFORE replaceLoopRootPath so that when the child page mounts
    // and fires its useEffect(reload), the http layer slug is already correct.
    const setCtxIdx = handlerBody.search(/setWorkspaceContext\(/);
    const resetCacheIdx = handlerBody.search(/resetWorkspaceCaches\(\s*\)/);
    const replaceRootIdx = handlerBody.search(/replaceLoopRootPath\(\s*\)/);
    expect(setCtxIdx).toBeGreaterThanOrEqual(0);
    expect(resetCacheIdx).toBeGreaterThanOrEqual(0);
    expect(replaceRootIdx).toBeGreaterThan(0);
    expect(setCtxIdx).toBeLessThan(replaceRootIdx);
    expect(resetCacheIdx).toBeLessThan(replaceRootIdx);
  });

  it('does NOT setWorkspaceContext in the pendingSpaceReresolve early-return path', () => {
    // When a space change arrived while backgrounded, reResolveSpace() already handles
    // setWorkspaceContext("", "") — the early return should not double-set.
    const pendingIdx = loopPage.search(/pendingSpaceReresolveRef\.current\s*\)/);
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    // The early return block (from `if (pendingSpaceReresolveRef.current)` up to its `return;`)
    // should not contain setWorkspaceContext (it delegates to reResolveSpace).
    const after = loopPage.slice(pendingIdx);
    const returnIdx = after.indexOf('return;');
    const earlyBlock = after.slice(0, returnIdx + 7);
    // reResolveSpace call is the only action here; no direct setWorkspaceContext.
    expect(earlyBlock).toMatch(/reResolveSpace\(\s*\)/);
    // Count setWorkspaceContext in this block: it should be 0 (reResolveSpace sets "" internally,
    // but that's in a separate function, not inlined here).
    const inlineSets = (earlyBlock.match(/setWorkspaceContext\(/g) || []).length;
    expect(inlineSets).toBe(0);
  });
});

describe('PersonalPage — clear selectedWsRef on nav-menu-activated to follow Loop workspace', () => {
  let personalPage: string;

  beforeAll(() => {
    personalPage = fs.readFileSync(
      path.join(__dirname, '../../../../packages/dmpersonal/src/bridge/usePersonalWorkspace.tsx'),
      'utf-8',
    );
  });

  it('onNavMenuActivated clears selectedWsRef before resolveRef', () => {
    // Find the wk:nav-menu-activated handler in Personal (different from the one in Loop).
    const handlerStart = personalPage.search(/const\s+onNavMenuActivated\s*=\s*\(\{[^}]*menuId[^}]*\}/);
    expect(handlerStart).toBeGreaterThanOrEqual(0);

    const afterDecl = personalPage.slice(handlerStart);
    const handlerEnd = afterDecl.search(/mittBus\.on\(\s*["']wk:nav-menu-activated["']/);
    const handlerBody = handlerEnd > 0 ? afterDecl.slice(0, handlerEnd) : afterDecl;

    // Must clear selectedWsRef so targetId falls back to currentWorkspaceId() (= Loop's current ws).
    expect(handlerBody).toMatch(/selectedWsRef\.current\s*=\s*null/);

    // The clear must precede resolveRef.current(true) so that resolveAndPaint reads a null ref.
    const clearIdx = handlerBody.search(/selectedWsRef\.current\s*=\s*null/);
    const resolveIdx = handlerBody.search(/resolveRef\.current\(\s*true\s*\)/);
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(resolveIdx).toBeGreaterThan(0);
    expect(clearIdx).toBeLessThan(resolveIdx);
  });
});
