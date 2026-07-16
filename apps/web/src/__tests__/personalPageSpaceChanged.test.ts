import * as fs from 'fs';
import * as path from 'path';

// Extract the body of the space-changed handler: from `const onSpaceChanged =`
// up to the `mittBus.on("space-changed"` registration that follows it. Bounding
// on the registration line (not a fixed char window) keeps these assertions
// stable as the handler grows with comments/guards.
function onSpaceChangedBody(src: string): string {
  const start = src.search(/const\s+onSpaceChanged\s*=/);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = rest.search(/mittBus\.on\(\s*["']space-changed["']/);
  return end < 0 ? rest : rest.slice(0, end);
}

// LoopPage's actual re-resolve logic lives in reResolveSpace (shared by the
// space-changed handler and reactivation). Extract its body for assertions.
function reResolveSpaceBody(src: string): string {
  const start = src.search(/const\s+reResolveSpace\s*=/);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = rest.search(/\n  const\s+\w+\s*=|\n  useEffect\(/);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Switching octo space must refresh the Personal (我的/运行时) right pane.
 *
 * PersonalPage keeps a page-local workspace selection (selectedWsRef +
 * @octo/loop's module-level workspace globals). When the user switches octo
 * space, MainPage emits mittBus('space-changed'), but the page previously only
 * re-resolved on mount and on 'wk:nav-menu-activated'. So after a space switch
 * the pane kept the PREVIOUS space's workspace context and issued
 * workspace-scoped requests against the new space — the backend space-isolation
 * gate then rejected them ("workspace does not belong to this space" /
 * "not a member of this space") instead of the page showing the correct empty
 * (machine-mode) state with an "add computer" prompt.
 *
 * resolveAndPaint already handles the new space correctly: it re-lists
 * workspaces and, when the new space has none, falls into machine mode
 * (clears the workspace scope, lists /machine-runtimes, disables Skills). The
 * fix is simply to trigger that re-resolution on 'space-changed' too.
 */
describe('PersonalPage — re-resolve workspace on space switch', () => {
  let personalPage: string;

  beforeAll(() => {
    personalPage = fs.readFileSync(
      path.join(__dirname, '../../../../packages/dmpersonal/src/PersonalPage.tsx'),
      'utf-8',
    );
  });

  it('subscribes to the space-changed mittBus event', () => {
    expect(personalPage).toMatch(/mittBus\.on\(\s*["']space-changed["']/);
  });

  it('re-resolves the workspace selection when space-changed fires', () => {
    // The space-changed handler must call resolveRef.current(...) so the pane
    // re-lists workspaces for the new space (and falls into machine mode when
    // the new space has none), rather than reusing the old space's workspace.
    // Anchor on the handler declaration, then assert the body re-resolves.
    const handlerIdx = personalPage.search(/const\s+onSpaceChanged\s*=/);
    expect(handlerIdx).toBeGreaterThanOrEqual(0);
    expect(onSpaceChangedBody(personalPage)).toMatch(/resolveRef\.current\(/);
  });

  it('resets all three workspace states before re-resolving', () => {
    // The three workspace states are separate and must all be cleared, or a tab
    // click during the re-resolve loading window re-issues a request with the
    // previous space's workspace scope and hits the backend isolation gate (403):
    //  - selectedWsRef (page-local, preferred over the shared global)
    //  - machineModeRef (drives openTab's branch)
    //  - setWorkspaceContext("","") (@octo/loop http-layer module-level slug/id)
    // They must also come BEFORE the re-resolve call — moving the re-resolve
    // ahead of the clears would reopen the bug, so assert order too.
    const handlerIdx = personalPage.search(/const\s+onSpaceChanged\s*=/);
    expect(handlerIdx).toBeGreaterThanOrEqual(0);
    const body = onSpaceChangedBody(personalPage);
    expect(body).toMatch(/selectedWsRef\.current\s*=\s*null/);
    expect(body).toMatch(/machineModeRef\.current\s*=\s*false/);
    expect(body).toMatch(/setWorkspaceContext\(\s*["']["']\s*,\s*["']["']\s*\)/);
    // Each clear must precede the resolveRef.current(...) CALL. Anchor on a
    // statement line (newline + indent) so a comment mention doesn't match.
    const resolveIdx = body.search(/\n\s*resolveRef\.current\(/);
    expect(resolveIdx).toBeGreaterThan(0);
    expect(body.search(/selectedWsRef\.current\s*=\s*null/)).toBeLessThan(resolveIdx);
    expect(body.search(/machineModeRef\.current\s*=\s*false/)).toBeLessThan(resolveIdx);
    expect(body.search(/setWorkspaceContext\(\s*["']["']/)).toBeLessThan(resolveIdx);
  });

  it('unsubscribes the space-changed handler on cleanup', () => {
    expect(personalPage).toMatch(/mittBus\.off\(\s*["']space-changed["']/);
  });

  it('gates the re-resolve window by marking workspace not-ready', () => {
    // openTab bails on !workspaceReady; the handler must flip it false during the
    // window so the Skills/runtime tabs cannot open against the old space's scope.
    expect(onSpaceChangedBody(personalPage)).toMatch(/setWorkspaceReady\(\s*false\s*\)/);
  });

  it('only re-resolves when it is the active menu (no shared-pane fight)', () => {
    // PersonalPage and LoopPage share the single routeRight and stay mounted; a
    // backgrounded page must not touch the shared pane/context on space-changed.
    // PersonalPage re-resolves lazily on reactivation (nav-menu-activated →
    // resolveRef), so gating out when backgrounded is sufficient.
    expect(onSpaceChangedBody(personalPage)).toMatch(/WKApp\.currentMenuId\s*!==\s*["']dmpersonal["']/);
  });

  it('resets private state + drops ready when backgrounded (gated reactivation window)', () => {
    // The backgrounded branch must NOT clear the shared http context (would wipe
    // the active page's slug), but must reset its own private state and drop
    // workspaceReady so the reactivation window is gated (openTab bails) instead
    // of letting a click write the old space's slug back → 403.
    const body = onSpaceChangedBody(personalPage);
    const guardIdx = body.search(/WKApp\.currentMenuId\s*!==\s*["']dmpersonal["']/);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    const afterGuard = body.slice(guardIdx);
    const bgBranch = afterGuard.slice(0, afterGuard.search(/return;/) + 7);
    expect(bgBranch).toMatch(/setWorkspaceReady\(\s*false\s*\)/);
    expect(bgBranch).toMatch(/selectedWsRef\.current\s*=\s*null/);
    expect(bgBranch).not.toMatch(/setWorkspaceContext\(/);
  });

  it('resolveAndPaint bails on shared writes when backgrounded', () => {
    // Any async resolve that lands after the user navigated away must not write
    // the shared pane/context. resolveAndPaint's .then and .catch re-check the
    // active menu (after the seq/mounted guard) before touching them.
    const start = personalPage.search(/const\s+resolveAndPaint\s*=/);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = personalPage.slice(start).search(/\n  const\s+\w+\s*=|\n  useEffect\(/);
    const body = end < 0 ? personalPage.slice(start) : personalPage.slice(start, start + end);
    const checks = (body.match(/WKApp\.currentMenuId\s*!==\s*["']dmpersonal["']/g) || []).length;
    expect(checks).toBeGreaterThanOrEqual(2); // .then and .catch
  });
});

/**
 * LoopPage (回路) has the SAME root cause as PersonalPage: it only re-lists
 * workspaces on mount (deps []) and on 'wk:nav-menu-activated', not on
 * 'space-changed'. After switching octo space the 回路 page kept the previous
 * space's wsId + @octo/loop http-layer workspace slug and issued
 * workspace-scoped requests against the new space, producing the stacked
 * "加载失败" toasts. It must also re-resolve on 'space-changed'.
 */
describe('LoopPage — re-resolve workspace on space switch', () => {
  let loopPage: string;

  beforeAll(() => {
    loopPage = fs.readFileSync(
      path.join(__dirname, '../../../../packages/dmloop/src/pages/LoopPage.tsx'),
      'utf-8',
    );
  });

  it('subscribes to the space-changed mittBus event', () => {
    expect(loopPage).toMatch(/mittBus\.on\(\s*["']space-changed["']/);
  });

  it('clears the http-layer workspace scope before re-listing', () => {
    // Clearing setWorkspaceContext("","") first prevents any request during the
    // re-list window from carrying the old space's workspace slug (which would
    // hit the backend isolation gate). It must precede listWorkspaces().
    const body = reResolveSpaceBody(loopPage);
    expect(body).toMatch(/setWorkspaceContext\(\s*["']["']\s*,\s*["']["']\s*\)/);
    expect(body).toMatch(/listWorkspaces\(/);
    expect(body.search(/setWorkspaceContext\(\s*["']["']/)).toBeLessThan(body.search(/listWorkspaces\(/));
  });

  it('guards the re-resolve against out-of-order responses (seq guard)', () => {
    // Fast consecutive space switches race their listWorkspaces() responses; a
    // stale one landing last would write the old slug back and re-trigger 403.
    // Only the latest resolve may apply — assert a seq/generation guard exists.
    const body = reResolveSpaceBody(loopPage);
    expect(body).toMatch(/spaceResolveSeqRef/);
    // The .then must bail when its captured seq is no longer current.
    expect(body).toMatch(/!==\s*spaceResolveSeqRef\.current/);
  });

  it('only re-resolves when it is the active menu; defers when backgrounded', () => {
    // Both LoopPage and PersonalPage write the single shared routeRight and stay
    // mounted. The space-changed handler must not repaint the pane when the page
    // is backgrounded (that clobbers the active page); it flags a pending
    // re-resolve that reactivation consumes.
    const body = onSpaceChangedBody(loopPage);
    expect(body).toMatch(/WKApp\.currentMenuId\s*!==\s*["']loop["']/);
    expect(body).toMatch(/pendingSpaceReresolveRef\.current\s*=\s*true/);
    // Reactivation (nav-menu-activated) consumes the pending flag and re-resolves.
    expect(loopPage).toMatch(/if\s*\(\s*pendingSpaceReresolveRef\.current\s*\)/);
    // The resolve callbacks re-check the active menu before writing the shared
    // pane/context — an in-flight resolve that lands after navigating away must
    // defer (set pending) instead of clobbering the now-active page.
    const rr = reResolveSpaceBody(loopPage);
    const menuChecks = (rr.match(/WKApp\.currentMenuId\s*!==\s*["']loop["']/g) || []).length;
    expect(menuChecks).toBeGreaterThanOrEqual(2); // .then and .catch
  });

  it('renders the current tab (not a frozen mount-time tab) after re-resolve', () => {
    // applyWorkspace runs from a mount-once (deps []) handler; it must read the
    // live tab via a ref, else switching space while on a non-issue tab paints
    // the wrong pane. Assert applyWorkspace renders via tabRef, not closure tab.
    expect(loopPage).toMatch(/renderTab\(\s*tabRef\.current/);
  });

  it('guards the mount initial resolve with the same seq (cross-entry race)', () => {
    // If the mount listWorkspaces is still in flight when the user switches
    // space, the stale mount response must be discarded too — otherwise it
    // writes the old space's slug back and re-triggers 403. The mount effect
    // must join the same spaceResolveSeqRef domain.
    // Both the mount effect and the space-changed handler bump the seq...
    const bumps = loopPage.match(/\+\+\s*spaceResolveSeqRef\.current/g) || [];
    expect(bumps.length).toBeGreaterThanOrEqual(2);
    // ...and there must be at least two guarded bail-outs (mount + space-changed).
    const guards = loopPage.match(/!==\s*spaceResolveSeqRef\.current/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('gates the click entries during the re-resolve window (!loaded)', () => {
    // setLoaded(false) alone only gates wk:nav-menu-activated. The direct click
    // entries (openTab / switchWorkspace / openNewLoop) must also bail while the
    // window is open, or a click there uses the old space's workspaces/slug.
    const openTabBody = loopPage.slice(loopPage.search(/const\s+openTab\s*=/), loopPage.search(/const\s+openTab\s*=/) + 200);
    expect(openTabBody).toMatch(/if\s*\(\s*!loaded\s*\)\s*return/);
    const switchBody = loopPage.slice(loopPage.search(/const\s+switchWorkspace\s*=/), loopPage.search(/const\s+switchWorkspace\s*=/) + 200);
    expect(switchBody).toMatch(/if\s*\(\s*!loaded\s*\)\s*return/);
    const newLoopBody = loopPage.slice(loopPage.search(/const\s+openNewLoop\s*=/), loopPage.search(/const\s+openNewLoop\s*=/) + 120);
    expect(newLoopBody).toMatch(/if\s*\(\s*!loaded\s*\)\s*return/);
  });

  it('unsubscribes the space-changed handler on cleanup', () => {
    expect(loopPage).toMatch(/mittBus\.off\(\s*["']space-changed["']/);
  });

  it('unmounts the stale right pane during the re-resolve window', () => {
    // The previous space's IssuePage keeps polling until unmounted; the resolve
    // must replace the right pane before awaiting the new list.
    const body = reResolveSpaceBody(loopPage);
    expect(body).toMatch(/routeRight\.replaceToRoot/);
    expect(body.search(/routeRight\.replaceToRoot/)).toBeLessThan(body.search(/listWorkspaces\(/));
  });

  it('guards doCreateWs against a space switch mid-create without wedging loaded', () => {
    // doCreateWs writes workspace context after awaits, so it must drop that
    // write when a space switch happened during creation. It CAPTURES the
    // generation (does not bump it): bumping would invalidate onSpaceChanged's
    // own resolve, whose .then/.catch are the only paths that restore loaded —
    // leaving the page stuck !loaded. So: a stale-seq guard must exist, but no
    // ++ bump inside doCreateWs.
    const start = loopPage.search(/const\s+doCreateWs\s*=/);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = loopPage.slice(start).search(/\n  const\s+\w+\s*=/);
    const body = end < 0 ? loopPage.slice(start) : loopPage.slice(start, start + end);
    expect(body).toMatch(/const\s+seq\s*=\s*spaceResolveSeqRef\.current/); // capture
    expect(body).not.toMatch(/\+\+\s*spaceResolveSeqRef\.current/);        // never bump
    expect(body).toMatch(/!==\s*spaceResolveSeqRef\.current/);             // still guarded
    // And it must also bail on shared writes if navigated away mid-create
    // (no space-changed → seq unchanged, so the seq guard alone is insufficient).
    expect(body).toMatch(/WKApp\.currentMenuId\s*!==\s*["']loop["']/);
  });

  it('gates workspace-create entry on !loaded and closes modals on space switch', () => {
    // Create entry must be blocked during the re-resolve window, and any open
    // create modal must close on space-changed, so no create can land while the
    // page is re-resolving a new space.
    const openBody = loopPage.slice(loopPage.search(/const\s+openCreateWs\s*=/), loopPage.search(/const\s+openCreateWs\s*=/) + 160);
    expect(openBody).toMatch(/if\s*\(\s*!loaded\s*\)\s*return/);
    const onSpaceBody = reResolveSpaceBody(loopPage);
    expect(onSpaceBody).toMatch(/setWsModalOpen\(\s*false\s*\)/);
  });

  it('clears the workspace list on a failed re-resolve (no stale clickable dropdown)', () => {
    // showEmptyGuide only repaints the right pane; without setWorkspaces([]) in
    // the .catch branches, a failed listWorkspaces() during a space switch leaves
    // the old space's workspaces in the switcher dropdown — re-enabled by
    // setLoaded(true) and still clickable → switchWorkspace binds an old-space
    // slug under the new space → cross-space 403. Both resolve paths (mount +
    // space-changed) must clear the list on error.
    const catchBlocks = loopPage.match(/\.catch\(\(\)\s*=>\s*\{[\s\S]*?\}\)/g) || [];
    const resolveCatches = catchBlocks.filter((b) => b.includes('showEmptyGuide'));
    expect(resolveCatches.length).toBeGreaterThanOrEqual(2);
    for (const b of resolveCatches) {
      expect(b).toMatch(/setWorkspaces\(\s*\[\s*\]\s*\)/);
    }
  });
});

/**
 * The agent runtime picker must not offer runtimes the CreateAgent write would
 * reject. Backend canBindRuntimeAsOwner is owner-only; the list endpoint now
 * returns can_bind per runtime, and the picker filters on it (forward-compat:
 * undefined from an older backend is kept, so the picker never goes empty).
 */
describe('AgentPage — runtime picker filters to bindable runtimes', () => {
  let agentPage: string;

  beforeAll(() => {
    agentPage = fs.readFileSync(
      path.join(__dirname, '../../../../packages/dmloop/src/pages/AgentPage.tsx'),
      'utf-8',
    );
  });

  it('drops runtimes explicitly marked can_bind === false', () => {
    expect(agentPage).toMatch(/can_bind\s*!==\s*false/);
  });
});
