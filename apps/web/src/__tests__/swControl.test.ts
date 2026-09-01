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
import {
  MSW_CONTROL_TIMEOUT_MS,
  MSW_PROBE_HEADER,
  MSW_PROBE_PATH,
  MSW_PROBE_RETRY_MS,
  MSW_PROBE_TIMEOUT_MS,
  waitForMockInterception,
  waitForServiceWorkerControl,
} from "../mocks/swControl";

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

/**
 * 探针握手 —— 「MSW 在【本 document】里真的开始拦了」。
 *
 * 接管等待挡不住的那半：MSW 只对登记过的 client 施加 mock，而一个 spec 内的第二次
 * 导航会让 `serviceWorker.controller` 因 SW 早已激活而【立刻】非空，接管等待一拍都不
 * 等就通过，可 worker 名册里还没有这个新 client——请求照旧绕过 mock。
 * `onUnhandledRequest: "bypass"` 让它不报错不告警，只在 e2e 的 proxy-error 计数上留
 * 一笔，所以只能实测：打一发只有 MSW 才会应答的探针。
 *
 * 用例同样分两类：确认拦到才算就绪；以及【降级必须按时返回】——绝不能把 boot 挂住。
 */
describe("waitForMockInterception", () => {
  const PROBE_OK = {
    headers: { get: (name: string) => (name === MSW_PROBE_HEADER ? "1" : null) },
  } as unknown as Response;
  /** vite 的 SPA fallback：200 + index.html，没有标记头。 */
  const PROBE_BYPASSED = {
    headers: { get: (): string | null => null },
  } as unknown as Response;

  /** 注入一个可控时钟 + 立即返回的 sleep：不依赖 fake timers，也不真的等。 */
  function harness(fetchFn: typeof fetch) {
    let clock = 0;
    return {
      deps: {
        fetchFn,
        now: (): number => clock,
        sleep: async (ms: number): Promise<void> => {
          clock += ms;
        },
      },
      elapsed: (): number => clock,
    };
  }

  it("拦到带标记头的探针响应才算就绪", async () => {
    const fetchFn = vi.fn().mockResolvedValue(PROBE_OK) as unknown as typeof fetch;
    const h = harness(fetchFn);

    await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, h.deps)).resolves.toBe(true);
    // 一发命中就不该再探：探针本身也是请求，别在每个 spec 的 boot 上叠开销。
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBe(0);
  });

  it("探的是不落在任何 vite proxy 前缀下的路径，且带 no-store", async () => {
    const fetchFn = vi.fn().mockResolvedValue(PROBE_OK) as unknown as typeof fetch;
    await waitForMockInterception(MSW_PROBE_TIMEOUT_MS, harness(fetchFn).deps);

    expect(fetchFn).toHaveBeenCalledWith(MSW_PROBE_PATH, { cache: "no-store" });
    // 路径一旦挪到 /api、/summary/api/v1 之类前缀下，没拦到的那一发就会经由 vite
    // proxy 出去，在 e2e 的 proxy-error 计数上留一笔——探针制造出它本要消除的东西。
    for (const proxied of ["/api/", "/mail-api/", "/summary/api/v1", "/market/api/v1", "/fleet/api/v1"]) {
      expect(MSW_PROBE_PATH.startsWith(proxied)).toBe(false);
    }
  });

  it("没被拦到（拿回 SPA fallback）时重试，直到拦到为止", async () => {
    // 这正是要覆盖的那个窗口期：SW 已在控，但本 client 还没登记完。
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(PROBE_BYPASSED)
      .mockResolvedValueOnce(PROBE_BYPASSED)
      .mockResolvedValue(PROBE_OK) as unknown as typeof fetch;
    const h = harness(fetchFn);

    await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, h.deps)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(h.elapsed()).toBe(2 * MSW_PROBE_RETRY_MS);
  });

  it("fetch 抛错（SW 换代 / dev server 抖动）等同于还没拦到，继续重试", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(PROBE_OK) as unknown as typeof fetch;

    await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, harness(fetchFn).deps)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("【降级】始终不挂住 boot：一直拦不到也按时返回 false", async () => {
    const fetchFn = vi.fn().mockResolvedValue(PROBE_BYPASSED) as unknown as typeof fetch;
    const h = harness(fetchFn);

    // 这条是整组里最重要的一条。写成「拦到才 resolve」会让二十多个 spec 的
    // __MSW_READY__ 闸门一起超时，比偶发漏一个请求糟得多。
    await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, h.deps)).resolves.toBe(false);
    expect(h.elapsed()).toBeLessThanOrEqual(MSW_PROBE_TIMEOUT_MS);
    // 重试间隔不能退化成忙等：那会在拿不到 mock 的 5s 里把 dev server 打满。
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(MSW_PROBE_TIMEOUT_MS / MSW_PROBE_RETRY_MS + 1);
  });

  it("时限传 0 也至少探一发，不会一次都不试就报降级", async () => {
    const fetchFn = vi.fn().mockResolvedValue(PROBE_OK) as unknown as typeof fetch;

    await expect(waitForMockInterception(0, harness(fetchFn).deps)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("环境里没有 fetch 时返回 false，不抛错", async () => {
    // 抛出去会被 index.tsx 的 catch 吞掉并【不】设 __MSW_READY__，把「没探到」
    // 升级成「MSW 不可用」，连带把那二十多个 spec 的闸门堵死。
    //
    // 必须真把全局 fetch 摘掉：只传 `fetchFn: undefined` 会被 `??` 兜回全局 fetch，
    // 那样测的就不是这条分支了。
    vi.stubGlobal("fetch", undefined);
    try {
      await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, harness(undefined as never).deps)).resolves.toBe(
        false,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("时钟不推进时靠次数上限收敛，不会退化成微任务死循环", async () => {
    // 两道闸挡的不是同一件事：时限依赖注入的 now() 真的在走，次数只依赖循环自己。
    // 少了次数这道闸，一个被冻住的时钟会让 for(;;) 变成纯微任务的死循环 ——
    // 定时器一次都不派发，连 vitest 自己的 testTimeout 都救不了（它也是定时器），
    // 表现是整个 test file 挂死、零输出。这条用例就是那次挂死的回归。
    const fetchFn = vi.fn().mockResolvedValue(PROBE_BYPASSED) as unknown as typeof fetch;
    const frozen = { fetchFn, now: (): number => 0, sleep: async (): Promise<void> => {} };

    await expect(waitForMockInterception(MSW_PROBE_TIMEOUT_MS, frozen)).resolves.toBe(false);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeLessThanOrEqual(
      MSW_PROBE_TIMEOUT_MS / MSW_PROBE_RETRY_MS + 1,
    );
  });

  it("时限短于 e2e fixture 的 __MSW_READY__ 等待（15s），降级要可诊断", () => {
    // 接管等待与探针等待是【串行】的两段，最坏情况相加。相加后仍要短于 fixture 的
    // 15s，否则降级路径上 fixture 先超时，报出来的是 boot 超时而不是那两条告警。
    expect(MSW_CONTROL_TIMEOUT_MS + MSW_PROBE_TIMEOUT_MS).toBeLessThan(15_000);
  });
});
