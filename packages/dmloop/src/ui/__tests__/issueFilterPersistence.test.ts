import { describe, expect, it } from "vitest";

import {
  defaultIssueFilters,
  type IssueFilterReader,
  type IssueFilterWriter,
  issueFilterOptionIds,
  issueFilterStorageKey,
  readIssueFilterState,
  reconcileIssueFilters,
  writeIssueFilterState,
} from "../issueFilterPersistence";

class MemoryStorage implements IssueFilterReader, IssueFilterWriter {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("issue filter persistence", () => {
  it("uses a workspace-scoped key", () => {
    expect(issueFilterStorageKey("alpha", "loop.view.issue")).toBe(
      "loop.issue.filters:loop.view.issue:alpha"
    );
    expect(issueFilterStorageKey("", "loop.view.issue")).toBeNull();
    expect(issueFilterStorageKey("alpha")).toBeNull();
  });

  it("round-trips valid filters and scope", () => {
    const storage = new MemoryStorage();
    const key = issueFilterStorageKey("alpha", "loop.view.issue");
    writeIssueFilterState(
      storage,
      key,
      {
        scope: "agents",
        filters: {
          ...defaultIssueFilters(),
          keyword: "deploy",
          statuses: ["todo"],
          priorities: ["high"],
          assigneeIds: ["a1"],
          projectIds: ["p1"],
          dateRange: [
            new Date("2026-07-01T00:00:00.000Z"),
            new Date("2026-07-02T00:00:00.000Z"),
          ],
        },
      },
      false
    );

    const restored = readIssueFilterState(storage, key, "all", false);
    expect(restored.scope).toBe("agents");
    expect(restored.filters.keyword).toBe("deploy");
    expect(restored.filters.statuses).toEqual(["todo"]);
    expect(restored.filters.priorities).toEqual(["high"]);
    expect(restored.filters.assigneeIds).toEqual(["a1"]);
    expect(restored.filters.projectIds).toEqual(["p1"]);
    expect(restored.filters.dateRange?.map((d) => d.toISOString())).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    ]);
  });

  it("falls back on malformed or invalid storage data", () => {
    const storage = new MemoryStorage();
    const key = "filters";
    storage.setItem(key, "{bad json");
    expect(readIssueFilterState(storage, key, "members", false)).toEqual({
      filters: defaultIssueFilters(),
      scope: "members",
    });

    storage.setItem(
      key,
      JSON.stringify({
        filters: {
          statuses: ["todo", "missing"],
          priorities: ["high", "missing"],
          dateField: "bad",
          dateRange: ["2026-07-02T00:00:00.000Z", "2026-07-01T00:00:00.000Z"],
        },
        scope: "bad",
      })
    );
    expect(readIssueFilterState(storage, key, "all", false)).toEqual({
      filters: {
        ...defaultIssueFilters(),
        statuses: ["todo"],
        priorities: ["high"],
      },
      scope: "all",
    });
  });

  it("removes the item when filters are cleared back to defaults", () => {
    const storage = new MemoryStorage();
    const key = "filters";
    writeIssueFilterState(
      storage,
      key,
      { filters: { ...defaultIssueFilters(), keyword: "x" }, scope: "all" },
      false
    );
    expect(storage.getItem(key)).not.toBeNull();

    writeIssueFilterState(
      storage,
      key,
      { filters: defaultIssueFilters(), scope: "all" },
      false
    );
    expect(storage.getItem(key)).toBeNull();
  });

  it("keeps only the intersection of persisted ids and current component options", () => {
    const filters = {
      ...defaultIssueFilters(),
      assigneeIds: ["a1", "stale-a"],
      creatorIds: ["c1", "stale-c"],
      projectIds: ["p1", "stale-p"],
      labelIds: ["l1", "stale-l"],
    };

    expect(
      reconcileIssueFilters(
        filters,
        {
          assigneeIds: ["a1"],
          creatorIds: ["c1"],
          projectIds: ["p1"],
          labelIds: ["l1"],
        },
        false
      )
    ).toEqual({
      ...filters,
      assigneeIds: ["a1"],
      creatorIds: ["c1"],
      projectIds: ["p1"],
      labelIds: ["l1"],
    });
  });

  it("preserves stored ids when option requests did not succeed", () => {
    const filters = {
      ...defaultIssueFilters(),
      assigneeIds: ["a1"],
      creatorIds: ["c1"],
      projectIds: ["p1"],
      labelIds: ["l1"],
    };

    expect(reconcileIssueFilters(filters, {}, false)).toBe(filters);
  });

  it("does not turn completed failed option loads into empty authoritative lists", () => {
    expect(
      issueFilterOptionIds({
        candidates: [],
        candidatesLoaded: true,
        candidatesSucceeded: false,
        projects: [],
        projectsLoaded: true,
        projectsSucceeded: false,
        labels: [],
        labelsLoaded: true,
        labelsSucceeded: false,
      })
    ).toEqual({
      assigneeIds: undefined,
      creatorIds: undefined,
      projectIds: undefined,
      labelIds: undefined,
    });
  });

  it("builds authoritative option ids only after successful option loads", () => {
    expect(
      issueFilterOptionIds({
        candidates: [
          { id: "m1", type: "member", name: "M" },
          { id: "a1", type: "agent", name: "A" },
        ],
        candidatesLoaded: true,
        candidatesSucceeded: true,
        projects: [{ id: "p1" }],
        projectsLoaded: true,
        projectsSucceeded: true,
        labels: [{ id: "l1", name: "L", color: "#fff" }],
        labelsLoaded: true,
        labelsSucceeded: true,
      })
    ).toEqual({
      assigneeIds: ["m1", "a1"],
      creatorIds: ["m1"],
      projectIds: ["p1"],
      labelIds: ["l1"],
    });
  });

  it("does not restore My Loop scope on the normal issue page", () => {
    const storage = new MemoryStorage();
    const key = "filters";
    storage.setItem(
      key,
      JSON.stringify({
        filters: { statuses: ["todo"] },
        scope: "involves",
      })
    );

    expect(readIssueFilterState(storage, key, "all", false)).toEqual({
      filters: { ...defaultIssueFilters(), statuses: ["todo"] },
      scope: "all",
    });
  });

  it("drops filters that do not apply to My Loop", () => {
    const storage = new MemoryStorage();
    const key = "filters";
    storage.setItem(
      key,
      JSON.stringify({
        filters: {
          keyword: "ignored",
          assigneeIds: ["a1"],
          noAssignee: true,
          creatorIds: ["c1"],
          statuses: ["todo"],
        },
        scope: "agents",
      })
    );

    const restored = readIssueFilterState(storage, key, "involves", true);
    expect(restored).toEqual({
      filters: { ...defaultIssueFilters(), statuses: ["todo"] },
      scope: "involves",
    });
  });
});
