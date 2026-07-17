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
//   §C the panel passes that gate into the shared pagination bridge.
//   §D the bridge short-circuits stale search callbacks when disabled.
//   §E `index.tsx` threads `isActive` from the tab-selection state.

const panelPath = path.join(__dirname, "..", "GlobalContentSearchPanel.tsx");
const indexPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "features",
  "globalSearch",
  "GlobalSearchPanel.tsx"
);
const paginationHookPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "bridge",
  "search",
  "useSearchPagination.ts"
);
const panelSrc = fs.readFileSync(panelPath, "utf8");
const indexSrc = fs.readFileSync(indexPath, "utf8");
const paginationHookSrc = fs.readFileSync(paginationHookPath, "utf8");

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

  it("§C passes the active search gate to the pagination bridge", () => {
    expect(panelSrc).toMatch(
      /useSearchPagination\(\{[\s\S]{0,160}enabled:\s*canSearch/
    );
  });

  it("§D shared pagination rejects stale work while disabled", () => {
    expect(paginationHookSrc).toMatch(/if\s*\(\s*!enabled\s*\|\|\s*\(cursor/);
    expect(paginationHookSrc).toMatch(/\[enabled,\s*errorMessage,\s*search\]/);
  });
});

describe("GlobalSearch index — threads isActive from tab state (§E)", () => {
  it("passes isActive={currentKey === 'messages'} to the messages panel", () => {
    expect(indexSrc).toMatch(
      /<GlobalChatSearchPanel[\s\S]{0,300}isActive=\{\s*currentKey\s*===\s*"messages"\s*\}/
    );
  });

  it("shares one filter state and trigger across messages and files", () => {
    expect(indexSrc).toMatch(
      /vm\.selectedTabKey\s*===\s*"messages"\s*\|\|\s*vm\.selectedTabKey\s*===\s*"files"/
    );
    expect(indexSrc).toContain("wk-search-tabs__filter-trigger");
    expect(indexSrc).toMatch(
      /<GlobalChatSearchPanel[\s\S]{0,500}filters=\{this\.state\.filters\}/
    );
    expect(indexSrc).toMatch(
      /<GlobalContentSearchPanel[\s\S]{0,500}filters=\{this\.state\.filters\}/
    );
    expect(indexSrc.match(/<GlobalSearchFilterPanel\b/g)).toHaveLength(1);
    expect(indexSrc).toMatch(
      /tab=\{currentKey\s*===\s*"files"\s*\?\s*"files"\s*:\s*"messages"\}/
    );
  });

  it("passes isActive={currentKey === 'files'} to the files panel", () => {
    expect(indexSrc).toMatch(
      /tab="files"[\s\S]{0,300}isActive=\{\s*currentKey\s*===\s*"files"\s*\}/
    );
  });
});
