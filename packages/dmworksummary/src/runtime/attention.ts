import { createBrowserAttentionRuntimeHost } from "./browserHost";
import { createSummaryAttentionRuntime } from "./attentionRuntime";
import { isSummaryAttentionExternal } from "../utils/summaryAttentionBadge";
import type { SummaryAttentionRuntimeController } from "./attentionHost";

let controller: SummaryAttentionRuntimeController | null = null;
// Pre-init state captured before a controller exists, applied via the factory.
let pendingVisible: boolean | undefined;
let pollingPending = false;

export function initializeSummaryAttentionRuntime(
  options: { observeIm?: boolean } = {}
): void {
  if (controller) return;
  // external mode: 本地 runtime 一律让位（计数由外部 controller 接管）。
  if (isSummaryAttentionExternal()) return;
  // Apply pre-init visibility/polling through the factory options so a
  // hidden/started state is in effect before init side effects begin.
  const next = createSummaryAttentionRuntime(
    createBrowserAttentionRuntimeHost(),
    {
      observeIm: options.observeIm,
      initialVisible: pendingVisible,
      initialPolling: pollingPending,
    },
  );
  next.init();
  controller = next;
  pendingVisible = undefined;
  pollingPending = false;
}

export function startSummaryAttentionPolling(): void {
  // external mode: 不创建本地 leader/轮询。
  if (isSummaryAttentionExternal()) return;
  if (controller) { controller.startPolling(); return; }
  pollingPending = true;
}

export function setSummaryAttentionRuntimeVisible(visible: boolean): void {
  // external mode: 可见性由宿主外部控制，本地 runtime 不参与。
  if (isSummaryAttentionExternal()) return;
  if (controller) { controller.setVisible(visible); return; }
  pendingVisible = visible;
}

export function disposeSummaryAttentionRuntime(): void {
  // external mode: 无本地 runtime；清理由外部 controller 的 dispose() 完成。
  if (isSummaryAttentionExternal()) return;
  controller?.dispose();
  controller = null;
  pendingVisible = undefined;
  pollingPending = false;
}
/**
 * 如果存在活跃的浏览器 runtime controller（leader/poll 正在运行），
 * 将其彻底拆除。external mode 安装时先调用此函数，确保没有残留的定时器或
 * BroadcastChannel 连接。
 */
export function teardownBrowserAttentionRuntime(): void {
  controller?.dispose();
  controller = null;
  pendingVisible = undefined;
  pollingPending = false;
}
