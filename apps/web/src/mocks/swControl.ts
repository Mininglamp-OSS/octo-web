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
