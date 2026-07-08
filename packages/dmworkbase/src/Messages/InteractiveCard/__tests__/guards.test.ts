import { describe, it, expect } from "vitest";
import {
  negotiate,
  isSupportedProfile,
  isSupportedCardVersion,
  compareCardVersion,
  RenderBudget,
} from "../guards";

describe("isSupportedProfile", () => {
  it("octo/v1 支持；其他不支持", () => {
    expect(isSupportedProfile("octo/v1")).toBe(true);
    expect(isSupportedProfile("octo/v2")).toBe(false);
    expect(isSupportedProfile("")).toBe(false);
    expect(isSupportedProfile("adaptivecard")).toBe(false);
  });
});

describe("compareCardVersion", () => {
  it("按 major.minor 数值比较", () => {
    expect(compareCardVersion("1.5", "1.5")).toBe(0);
    expect(compareCardVersion("1.4", "1.5")).toBeLessThan(0);
    expect(compareCardVersion("1.6", "1.5")).toBeGreaterThan(0);
    expect(compareCardVersion("2.0", "1.5")).toBeGreaterThan(0);
    expect(compareCardVersion("1.0", "1.5")).toBeLessThan(0);
  });

  it("非法格式返回 NaN", () => {
    expect(Number.isNaN(compareCardVersion("1", "1.5"))).toBe(true);
    expect(Number.isNaN(compareCardVersion("abc", "1.5"))).toBe(true);
    expect(Number.isNaN(compareCardVersion("1.5.0", "1.5"))).toBe(true);
    expect(Number.isNaN(compareCardVersion("", "1.5"))).toBe(true);
  });
});

describe("isSupportedCardVersion", () => {
  it("<= 1.5 支持，> 1.5 不支持，非法不支持", () => {
    expect(isSupportedCardVersion("1.5")).toBe(true);
    expect(isSupportedCardVersion("1.4")).toBe(true);
    expect(isSupportedCardVersion("1.0")).toBe(true);
    expect(isSupportedCardVersion("1.6")).toBe(false);
    expect(isSupportedCardVersion("2.0")).toBe(false);
    expect(isSupportedCardVersion("bogus")).toBe(false);
    expect(isSupportedCardVersion("")).toBe(false);
  });
});

describe("negotiate", () => {
  it("profile + version 均支持 → ok", () => {
    expect(negotiate("octo/v1", "1.5")).toEqual({ ok: true });
    expect(negotiate("octo/v1", "1.4")).toEqual({ ok: true });
  });

  it("不支持 profile → unsupported-profile（优先于 version 判定）", () => {
    expect(negotiate("octo/v2", "1.5")).toEqual({
      ok: false,
      reason: "unsupported-profile",
    });
    // profile 与 version 都不合法时，profile 优先
    expect(negotiate("unknown", "9.9")).toEqual({
      ok: false,
      reason: "unsupported-profile",
    });
  });

  it("profile 支持但 version 过高 → unsupported-version", () => {
    expect(negotiate("octo/v1", "1.6")).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
    expect(negotiate("octo/v1", "2.0")).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });

  it("profile 支持但 version 非法 → unsupported-version", () => {
    expect(negotiate("octo/v1", "")).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });
});

describe("RenderBudget", () => {
  it("节点数在上限内 consume 返回 true", () => {
    const b = new RenderBudget(3, 16);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.exceeded).toBe(false);
  });

  it("节点数越界 → consume 返回 false 且 exceeded", () => {
    const b = new RenderBudget(2, 16);
    b.consume();
    b.consume();
    expect(b.consume()).toBe(false);
    expect(b.exceeded).toBe(true);
  });

  it("深度越界 → enter 返回 false 且 exceeded", () => {
    const b = new RenderBudget(200, 2);
    expect(b.enter()).toBe(true);
    expect(b.enter()).toBe(true);
    expect(b.enter()).toBe(false);
    expect(b.exceeded).toBe(true);
  });

  it("enter/leave 平衡后深度可复用，不误判越界", () => {
    const b = new RenderBudget(200, 2);
    b.enter(); // depth 1
    b.enter(); // depth 2
    b.leave(); // depth 1
    b.leave(); // depth 0
    expect(b.enter()).toBe(true); // depth 1
    expect(b.enter()).toBe(true); // depth 2
    expect(b.exceeded).toBe(false);
  });

  it("默认上限为 200 节点 / 16 层", () => {
    const b = new RenderBudget();
    for (let i = 0; i < 200; i++) expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
  });
});
