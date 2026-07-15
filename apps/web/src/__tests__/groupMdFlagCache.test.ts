import { describe, it, expect } from "vitest";

// Import the production pure function directly (no barrel — mdFlagCache.ts has no
// heavy deps), so this test exercises the real field-mapping logic, not a copy.
import { withMdFlags } from "../../../../packages/dmworkbase/src/Components/GroupMdEditor/mdFlagCache";

describe("withMdFlags: group channel", () => {
  it("writes has_group_md / group_md_version at root level on save (configured)", () => {
    const next = withMdFlags({ displayName: "g" }, false, true, 5);
    expect(next.has_group_md).toBe(true);
    expect(next.group_md_version).toBe(5);
    expect(next.displayName).toBe("g"); // preserves unrelated fields
  });

  it("clears has_group_md / group_md_version on delete", () => {
    const next = withMdFlags({ has_group_md: true, group_md_version: 9 }, false, false, 0);
    expect(next.has_group_md).toBe(false);
    expect(next.group_md_version).toBe(0);
  });

  it("does not touch thread fields for a group channel", () => {
    const next = withMdFlags({}, false, true, 1);
    expect(next.has_thread_md).toBeUndefined();
    expect(next.thread_md_version).toBeUndefined();
    expect(next.thread).toBeUndefined();
  });
});

describe("withMdFlags: thread channel", () => {
  it("writes has_thread_md / thread_md_version at root AND nested thread on save", () => {
    const orgData = {
      displayName: "t",
      thread: { name: "t", status: 1, has_thread_md: false, thread_md_version: 0 },
    };
    const next = withMdFlags(orgData, true, true, 3);
    // root level (what the panel subtitle reads)
    expect(next.has_thread_md).toBe(true);
    expect(next.thread_md_version).toBe(3);
    // nested thread object kept in sync (cache internal consistency)
    const thread = next.thread as Record<string, unknown>;
    expect(thread.has_thread_md).toBe(true);
    expect(thread.thread_md_version).toBe(3);
    expect(thread.name).toBe("t"); // preserves unrelated nested fields
    expect(thread.status).toBe(1);
  });

  it("clears root and nested flags on delete", () => {
    const orgData = {
      thread: { has_thread_md: true, thread_md_version: 7 },
    };
    const next = withMdFlags(orgData, true, false, 0);
    expect(next.has_thread_md).toBe(false);
    expect(next.thread_md_version).toBe(0);
    const thread = next.thread as Record<string, unknown>;
    expect(thread.has_thread_md).toBe(false);
    expect(thread.thread_md_version).toBe(0);
  });

  it("does not throw when the nested thread object is absent", () => {
    const next = withMdFlags({ displayName: "t" }, true, true, 2);
    expect(next.has_thread_md).toBe(true);
    expect(next.thread_md_version).toBe(2);
    expect(next.thread).toBeUndefined();
  });

  it("does not touch group fields for a thread channel", () => {
    const next = withMdFlags({}, true, true, 1);
    expect(next.has_group_md).toBeUndefined();
    expect(next.group_md_version).toBeUndefined();
  });
});

describe("withMdFlags: immutability", () => {
  it("does not mutate the input orgData (root)", () => {
    const orgData = { has_group_md: false, group_md_version: 0 };
    const next = withMdFlags(orgData, false, true, 4);
    expect(orgData.has_group_md).toBe(false); // input untouched
    expect(orgData.group_md_version).toBe(0);
    expect(next).not.toBe(orgData); // new object returned
  });

  it("does not mutate the input nested thread object", () => {
    const thread = { has_thread_md: false, thread_md_version: 0 };
    const orgData = { thread };
    const next = withMdFlags(orgData, true, true, 6);
    expect(thread.has_thread_md).toBe(false); // nested input untouched
    expect(thread.thread_md_version).toBe(0);
    expect(next.thread).not.toBe(thread); // new nested object returned
  });
});
