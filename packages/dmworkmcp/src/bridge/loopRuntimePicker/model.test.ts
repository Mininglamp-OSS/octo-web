import { describe, expect, it, vi } from "vitest";
vi.mock("@octo/base", () => ({ t: (key: string) => key }));
import { buildRuntimeGroups, canInstallRuntime, isRuntimeReady } from "./model";
import type { LoopRuntime } from "../../api/expertService";
const runtime = (data: Partial<LoopRuntime>): LoopRuntime => ({
  id: "rt",
  name: "Codex (localhost)",
  provider: "codex",
  status: "online",
  deviceInfo: "localhost · codex-cli 0.164",
  canBind: true,
  ...data,
});

describe("owned runtime presentation", () => {
  it("keeps equal hostnames on separate machines, including colliding short IDs", () => {
    const groups = buildRuntimeGroups([
      runtime({ id: "a", daemonId: "one-12345678" }),
      runtime({ id: "b", daemonId: "two-12345678" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).not.toBe(groups[1].label);
    expect(groups[0].items[0].name).toBe("Codex");
    expect(groups[0].items[0].version).toBe("codex-cli 0.164");
  });
  it("does not merge legacy machines merely because their hostnames match", () => {
    expect(
      buildRuntimeGroups([runtime({ id: "a" }), runtime({ id: "b" })])
    ).toHaveLength(2);
  });
  it("keeps custom profile names and gives same-machine duplicates distinct labels", () => {
    const groups = buildRuntimeGroups([
      runtime({
        id: "first-12345678",
        daemonId: "machine",
        profileId: "p1",
        name: "Codex (research) (localhost)",
        customName: "Research Mac",
      }),
      runtime({
        id: "other-12345678",
        daemonId: "machine",
        profileId: "p2",
        name: "Codex (research) (localhost)",
      }),
    ]);
    expect(groups[0].label).toBe("Research Mac · machine");
    expect(groups[0].items[0].name).toContain("Codex (research) · ");
    expect(groups[0].items[0].name).not.toBe(groups[0].items[1].name);
  });
  it("excludes other owners and blocks failed profiles even when reported online", () => {
    const failed = runtime({
      id: "failed",
      metadata: {
        runtime_profile_registration_error: true,
        runtime_profile_failure_reason: "command missing",
        version: "1.0",
      },
    });
    const other = runtime({ id: "other", canBind: false });
    expect(isRuntimeReady(other)).toBe(false);
    expect(isRuntimeReady(failed)).toBe(false);
    const groups = buildRuntimeGroups([other, failed]);
    expect(groups.flatMap((g) => g.items).map((r) => r.id)).toEqual(["failed"]);
    expect(groups[0].items[0]).toMatchObject({
      available: false,
      reason: "command missing",
      version: "1.0",
    });
  });
  it("supports older responses and safely handles malformed optional display fields", () => {
    expect(isRuntimeReady({ id: "legacy", name: "Legacy" })).toBe(true);
    expect(
      buildRuntimeGroups([
        runtime({
          deviceInfo: {} as string,
          provider: null as unknown as string,
          customName: 7 as unknown as string,
          metadata: { version: 12 },
        }),
      ])[0].items[0].version
    ).toBe("");
  });
});

it("uses server-confirmed ownership and explicit sharing; never guesses permissions from missing fields", () => {
  const ownedIds = new Set(["mine"]);
  const rows = [
    runtime({ id: "mine", canBind: undefined }),
    runtime({ id: "shared", canBind: false, visibility: "workspace" }),
    runtime({ id: "private", canBind: false, visibility: "private" }),
    runtime({ id: "unknown", canBind: undefined, visibility: undefined }),
    runtime({
      id: "no-status",
      status: undefined,
      canBind: false,
      visibility: "workspace",
    }),
    runtime({
      id: "failed",
      canBind: false,
      visibility: "workspace",
      metadata: { runtime_profile_registration_error: true },
    }),
  ];
  expect(rows.map((rt) => canInstallRuntime(rt, ownedIds))).toEqual([
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
  expect(
    buildRuntimeGroups(rows, { ownedIds, scope: "mine" })
      .flatMap((g) => g.items)
      .map((r) => r.id)
  ).toEqual(["mine"]);
  const all = buildRuntimeGroups(rows, { ownedIds, scope: "all" }).flatMap(
    (g) => g.items
  );
  expect(all).toHaveLength(6);
  expect(all.find((r) => r.id === "private")).toMatchObject({
    available: true,
    selectable: false,
    reason: "mcp.runtimePicker.notOwned",
  });
  expect(all.find((r) => r.id === "unknown")?.visibility).toBeUndefined();
});
