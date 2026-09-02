// MSW service worker 接管握手 —— 仅在 VITE_E2E_MOCK=1 时被 src/index.tsx 动态 import.
// 和 mocks/browser.ts 一样: dev / prod 不 import → tree-shake 掉, 零副作用.
//
// 单独成文件而不是留在 index.tsx 里, 是为了能单测: index.tsx 尾部有 `void main()`,
// import 它就会真的启动整个 app. 本仓库既有的做法也是把逻辑挪出去再测
// (见 features/spacePreference 与 __tests__/mainInitialSpaceResolution.test.ts).

/**
 * 等接管的时限。5s 远超实际所需（正常是几十毫秒），同时明显短于 e2e fixture 里
 * `__MSW_READY__` 那个 15s 的等待，保证降级路径上 fixture 看到的是「就绪了但没拦到」
 * 这种可诊断的失败，而不是一个 boot 超时。
 */
export const MSW_CONTROL_TIMEOUT_MS = 5_000;

/**
 * 等 service worker 真正【接管】当前 client，而不只是「注册并激活完了」。
 *
 * `worker.start()` resolve 只保证 SW 已 activated，不保证它已经 control 本 client。
 * 全新 browser context 首次加载时这两件事之间有一个真实的窗口：MSW 的 worker 脚本
 * 在 activate 里调 `clients.claim()`，那是异步的，接管完成才派发 controllerchange。
 * 窗口期内页面【没有】controller，fetch 不经过 SW，于是直接打到 Vite dev server ——
 * 配的是 `onUnhandledRequest: "bypass"`，所以既不报错也不告警，只在 e2e 的
 * "proxy errors" 计数上留一笔。
 *
 * 这正是 e2e-p0 上 3 个 proxy error 的成因（`user/devices`、`summaries/attention`、
 * `conversations/.../extra` 都是 boot 时发的），也解释了为什么它是概率性的：
 * 谁先赢那几十毫秒。
 *
 * 之所以在这里等、而不是在各 spec 里逐个补 `page.route` 兜底：boot 时发请求的端点
 * 会一直增加（`summaries/attention` 就是新加的），逐个补是打地鼠，而且补的是症状。
 * 在这里等一次，所有现有和未来的 boot 端点一起被覆盖。
 *
 * 有界等待，且调用方【无论如何都往下走】：超时后仍然会设 `__MSW_READY__`。
 * 拿不到接管时把 boot 卡死会让二十多个 spec 的 `__MSW_READY__` 等待一起超时，
 * 比漏一个请求糟得多；保持「最差也不劣于改动前」。
 *
 * @param timeoutMs 等待上限
 * @param nav 注入点，仅供单测替换 navigator；生产调用不传
 * @returns 是否在时限内确认了接管（false 表示走了降级，调用方据此打告警）
 */
export async function waitForServiceWorkerControl(
  timeoutMs: number = MSW_CONTROL_TIMEOUT_MS,
  nav: Pick<Navigator, "serviceWorker"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<boolean> {
  const sw = nav?.serviceWorker;
  // 不支持 SW（非安全上下文、被策略禁用）时直接返回：调用方会照常设
  // __MSW_READY__，行为与改动前一致。
  if (!sw) return false;
  // 常见情形（页面 reload、SW 已在控）走这条：controller 已经在了，一拍都不用等。
  if (sw.controller) return true;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (controlled: boolean): void => {
      // controllerchange 与超时可能撞在一起；也可能连派发多次。
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sw.removeEventListener("controllerchange", onControllerChange);
      resolve(controlled);
    };
    // controllerchange 也可能在 controller 仍为 null 时派发（如 SW 被注销），
    // 那种情况不算接管成功，继续等到超时。
    const onControllerChange = (): void => {
      if (sw.controller) finish(true);
    };
    const timer = setTimeout(() => finish(!!sw.controller), timeoutMs);
    sw.addEventListener("controllerchange", onControllerChange);
  });
}

/**
 * 探针路径。刻意选一个【不在任何 vite proxy 前缀下】的路径
 * （proxy 配的是 /mail-api/、/api/v1/docs、/summary/api/v1、/market/api/v1、
 * /fleet/api/v1），这样探针自己万一没被拦到，也只会落到 SPA fallback 上，
 * 绝不会在 e2e 的 "http proxy error" 计数里留一笔——探针不该制造它要消除的东西。
 */
export const MSW_PROBE_PATH = "/__msw_probe__";
/** 探针响应的标记头。靠它区分「MSW 拦到了」与「vite 把 index.html 兜回来了」。 */
export const MSW_PROBE_HEADER = "x-msw-probe";
export const MSW_PROBE_TIMEOUT_MS = 5_000;
export const MSW_PROBE_RETRY_MS = 50;
/** 单次探针的硬上限；总等待仍由 MSW_PROBE_TIMEOUT_MS 控制。 */
export const MSW_PROBE_ATTEMPT_TIMEOUT_MS = 500;

