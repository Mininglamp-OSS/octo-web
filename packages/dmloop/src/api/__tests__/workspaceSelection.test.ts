import { describe, expect, it } from "vitest";

import { resolveWorkspaceSelection, runtimeListPath } from "../workspaceSelection";
import type { Workspace } from "../types";

const ws = (id: string, slug: string): Workspace => ({ id, name: slug, slug } as Workspace);

describe("resolveWorkspaceSelection", () => {
  it("returns machine mode when there are no workspaces", () => {
    expect(resolveWorkspaceSelection([], "")).toEqual({ mode: "machine" });
  });
  it("picks the current workspace when present", () => {
    expect(resolveWorkspaceSelection([ws("a", "alpha"), ws("b", "beta")], "b")).toEqual({
      mode: "workspace",
      slug: "beta",
      id: "b",
    });
  });
  it("falls back to the first workspace when current id is absent", () => {
    expect(resolveWorkspaceSelection([ws("a", "alpha"), ws("b", "beta")], "zzz")).toEqual({
      mode: "workspace",
      slug: "alpha",
      id: "a",
    });
  });
});

describe("runtimeListPath", () => {
  it("uses the workspace-scoped endpoint when a slug is present", () => {
    expect(runtimeListPath("alpha")).toBe("/runtimes");
  });
  it("uses the auth-only machine endpoint when there is no slug", () => {
    expect(runtimeListPath("")).toBe("/machine-runtimes");
  });
});
