import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildFleetIssueDeepLink,
  consumePendingLoopIssueDeepLink,
  normalizeCurrentLoopIssueDeepLink,
  parseLoopIssueDeepLink,
  readPendingLoopIssueDeepLink,
  pushFleetIssueDeepLink,
  replaceFleetIssueDeepLink,
  replaceLoopRootPath,
  savePendingLoopIssueDeepLink,
} from "../../../../packages/dmloop/src/issueDeepLink";

describe("Loop issue deep links", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("builds and parses agent-friendly fleet issue paths", () => {
    const path = buildFleetIssueDeepLink("hmhsiyou-r7xw", "HMH-3");
    expect(path).toBe("/fleet/hmhsiyou-r7xw/issues/HMH-3");
    expect(parseLoopIssueDeepLink(path)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-3",
    });
    expect(parseLoopIssueDeepLink("/loop")).toBeNull();
    expect(parseLoopIssueDeepLink("/loop/issue/ws-1/issue-1")).toBeNull();
  });

  it("stores and consumes a pending deep link once", () => {
    savePendingLoopIssueDeepLink(
      {
        workspaceSlug: "hmhsiyou-r7xw",
        issueIdentifier: "HMH-3",
      },
      sessionStorage
    );

    expect(readPendingLoopIssueDeepLink(sessionStorage)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-3",
    });
    expect(consumePendingLoopIssueDeepLink(sessionStorage)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-3",
    });
    expect(readPendingLoopIssueDeepLink(sessionStorage)).toBeNull();
  });

  it("keeps a pending target in memory when sessionStorage is unavailable", () => {
    const unavailableStore = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(() =>
      savePendingLoopIssueDeepLink(
        {
          workspaceSlug: "hmhsiyou-r7xw",
          issueIdentifier: "HMH-4",
        },
        unavailableStore
      )
    ).toThrow("storage unavailable");

    expect(readPendingLoopIssueDeepLink(unavailableStore)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-4",
    });
    expect(consumePendingLoopIssueDeepLink(unavailableStore)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-4",
    });
    expect(readPendingLoopIssueDeepLink(unavailableStore)).toBeNull();
  });

  it("normalizes a cold issue path to the loop route and stores the target", () => {
    window.history.replaceState({}, "", "/fleet/hmhsiyou-r7xw/issues/HMH-3");

    expect(normalizeCurrentLoopIssueDeepLink()).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-3",
    });
    expect(window.location.pathname).toBe("/loop");
    expect(readPendingLoopIssueDeepLink(sessionStorage)).toMatchObject({
      workspaceSlug: "hmhsiyou-r7xw",
      issueIdentifier: "HMH-3",
    });
  });

  it("writes browser URLs without adding sid query parameters", () => {
    pushFleetIssueDeepLink("hmhsiyou-r7xw", "HMH-3");
    expect(window.location.pathname).toBe("/fleet/hmhsiyou-r7xw/issues/HMH-3");
    expect(window.location.search).toBe("");

    replaceFleetIssueDeepLink("demo", "DMO-1");
    expect(window.location.pathname).toBe("/fleet/demo/issues/DMO-1");

    replaceLoopRootPath();
    expect(window.location.pathname).toBe("/loop");
  });

  it("wires module capture, workspace restore, and issue click URL updates", () => {
    const root = path.join(__dirname, "../../../../packages/dmloop/src");
    const moduleSource = fs.readFileSync(path.join(root, "module.tsx"), "utf-8");
    const bridgeSource = fs.readFileSync(
      path.join(root, "bridge/useLoopWorkspace.tsx"),
      "utf-8"
    );
    const issuePageSource = fs.readFileSync(
      path.join(root, "pages/IssuePage.tsx"),
      "utf-8"
    );

    expect(moduleSource).toContain("normalizeCurrentLoopIssueDeepLink()");
    expect(bridgeSource).toContain("consumePendingLoopIssueDeepLink");
    expect(bridgeSource).toContain("readPendingLoopIssueDeepLink");
    expect(bridgeSource).toContain("if (applyPendingIssueDeepLink(list)) return;");
    expect(bridgeSource).toContain("resolveIssueByIdentifier");
    expect(bridgeSource).toContain("const spaceSeq = spaceResolveSeqRef.current;");
    expect(bridgeSource).toContain("const paneSeq = paneResolveSeqRef.current;");
    expect(bridgeSource).toContain("if (!canWriteLoopPane(spaceSeq, paneSeq)) return;");
    expect(bridgeSource).toContain("paneResolveSeqRef.current += 1;");
    expect(bridgeSource).toContain('WKApp.currentMenuId !== "loop"');
    expect(bridgeSource).toContain("replaceFleetIssueDeepLink(workspace.slug, issue.identifier)");
    expect(bridgeSource).toContain("return false;");
    expect(bridgeSource).toContain("replaceLoopRootPath()");
    expect(issuePageSource).toContain("pushFleetIssueDeepLink(workspaceSlug, issue.identifier)");
  });
});