/**
 * 等 MSW 在【本 document】里真的开始拦请求。
 *
 * 为什么 `waitForServiceWorkerControl` 还不够 —— 它俩挡的是两件不同的事：
 *
 * - `navigator.serviceWorker.controller` 存在，只说明这个 document 由某个 SW 接管；
 * - MSW 只对【登记过的 client】施加 mock：worker 脚本内部维护一份 client 名册，
 *   `worker.start()` 通过 postMessage 把本 document 加进去，`beforeunload` 时又发
 *   `CLIENT_CLOSED` 把它摘掉。
 *
 * 于是 e2e 里最常见的那种页面——一个 spec 内连续 navigate 好几次——会撞上第二种
 * 窗口期：第二个 document 一加载，`controller` 因为 SW 早已激活而【立刻】非空，
 * 接管等待一拍都不等就通过了，可此时 worker 名册里还没有这个新 client，请求照旧
 * 绕过 mock 直达 dev server。`onUnhandledRequest: "bypass"` 让它不报错不告警，只在
 * e2e 的 proxy-error 计数上留一笔——正是 e2e-p0 上那个概率性红点的成因，也解释了
 * 为什么它专挑多次导航的 spec（`@S26` 一个 spec 里 5 次导航，只等 1 次
 * `__MSW_READY__`）。
 *
 * 所以这里不再推断，而是【实测】：打一发只有 MSW 才会应答的请求，看回来的响应是不是
 * 带标记头的那个。拦到了才算就绪。这也让 `__MSW_READY__` 从「start() 返回了」变成
 * 它一直声称的那件事——「从现在起请求会被拦」。
 *
 * 和接管等待同一套降级哲学：有界，且调用方【无论如何都往下走】。拿不到就打告警并
 * 照常置 `__MSW_READY__`；把 boot 卡死会让二十多个 spec 的闸门一起超时，比偶发漏一个
 * 请求糟得多。
 *
 * @param timeoutMs 等待上限
 * @param deps 注入点，仅供单测替换 fetch / 时钟 / sleep；生产调用不传
 * @returns 是否确认拦到（false 表示走了降级，调用方据此打告警）
 */
export async function waitForMockInterception(
  timeoutMs: number = MSW_PROBE_TIMEOUT_MS,
  deps: {
    fetchFn?: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const fetchFn = deps.fetchFn ?? (typeof fetch === "undefined" ? undefined : fetch);
  // 环境里没有 fetch（极端 polyfill 情况）时按降级处理，绝不抛：抛出去会被
  // index.tsx 的 catch 吞掉并【不】设 __MSW_READY__，把「没探到」升级成「MSW 不可用」。
  if (!fetchFn) return false;
  const now = deps.now ?? ((): number => Date.now());
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));

  const deadline = now() + timeoutMs;
  // 时限之外再加一道【次数】上限。两道闸看着冗余，其实挡的不是同一件事：时限依赖
  // 注入进来的 now() 真的在走，而次数只依赖循环自己。少了它，一个不推进的时钟
  // （单测里手写的假时钟、宿主里被冻住的 performance 源）会让这个 for(;;) 变成一个
  // 纯微任务的死循环 —— 定时器一次都不派发，连测试框架自己的超时都救不了它。
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / MSW_PROBE_RETRY_MS) + 1);
  // 先探一次再看时限：timeoutMs 传 0 也至少探一发，不会一次都不试就报降级。
  for (let attempt = 1; ; attempt++) {
    let intercepted = false;
    const remainingMs = Math.max(0, deadline - now());
    const attemptTimeoutMs = Math.min(MSW_PROBE_ATTEMPT_TIMEOUT_MS, remainingMs);
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      // no-store：别让某一次探针结果被缓存住，之后每个 document 都读到同一份。
      // Promise.race 是硬边界：即使宿主 fetch 不理 AbortSignal，boot 也不会永久挂住；
      // abort 负责尽量收掉底层连接，避免每轮留下一个后台悬挂请求。
      const timeout = new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => {
          controller?.abort();
          resolve(null);
        }, attemptTimeoutMs);
      });
      const request = Promise.resolve(
        fetchFn(MSW_PROBE_PATH, {
          cache: "no-store",
          ...(controller ? { signal: controller.signal } : {}),
        }),
      ).catch(() => null);
      const res = await Promise.race([request, timeout]);
      intercepted = res?.headers.get(MSW_PROBE_HEADER) === "1";
    } catch {
      // 网络层失败（SW 正在换代、dev server 抖动）等同于「还没拦到」，继续重试。
      intercepted = false;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }
    if (intercepted) return true;
    if (now() >= deadline || attempt >= maxAttempts) return false;
    await sleep(MSW_PROBE_RETRY_MS);
  }
}
