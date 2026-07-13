import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// PR #554 RC blocker #2: content-tab panels for messages/files are all
// mounted at once and toggled via `display:none` (avoids remounting
// <img>/VisibilityTrigger on tab switch, keeps avatar HTTP cache warm).
// A hidden container reports scrollHeight/scrollTop/clientHeight = 0, so
// `isNearChannelSearchScrollBottom` reads "at the bottom" and triggers
// pagination in the background — for the files tab this walks the entire
// corpus even when the user is on the messages tab.
//
// Rendering the panel headless requires mocking a wide transitive graph
// (ChannelSearch/index → Conversation/context → Messages/*). Instead, this
// suite locks the fix in at the source level:
//   §A `GlobalContentSearchPanel` declares an `isActive` prop.
//   §B `canSearch` — the flag that gates the initial debounced fetch — is
//       ANDed with `isActive` so a hidden panel won't call
//       `dataSource.searchMessages` on mount / keyword change.
//   §C `runSearch` short-circuits when `!isActive`, guarding the case where
//       it's called through a stale closure.
//   §D `loadNextPage` short-circuits when `!isActive`, preventing hidden
//       panels from paginating themselves via the scrollHeight/scrollTop=0
//       "near bottom" false positive.
//   §E `index.tsx` threads `isActive` from the tab-selection state.

const panelPath = path.join(
  __dirname,
  "..",
  "GlobalContentSearchPanel.tsx"
);
const indexPath = path.join(__dirname, "..", "index.tsx");
const panelSrc = fs.readFileSync(panelPath, "utf8");
const indexSrc = fs.readFileSync(indexPath, "utf8");

describe("GlobalContentSearchPanel — isActive gate (source guard)", () => {
  it("§A declares an isActive prop on GlobalContentSearchPanelProps", () => {
    // Interface accepts optional isActive (default true in destructure).
    expect(panelSrc).toMatch(/isActive\?:\s*boolean/);
    // And the render function destructures it.
    expect(panelSrc).toMatch(/isActive\s*=\s*true/);
  });

  it("§B canSearch AND-gates on isActive", () => {
    // Guards the initial debounced fetch. Both the tab-appropriate predicate
    // AND panel visibility must agree before the panel talks to the server.
    expect(panelSrc).toMatch(
      /const\s+canSearch\s*=\s*shouldRunGlobalSearch\([^)]+\)\s*&&\s*isActive/
    );
  });

  it("§C runSearch bails out early when !isActive", () => {
    // Belt-and-suspenders: even if a stale closure invokes runSearch after
    // isActive flips false, no request is issued.
    const runSearchBlock = panelSrc.match(
      /const\s+runSearch\s*=\s*useCallback\(\s*async[^{]*\{[\s\S]*?\n\s{4}\}/
    );
    expect(runSearchBlock, "runSearch useCallback body must exist").toBeTruthy();
    expect(runSearchBlock![0]).toMatch(/if\s*\(\s*!isActive\s*\)\s*return/);
  });

  it("§D loadNextPage bails out early when !isActive", () => {
    // The scrollHeight=0 false positive on a display:none container flows
    // through loadNextPage; blocking here stops files-tab background paging.
    const loadNextBlock = panelSrc.match(
      /const\s+loadNextPage\s*=\s*useCallback\([\s\S]*?\n\s{4}\)/
    );
    expect(loadNextBlock, "loadNextPage useCallback must exist").toBeTruthy();
    expect(loadNextBlock![0]).toMatch(/if\s*\(\s*!isActive\s*\)\s*return/);
    // isActive must also appear in the dependency array so React re-derives
    // the callback when visibility changes.
    expect(loadNextBlock![0]).toMatch(/isActive[,)\s]/);
  });
});

describe("GlobalSearch index — threads isActive from tab state (§E)", () => {
  it("passes isActive={currentKey === 'messages'} to the messages panel", () => {
    expect(indexSrc).toMatch(
      /tab="messages"[\s\S]{0,300}isActive=\{\s*currentKey\s*===\s*"messages"\s*\}/
    );
  });

  it("passes isActive={currentKey === 'files'} to the files panel", () => {
    expect(indexSrc).toMatch(
      /tab="files"[\s\S]{0,300}isActive=\{\s*currentKey\s*===\s*"files"\s*\}/
    );
  });
});
