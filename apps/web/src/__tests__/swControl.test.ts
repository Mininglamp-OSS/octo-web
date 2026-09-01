/**
 * swControl test —— MSW service worker 的「接管」握手。
 *
 * 这个握手要防的是一个不报错的故障：`worker.start()` resolve 只代表 SW 已 activated，
 * 不代表它已经 control 本 client。窗口期内 boot 请求绕过 MSW 直达 dev server，而
 * `onUnhandledRequest: "bypass"` 让它既不抛错也不告警，只在 e2e 的 proxy-error 计数上
 * 留一笔（e2e-p0 上那 3 个泄漏就是这么来的，其中一个是 summaries/attention）。
 *
 * 因此这里的用例分两类，缺任一类都不够：
 *   1. 正确性：确认接管才算就绪；
 *   2. 降级：拿不到接管时【必须】按时返回，绝不能把 boot 挂住——二十多个 spec 以
 *      `__MSW_READY__` 为闸门，卡死 boot 比漏一个请求糟得多。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSW_CONTROL_TIMEOUT_MS, waitForServiceWorkerControl } from "../mocks/swControl";

/**
 * 最小 ServiceWorkerContainer 替身。
 *
 * 只实现握手真正用到的三件事：controller、addEventListener/removeEventListener。
 * `takeControl()` 模拟 clients.claim() 完成——先置 controller 再派发事件，顺序和浏览器
 * 一致（反过来写会让被测代码在 controller 仍为 null 时看到事件，那正是要容忍的情况）。
 */
function makeSwStub(initialController: object | null = null) {
  const listeners = new Set<() => void>();
  const stub = {
    controller: initialController,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === "controllerchange") listeners.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === "controllerchange") listeners.delete(fn);
    }),
    /** 正常接管：置 controller 再派发。 */
    takeControl(): void {
      stub.controller = { scriptURL: "/mockServiceWorker.js" };
      listeners.forEach((fn) => fn());
    },
    /** 派发 controllerchange 但 controller 仍为 null（如 SW 被注销）。 */
    emitBareChange(): void {
      listeners.forEach((fn) => fn());
    },
    listenerCount: (): number => listeners.size,
  };
  return stub;
}

function navWith(sw: ReturnType<typeof makeSwStub> | undefined) {
  return { serviceWorker: sw } as unknown as Pick<Navigator, "serviceWorker">;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForServiceWorkerControl", () => {
  it("已经在控时立刻返回 true，不装监听也不等一拍", async () => {
    // 页面 reload 的常见情形。这里若还去等 controllerchange，就会白等到超时——
    // 事件不会再来了，因为接管早就发生过。
    const sw = makeSwStub({ scriptURL: "/mockServiceWorker.js" });

    await expect(waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw))).resolves.toBe(true);
    expect(sw.addEventListener).not.toHaveBeenCalled();
  });

  it("接管到达时返回 true，并摘掉监听", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    expect(sw.listenerCount()).toBe(1);
    sw.takeControl();

    await expect(p).resolves.toBe(true);
    // 漏摘监听会在反复 boot 的 e2e 进程里叠一层又一层。
    expect(sw.listenerCount()).toBe(0);
  });

  it("接管在时限内到达就不必等满：不拖慢每个 spec 的 boot", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    // 只推进 50ms（真实量级），远未到 5s 上限。
    await vi.advanceTimersByTimeAsync(50);
    sw.takeControl();

    await expect(p).resolves.toBe(true);
  });

  it("【降级】始终不挂住 boot：拿不到接管时按时返回 false", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    await vi.advanceTimersByTimeAsync(MSW_CONTROL_TIMEOUT_MS);

    // 这条是整组里最重要的一条：返回 false 让调用方照常设 __MSW_READY__，
    // 行为不劣于改动前。一旦写成「等到接管才 resolve」，二十多个 spec 的
    // boot 闸门会一起超时。
    await expect(p).resolves.toBe(false);
    expect(sw.listenerCount()).toBe(0);
  });

  it("超时【之前】一拍到达的接管仍算成功（边界不能取反）", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    await vi.advanceTimersByTimeAsync(MSW_CONTROL_TIMEOUT_MS - 1);
    sw.takeControl();

    await expect(p).resolves.toBe(true);
  });

  it("controller 仍为 null 的 controllerchange 不算接管，继续等到超时", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    // SW 被注销一类的情形也会派发这个事件。当成接管会让 __MSW_READY__ 谎报就绪，
    // 请求照样泄漏，而且没有那条告警可看。
    sw.emitBareChange();
    await vi.advanceTimersByTimeAsync(MSW_CONTROL_TIMEOUT_MS - 1);
    sw.emitBareChange();

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(false);
  });

  it("接管后又连派多次 controllerchange 也只 settle 一次", async () => {
    const sw = makeSwStub(null);
    const p = waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(sw));

    sw.takeControl();
    sw.takeControl();
    await expect(p).resolves.toBe(true);

    // settle 后再推进到超时点：定时器必须已被清掉，否则第二次 finish 会走
    // 到 resolve 之后（无害但说明清理漏了），且在 e2e 进程里留悬挂回调。
    await vi.advanceTimersByTimeAsync(MSW_CONTROL_TIMEOUT_MS);
    expect(sw.listenerCount()).toBe(0);
  });

  it("环境不支持 service worker 时立刻返回 false，不抛错", async () => {
    // 非安全上下文 / 被企业策略禁用。这里抛错会被 index.tsx 的 catch 吞掉并
    // 【不】设 __MSW_READY__，把「MSW 可用但没接管」错误升级成「MSW 不可用」。
    await expect(waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, navWith(undefined))).resolves.toBe(false);
    await expect(waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS, undefined)).resolves.toBe(false);
  });

  it("时限短于 e2e fixture 的 __MSW_READY__ 等待（15s），降级要可诊断", () => {
    // fixtures-authed.ts 的 waitForFunction 给 __MSW_READY__ 15s。握手若等得更久，
    // 降级路径上 fixture 会先超时，报出来的是「boot 超时」而不是那条明确的告警。
    expect(MSW_CONTROL_TIMEOUT_MS).toBeLessThan(15_000);
  });
});
