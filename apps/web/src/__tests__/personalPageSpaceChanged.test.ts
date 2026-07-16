import * as fs from 'fs';
import * as path from 'path';

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
    expect(personalPage.slice(handlerIdx, handlerIdx + 400)).toMatch(/resolveRef\.current\(/);
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
    const body = personalPage.slice(handlerIdx, handlerIdx + 400);
    expect(body).toMatch(/selectedWsRef\.current\s*=\s*null/);
    expect(body).toMatch(/machineModeRef\.current\s*=\s*false/);
    expect(body).toMatch(/setWorkspaceContext\(\s*["']["']\s*,\s*["']["']\s*\)/);
    // Each clear must precede resolveRef.current(...).
    const resolveIdx = body.search(/resolveRef\.current\(/);
    expect(resolveIdx).toBeGreaterThan(0);
    expect(body.search(/selectedWsRef\.current\s*=\s*null/)).toBeLessThan(resolveIdx);
    expect(body.search(/machineModeRef\.current\s*=\s*false/)).toBeLessThan(resolveIdx);
    expect(body.search(/setWorkspaceContext\(\s*["']["']/)).toBeLessThan(resolveIdx);
  });

  it('unsubscribes the space-changed handler on cleanup', () => {
    expect(personalPage).toMatch(/mittBus\.off\(\s*["']space-changed["']/);
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
    const handlerIdx = loopPage.search(/const\s+onSpaceChanged\s*=/);
    expect(handlerIdx).toBeGreaterThanOrEqual(0);
    const body = loopPage.slice(handlerIdx, handlerIdx + 600);
    expect(body).toMatch(/setWorkspaceContext\(\s*["']["']\s*,\s*["']["']\s*\)/);
    expect(body).toMatch(/listWorkspaces\(/);
    expect(body.search(/setWorkspaceContext\(\s*["']["']/)).toBeLessThan(body.search(/listWorkspaces\(/));
  });

  it('guards the re-resolve against out-of-order responses (seq guard)', () => {
    // Fast consecutive space switches race their listWorkspaces() responses; a
    // stale one landing last would write the old slug back and re-trigger 403.
    // Only the latest resolve may apply — assert a seq/generation guard exists.
    const handlerIdx = loopPage.search(/const\s+onSpaceChanged\s*=/);
    const body = loopPage.slice(handlerIdx, handlerIdx + 600);
    expect(body).toMatch(/spaceResolveSeqRef/);
    // The .then must bail when its captured seq is no longer current.
    expect(body).toMatch(/!==\s*spaceResolveSeqRef\.current/);
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
});
