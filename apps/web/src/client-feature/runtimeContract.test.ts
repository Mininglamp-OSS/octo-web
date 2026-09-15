import { describe, expect, it } from "vitest";
import {
  parseOwnerRuntimeBootstrap, parseSummaryRuntimeBootstrap,
  parseRuntimeCommand, parseRuntimeSnapshot,
} from "./runtimeContract";
import { assertClientFeatureBootstrap } from "./bootstrapContract";

const scope = { ownerId: "owner", contextId: "context", epoch: 1 };
const owner = { version: 1, ...scope, summaryAttention: "owner" };
const snapshot = {
  version: 1, ...scope, revision: 1, phase: "ready",
  badges: { messages: { status: "ready", count: 0 }, summary: { status: "loading", count: null } },
};
describe("runtime contract", () => {
  it("validates each ownership mode", () => {
    expect(parseOwnerRuntimeBootstrap(owner)).toEqual(owner);
    expect(parseSummaryRuntimeBootstrap({ version: 1, contextId: "c", epoch: 0, summaryAttention: "external" })).toEqual({
      version: 1, contextId: "c", epoch: 0, summaryAttention: "external",
    });
  });
  it.each([undefined, null, [], {}, { ...owner, version: 2 }, { ...owner, extra: true },
    { ...owner, epoch: -1 }, { ...owner, epoch: 1.5 }, { ...owner, epoch: Infinity },
    { ...owner, ownerId: " " }, { ...owner, summaryAttention: { toString: () => "owner" } },
  ])("rejects malformed owner %j", (value) => {
    expect(() => parseOwnerRuntimeBootstrap(value)).toThrow();
  });
  it("preserves unknown counts as null instead of zero", () => {
    expect(parseRuntimeSnapshot(snapshot)).toEqual(snapshot);
    for (const count of [-1, 1.5, "1", Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(() => parseRuntimeSnapshot({ ...snapshot, badges: { ...snapshot.badges, messages: { status: "ready", count } } })).toThrow();
    }
    expect(() => parseRuntimeSnapshot({ ...snapshot, badges: { ...snapshot.badges, summary: { status: "loading", count: 0 } } })).toThrow();
    expect(() => parseRuntimeSnapshot({ ...snapshot, phase: { toString: () => "ready" } })).toThrow();
  });
  it("validates scoped commands, nested keys and task allowlist", () => {
    const base = { version: 1, ...scope };
    for (const type of ["refresh", "dispose"]) {
      expect(parseRuntimeCommand({ ...base, type })).toEqual({ ...base, type });
    }
    const invalidation = { ...base, type: "invalidateSummary", requestId: "request-1", reason: "mutation" };
    expect(parseRuntimeCommand(invalidation)).toEqual(invalidation);
    expect(() => parseRuntimeCommand({ ...base, type: "invalidateSummary" })).toThrow();
    expect(() => parseRuntimeCommand({ ...invalidation, reason: "execute" })).toThrow();
    expect(parseRuntimeCommand({ ...base, type: "timerFired", task: "summaryAttentionRefresh", timerId: 1 })).toMatchObject({ timerId: 1 });
    expect(() => parseRuntimeCommand({ ...base, type: "timerFired", task: "execute", timerId: 1 })).toThrow();
    expect(() => parseRuntimeCommand({ ...base, type: "activity", activity: { applicationActive: true } })).toThrow();
    expect(() => parseRuntimeCommand({ ...base, type: "refresh", apiOrigin: "https://example.invalid" })).toThrow();
    expect(parseRuntimeCommand({ ...base, type: "navigate", page: "chat", target: { channelId: "one", channelType: 1 } })).toMatchObject({ page: "chat" });
    expect(() => parseRuntimeCommand({ ...base, type: "navigate", page: "contacts", target: { channelId: "one", channelType: 1 } })).toThrow();
    expect(() => parseRuntimeCommand({ ...base, type: "navigate", page: "chat", target: { channelId: "one", channelType: 1, script: "x" } })).toThrow();
  });
  it("accepts workspace-group variant and requires workspace presentation", () => {
    const scope = { ownerId: "owner", contextId: "context", epoch: 1 };
    const target = { channelId: "group-a", channelType: 2, variant: "workspace-group" };
    const cmd = { version: 1, ...scope, type: "navigate", page: "chat", presentation: "workspace", target };
    expect(parseRuntimeCommand(cmd)).toMatchObject({
      page: "chat", presentation: "workspace", target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    });
  });

  it("rejects workspace-group without workspace presentation", () => {
    const scope = { ownerId: "owner", contextId: "context", epoch: 1 };
    expect(() => parseRuntimeCommand({
      version: 1, ...scope, type: "navigate", page: "chat", presentation: "conversation",
      target: { channelId: "group-a", channelType: 2, variant: "workspace-group" },
    })).toThrow();
  });

  it("rejects workspace-group with non-group channelType in variant validation", () => {
    const scope = { ownerId: "owner", contextId: "context", epoch: 1 };
    const target = { channelId: "person-u", channelType: 1, variant: "workspace-group" };
    const cmd = { version: 1, ...scope, type: "navigate", page: "chat", presentation: "workspace", target };
    expect(() => parseRuntimeCommand(cmd)).toThrow("Workspace-group variant requires channelType 2");
  });

  it("keeps bootstrap legacy compatibility and rejects wrong feature runtime", () => {
    const bootstrap = {
      bridgeVersion: 1, featureId: "communication",
      session: { uid: "u", token: "t", name: "", provider: "test", apiOrigin: "https://example.invalid" },
      space: { id: "s", name: "" }, appearance: { theme: "light", locale: "en-US" },
    };
    expect(() => assertClientFeatureBootstrap(bootstrap, "communication")).not.toThrow();
    expect(() => assertClientFeatureBootstrap({ ...bootstrap, runtime: owner }, "communication")).not.toThrow();
    expect(() => assertClientFeatureBootstrap({ ...bootstrap, featureId: "apps", runtime: owner }, "apps")).toThrow();
    expect(() => assertClientFeatureBootstrap({ ...bootstrap, featureId: "summary", runtime: owner }, "summary")).toThrow();
  });
});
