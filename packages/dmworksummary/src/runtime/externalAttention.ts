/**
 * installExternalSummaryAttention -- external summary attention controller.
 *
 * Called by the host (e.g. C1 desktop) before the local runtime would start.
 * Once installed:
 *   - `refreshSummaryAttentionBadge()` routes to host's `requestRefresh`
 *     instead of the local API.
 *   - `readSummaryAttentionCount()` returns `null`.
 *   - `apply(count)` feeds the host-provided badge count into the read-only
 *     local mirror so subscribers (menu badge, etc.) see the host value.
 *   - `dispose()` tears down, invalidates any in-flight local tickets via
 *     `clearSummaryAttentionExternal`, and does NOT start a local fallback.
 *
 * Single-active constraint: only one controller at a time.  Installing a new
 * controller without disposing the previous one throws.
 */
import {
  isSummaryAttentionExternal,
  setSummaryAttentionExternal,
  clearSummaryAttentionExternal,
  applyExternalSummaryAttentionBadge,
  getSummaryAttentionBadge,
  subscribeSummaryAttentionBadge,
} from "../utils/summaryAttentionBadge";
import { teardownBrowserAttentionRuntime } from "./attention";

export interface InstallExternalSummaryAttentionOptions {
  /** 宿主刷新回调。mutation = 用户动作导致的变更；manual-refresh = 手动触发。 */
  requestRefresh: (
    reason: "mutation" | "manual-refresh"
  ) => Promise<void>;
}

export interface ExternalSummaryAttentionController {
  /**
   * 将宿主注入的计数写入本地只读镜像。
   * count 为 null 时归零（表示不可用/加载中）。
   */
  apply(count: number | null): void;
  /**
   * 读取当前外部计数快照（sanitized 只读镜像，等价于 getSummaryAttentionBadge()）。
   * null 之外的有限值均已被规范化。
   */
  getCount(): number;
  /**
   * 订阅计数变化。返回取消订阅函数。订阅即回传当前快照。
   */
  subscribe(listener: (count: number) => void): () => void;
  /**
   * 请求宿主刷新（等价于 refreshSummaryAttentionBadge 的外部委托）。
   * 返回宿主 requestRefresh 的结果；宿主回调异常会被吞掉（保持旧值）。
   */
  refresh(reason?: 'mutation' | 'manual-refresh'): Promise<void>;
  /**
   * 卸载外部控制器。幂等；不启动本地轮询/leader。
   * 可重新 install 一个新实例。
   */
  dispose(): void;
}

let activeExternalControllerId: symbol | null = null;

/**
 * 安装外部总结注意力控制器。必须在本地 initializeSummaryAttentionRuntime 之前调用。
 *
 * @returns ExternalSummaryAttentionController（单次安装，不可重复 install）。
 * @throws 已有活跃外部控制器或本地 runtime 已启动时抛错。
 */
export function installExternalSummaryAttention(
  options: InstallExternalSummaryAttentionOptions
): ExternalSummaryAttentionController {
  if (activeExternalControllerId !== null) {
    throw new Error(
      "external summary attention: another controller is already active"
    );
  }
  if (isSummaryAttentionExternal()) {
    throw new Error(
      "external summary attention: external mode is already installed"
    );
  }
  // 如果浏览器 runtime 之前已经初始化过（有活跃的 leader/poll），将其彻底拆除。
  // 防止残留定时器、BroadcastChannel 或事件监听器导致侧信道失效或内存泄漏。
  teardownBrowserAttentionRuntime();

  const id = Symbol("externalController");
  const subscriptions = new Set<() => void>();
  const { requestRefresh } = options;
  let disposed = false;

  const handleHostRefresh = async (reason: 'mutation' | 'manual-refresh'): Promise<void> => {
    if (disposed) return;
    await requestRefresh(reason);
  };

  // 写回 badge 模块安装状态。setSummaryAttentionExternal 内部会推进 issueSeq
  // 并清空在飞表，阻止迟到响应写回。
  setSummaryAttentionExternal(handleHostRefresh);

  activeExternalControllerId = id;

  const controller: ExternalSummaryAttentionController = {
    apply(count: number | null): void {
      if (disposed) return;
      // sanitization + listener notification happens inside
      applyExternalSummaryAttentionBadge(count);
    },
    getCount(): number {
      // 始终允许读快照（即使已 dispose 也可读旧值，便于宿主清理前收尾）。
      return getSummaryAttentionBadge();
    },
    subscribe(listener: (count: number) => void): () => void {
      // 立即回传当前快照，让 owner 订阅即得初值。已 dispose 的控制器仍允许
      // 一次性读取（便于宿主清理前收尾），但不注册后续变更通知。
      // 订阅者抛错不能污染订阅注册流程——与 badge 通知一致，记录并忽略。
      try {
        listener(getSummaryAttentionBadge());
      } catch (error) {
        console.warn(
          "[external-summary-attention] subscriber failed on initial snapshot",
          error,
        );
      }
      if (disposed) return () => {};
      const unsub = subscribeSummaryAttentionBadge(listener);
      subscriptions.add(unsub);
      return () => {
        if (subscriptions.delete(unsub)) unsub();
      };
    },
    refresh(reason: 'mutation' | 'manual-refresh' = 'manual-refresh'): Promise<void> {
      if (disposed) return Promise.resolve();
      try {
        return requestRefresh(reason);
      } catch (error) {
        // 与 refreshSummaryAttentionBadge 的外部委托一致：宿主异常静默。
        return Promise.reject(error);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (activeExternalControllerId === id) {
        activeExternalControllerId = null;
      }
      // 清除外部模式标志 + 作废在飞旧号
      clearSummaryAttentionExternal();
      // 移除本控制器注册的全部订阅，避免 dispose 后残留。
      for (const unsub of subscriptions) {
        try { unsub(); } catch { /* 收集阶段的单个取消异常不应阻断收尾。 */ }
      }
      subscriptions.clear();
      // 不启动任何本地 fallback（由宿主自行判断是否需要降级为本地模式）。
    },
  };

  return controller;
}

/**
 * 当前是否有活跃的外部控制器（诊断用）。
 */
export function hasActiveExternalController(): boolean {
  return activeExternalControllerId !== null;
}

/**
 * 测试/诊断用：重置外部控制器模块状态。不清除已安装控制器的排除。
 * 调用方必须保证无活跃控制器时调用此函数（通常只在测试的 afterEach 中主动
 * 调用，或确认 dispose 之后调用）。
 */
export function resetExternalAttentionState(): void {
    activeExternalControllerId = null;
}
