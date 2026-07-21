export type SummaryDetailLandingDeps = {
  // 拆成 getter 而非直取值：landing 时序上 openSummaryDetail 由 dmworksummary 模块
  // init 注册，首帧 effect 执行时可能尚未挂到 WKApp 上，故每次重试都重新读取。
  getPathname: () => string;
  getSearch: () => string;
  isLoggedIn: () => boolean;
  getOpenSummaryDetail: () => ((taskId: number) => void) | undefined;
  cleanUrl?: (taskId: number) => void;
  setRetry: (cb: () => void, delayMs: number) => number;
  clearRetry: (handle: number) => void;
};

const SUMMARY_DETAIL_PATH = '/summary/detail';
const SUMMARY_DETAIL_RETRY_INTERVAL_MS = 100;
const SUMMARY_DETAIL_MAX_RETRIES = 20; // ~2s 兜底：等 dmworksummary 模块 init 注册 openSummaryDetail

/**
 * URL 直达落地：通知 DM 里的 `${origin}/summary/detail?taskId=<id>` 被点击后浏览器
 * 直接打开该地址，但 App 启动默认渲染 ChatPage、不消费 location。这里在启动时读一次
 * location，命中该路径且已登录时调用 WKApp.openSummaryDetail(taskId) 落到详情页。
 *
 * 纯依赖注入以便脱离 @octo/base 重模块图做单测（对齐 friendApplyReddotCleanup.ts 风格）。
 *
 * @returns cleanup 函数（停止仍在排队的重试）；返回 undefined 表示未启动任何重试。
 */
export function runSummaryDetailLanding(deps: SummaryDetailLandingDeps): (() => void) | undefined {
  try {
    const pathname = (deps.getPathname() || '').replace(/\/+$/, '') || '/';
    if (pathname !== SUMMARY_DETAIL_PATH) return undefined;

    // 未登录不动作：登录前落地会被登录流程打断，且详情页依赖登录态。
    if (!deps.isLoggedIn()) return undefined;

    const raw = new URLSearchParams(deps.getSearch()).get('taskId');
    // 只收正整数：后端 %d 只发真实 ID，负数/小数/十六进制/超 2^53 均非法，收严更防御。
    const taskId = Number(raw);
    if (raw === null || !/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(taskId) || taskId <= 0) return undefined;

    let handle: number | undefined;
    let attempts = 0;
    const tryOpen = () => {
      const open = deps.getOpenSummaryDetail();
      if (open) {
        open(taskId);
        // 清 URL 回干净路径：避免用户刷新时重复落地（openSummaryDetail 已切到 summary 主 Tab）。
        deps.cleanUrl?.(taskId);
        return;
      }
      if (++attempts >= SUMMARY_DETAIL_MAX_RETRIES) return;
      handle = deps.setRetry(tryOpen, SUMMARY_DETAIL_RETRY_INTERVAL_MS);
    };
    tryOpen();

    return () => {
      if (handle !== undefined) deps.clearRetry(handle);
    };
  } catch (e) {
    // URL API / location 在 SSR / 非浏览器环境下可能不可用——静默忽略不阻塞渲染。
    return undefined;
  }
}
