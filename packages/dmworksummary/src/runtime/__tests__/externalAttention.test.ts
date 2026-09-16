/**
 * installExternalSummaryAttention test — W2 外部总结注意力适配器。
 *
 * 覆盖：
 *   - 无网络：external mode 下 read/refresh 均不触碰本地 API；
 *   - 本地 / 列表写入与广播全部压制；
 *   - 模式切换后迟到的本地读取不上写、不 publish；
 *   - 宿主 apply 不 echo（不回发请求、不触发 invalidation）；
 *   - 宿主回调抛错被吞（保持旧值）；
 *   - dispose 幂等、可重新 install；
 *   - external 安装后 initialize/startPolling 不创建本地 runtime。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", async () => {
  const actual = await vi.importActual<
    Record<string, unknown>
  >("../../__mocks__/dmworkBase");
  return { ...actual };
});
vi.mock("../../api/summaryApi");

import * as api from "../../api/summaryApi";
import {
  getSummaryAttentionBadge,
  subscribeSummaryAttentionBadge,
  readSummaryAttentionCount,
  refreshSummaryAttentionBadge,
  commitSummaryAttentionBadge,
  beginSummaryAttentionRead,
  acceptRemoteAttentionCount,
  setSummaryAttentionBadge,
  resetSummaryAttentionOrdering,
  setSummaryAttentionPublisher,
  isSummaryAttentionExternal,
  hasInFlightAttentionRead,
} from "../../utils/summaryAttentionBadge";
import { WKApp } from "@octo/base";
import {
  installExternalSummaryAttention,
  hasActiveExternalController,
  resetExternalAttentionState,
} from "../externalAttention";
import {
  initializeSummaryAttentionRuntime,
  startSummaryAttentionPolling,
  disposeSummaryAttentionRuntime,
} from "../attention";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(WKApp.menus, "refresh").mockImplementation(() => {});
  WKApp.shared.currentSpaceId = "space-123";
  WKApp.loginInfo.uid = "test-uid";
  vi.spyOn(WKApp.loginInfo, "isLogined").mockReturnValue(true);
  vi.mocked(WKApp.menus.refresh).mockClear();
  resetSummaryAttentionOrdering();
  setSummaryAttentionBadge(0);
  vi.mocked(WKApp.menus.refresh).mockClear();
});

afterEach(() => {
  resetExternalAttentionState();
  vi.restoreAllMocks();
  // 清除可能残留的 activeExternalControllerId
  try { require("../externalAttention"); } catch {}
});

describe("installExternalSummaryAttention", () => {
  it("selects external mode before local runtime and routes refresh to host, never API", async () => {
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const external = installExternalSummaryAttention({ requestRefresh });

    expect(isSummaryAttentionExternal()).toBe(true);
    expect(hasActiveExternalController()).toBe(true);

    // refresh 委托宿主，不发 API 请求
    await refreshSummaryAttentionBadge();
    expect(requestRefresh).toHaveBeenCalledWith("mutation");
    expect(api.fetchSummaryAttentionCounts).not.toHaveBeenCalled();

    // read 也直接返回 null，不发请求
    await expect(readSummaryAttentionCount()).resolves.toBeNull();
    expect(api.fetchSummaryAttentionCounts).not.toHaveBeenCalled();

    external.dispose();
  });

  it("installs external mode even when count is not available yet (null)", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn().mockResolvedValue(undefined),
    });
    // null 归一化为 0，不再回退本地
    external.apply(null);
    expect(getSummaryAttentionBadge()).toBe(0);
    expect(isSummaryAttentionExternal()).toBe(true);
    external.dispose();
  });

  it("sanitizes externally applied count and notifies subscribers only", () => {
    const requestRefresh = vi.fn();
    const external = installExternalSummaryAttention({ requestRefresh });
    const seen: number[] = [];
    const unsub = subscribeSummaryAttentionBadge((count) => seen.push(count));

    // 3.9 → sanitized to 3; +Infinity → sanitized to 0; -2 → sanitized to 0 == current → noop
    external.apply(3.9);
    external.apply(Number.POSITIVE_INFINITY);
    external.apply(-2);

    expect(getSummaryAttentionBadge()).toBe(0);
    expect(seen).toEqual([3, 0]);
    // 宿主自带菜单重绘，apply 不触发 menus.refresh
    expect(WKApp.menus.refresh).not.toHaveBeenCalled();
    unsub();
    external.dispose();
  });

  it("external update does not echo back into host refresh", async () => {
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const external = installExternalSummaryAttention({ requestRefresh });
    external.apply(5);
    external.apply(7);
    await Promise.resolve();
    expect(requestRefresh).not.toHaveBeenCalled();
    external.dispose();
  });

  it("dispose is idempotent and allows reinstall", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    external.apply(4);
    external.dispose();
    external.dispose();
    expect(isSummaryAttentionExternal()).toBe(false);
    expect(hasActiveExternalController()).toBe(false);

    const second = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    expect(isSummaryAttentionExternal()).toBe(true);
    second.apply(5);
    expect(getSummaryAttentionBadge()).toBe(5);
    second.dispose();
  });

  it("rejects a second external controller while one is active", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    expect(() =>
      installExternalSummaryAttention({ requestRefresh: vi.fn() }),
    ).toThrow("already active");
    external.dispose();
    const afterDispose = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    expect(hasActiveExternalController()).toBe(true);
    afterDispose.dispose();
  });

  it("external mode blocks local list writes and broadcasts", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    external.apply(8);
    expect(getSummaryAttentionBadge()).toBe(8);

    // 本地 commit（列表写入/轮询）不得覆盖
    const ticket = beginSummaryAttentionRead();
    commitSummaryAttentionBadge(ticket, 1);
    expect(getSummaryAttentionBadge()).toBe(8);
    expect(hasInFlightAttentionRead()).toBe(false);

    // 广播不得写入
    expect(acceptRemoteAttentionCount(2, Date.now())).toBe(false);
    expect(getSummaryAttentionBadge()).toBe(8);

    // 直接 setSummaryAttentionBadge（本地清单写入路径）也不得覆盖
    setSummaryAttentionBadge(3);
    expect(getSummaryAttentionBadge()).toBe(8);

    external.dispose();
  });

  it("suppresses local writes when count is unavailable (null applied)", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    external.apply(null);
    expect(getSummaryAttentionBadge()).toBe(0);
    const ticket = beginSummaryAttentionRead();
    commitSummaryAttentionBadge(ticket, 9);
    expect(getSummaryAttentionBadge()).toBe(0);
    external.dispose();
  });

  it("stale local request resolved after external install does not write or publish", async () => {
    const pending = deferred<unknown>();
    vi.mocked(api.fetchSummaryAttentionCounts).mockReturnValueOnce(
      pending.promise as never,
    );
    const publisher = vi.fn();
    setSummaryAttentionPublisher(publisher);

    // 本地读取先在飞（external 安装前发出）
    const inFlight = readSummaryAttentionCount({ fresh: true });

    // 现在进入 external 模式
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const external = installExternalSummaryAttention({ requestRefresh });
    external.apply(6);

    // 迟到的本地响应到达：不得 commit、不得 publish
    pending.resolve({ attention_count: 2 });
    await expect(inFlight).resolves.toBeNull();
    expect(getSummaryAttentionBadge()).toBe(6);
    expect(publisher).not.toHaveBeenCalled();

    external.dispose();
  });

  it("no network while external: nothing touches summaryApi", async () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn().mockResolvedValue(undefined),
    });
    await refreshSummaryAttentionBadge();
    await expect(readSummaryAttentionCount()).resolves.toBeNull();
    expect(api.fetchSummaryAttentionCounts).not.toHaveBeenCalled();
    external.dispose();
  });

  it("swallows host callback errors and keeps current value", async () => {
    const requestRefresh = vi
      .fn()
      .mockRejectedValue(new Error("owner unavailable"));
    const external = installExternalSummaryAttention({ requestRefresh });
    external.apply(4);

    await expect(refreshSummaryAttentionBadge()).resolves.toBeUndefined();
    expect(getSummaryAttentionBadge()).toBe(4);
    expect(requestRefresh).toHaveBeenCalledWith("mutation");
    external.dispose();
  });

  it("does not create local runtime/leader/polling while external is installed", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    // local facade must bail
    initializeSummaryAttentionRuntime();
    startSummaryAttentionPolling();
    // 若 local runtime 被创建会撞单 active controller；此处不应抛
    expect(hasActiveExternalController()).toBe(true);
    expect(disposeSummaryAttentionRuntime).not.toThrow();
    external.dispose();
  });
  it("getCount returns the current sanitized snapshot after apply", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    expect(external.getCount()).toBe(0);
    external.apply(5);
    expect(external.getCount()).toBe(5);
    external.apply(null);
    expect(external.getCount()).toBe(0);
    external.dispose();
  });

  it("subscribe returns current value and notifies on changes", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    const seen: number[] = [];
    const unsub = external.subscribe((c) => seen.push(c));
    // immediate callback with current value
    expect(seen).toEqual([0]);
    external.apply(3);
    expect(seen).toEqual([0, 3]);
    external.apply(3);  // no-change
    expect(seen).toEqual([0, 3]);
    external.apply(7);
    expect(seen).toEqual([0, 3, 7]);
    unsub();
    external.apply(2);
    expect(seen).toEqual([0, 3, 7]);
    external.dispose();
  });

  it("subscribe from non-zero baseline immediately fires with that value", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    external.apply(9);
    const seen: number[] = [];
    external.subscribe((c) => seen.push(c));
    expect(seen).toEqual([9]);
    external.dispose();
  });

  it("refresh calls host requestRefresh with default manual-refresh", async () => {
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const external = installExternalSummaryAttention({ requestRefresh });
    await external.refresh();
    expect(requestRefresh).toHaveBeenCalledWith("manual-refresh");
    await external.refresh("mutation");
    expect(requestRefresh).toHaveBeenCalledWith("mutation");
    expect(requestRefresh).toHaveBeenCalledTimes(2);
    external.dispose();
  });

  it("refresh after dispose is noop", async () => {
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const external = installExternalSummaryAttention({ requestRefresh });
    external.dispose();
    await expect(external.refresh()).resolves.toBeUndefined();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("subscribe after dispose still captures current snapshot baseline", () => {
    const external = installExternalSummaryAttention({ requestRefresh: vi.fn() });
    external.apply(6);
    external.dispose();
    // getCount/subscribe read the retained mirror even after dispose (teardown reads).
    expect(external.getCount()).toBe(6);
    const seen: number[] = [];
    external.subscribe((c) => seen.push(c));
    expect(seen).toEqual([6]);
  });

});
  it("setSummaryAttentionBadge in external mode is fully inert (no menus.refresh)", () => {
    setSummaryAttentionBadge(7);
    expect(WKApp.menus.refresh).toHaveBeenCalledTimes(1);
    const external = installExternalSummaryAttention({ requestRefresh: vi.fn() });
    vi.mocked(WKApp.menus.refresh).mockClear();
    external.apply(5);
    expect(WKApp.menus.refresh).not.toHaveBeenCalled();
    // direct setSummaryAttentionBadge calls must also not trigger refresh
    setSummaryAttentionBadge(9);
    expect(WKApp.menus.refresh).not.toHaveBeenCalled();
    external.dispose();
  });

  it("getCount returns 0 at install, not the stale pre-external badge value", () => {
    // 外部安装前设一个非零的本地陈旧值
    setSummaryAttentionBadge(7);
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    // 安装时 setSummaryAttentionExternal 内部把 summaryAttentionBadge 重置为 0
    expect(external.getCount()).toBe(0);
    external.apply(4);
    expect(external.getCount()).toBe(4);
    external.dispose();
  });

  it("init after external: no local runtime controller created", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    // local facade must bail without creating a controller
    expect(() => initializeSummaryAttentionRuntime()).not.toThrow();
    expect(() => startSummaryAttentionPolling()).not.toThrow();
    expect(hasActiveExternalController()).toBe(true);
    expect(isSummaryAttentionExternal()).toBe(true);
    external.dispose();
  });

  it("dispose blocks late local commits issued while external was active", () => {
    const external = installExternalSummaryAttention({
      requestRefresh: vi.fn(),
    });
    external.apply(6);
    // 在 external 期间发行了一个旧号
    const ticket = beginSummaryAttentionRead();
    external.dispose();
    // 号已被 setSummaryAttentionExternal 的 issueSeq++ 作废，commit 不会落盘
    commitSummaryAttentionBadge(ticket, 9);
    expect(getSummaryAttentionBadge()).toBe(6);
  });
