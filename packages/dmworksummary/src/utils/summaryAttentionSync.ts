/**
 * 让侧边栏红点能被「别人的动作」唤醒。
 *
 * 现状（本文件要补的洞）：`refreshSummaryAttentionBadge` 的所有调用点都挂在
 * **本人的本地动作**上——详情页提交/应答/已读/重新生成、确认页、切 Space、冷启动。
 * 于是别人拉你进一个多人总结、或总结在后台跑完时，本地什么都没发生，角标就不动，
 * 用户必须手动刷新页面（走 space-ready 首刷）才看得到。
 *
 * `SummaryListPage` 的 2s 批量轮询救不了这个场景，三重限制：
 *   1. 只在列表**挂载时**跑（用户待在聊天界面时它根本没挂载）；
 *   2. 只轮询**列表里已有**的任务（别人新建的邀请不在列表里，永远轮不到）；
 *   3. 只轮询**非终态**任务（已完成的未读也轮不到）。
 *
 * 本文件只负责事件驱动的快速刷新；无人值守场景由独立的自适应轮询兜底
 * （summaryAttentionPoll.ts）。这里只在**已经发生的外部事件**上顺带刷一次：
 *   - 标签页重新可见 / 窗口重新聚焦（用户回到 OCTO，最常见的入口）；
 *   - IM 重连成功（离线期间的变更需要补齐）；
 *   - 收到群内「总结完成」提示消息（type-21 或 PR1534 之后的 WK_TIP 2000）。
 *
 * 邀请场景**没有** IM 推送可依赖（产品决定邀请不发 IM，internal/notify 只有
 * completed/failed），所以它靠的是前两条——用户回到标签页时就会看到。
 *
 * 所有触发共用一个固定窗口，避免“切回标签页”同时触发 visibility + focus 时
 * 打两枪。
 */

export interface AttentionSyncDeps {
    refresh: () => void;
    now?: () => number;
    debounceMs?: number;
}

/** 群内总结完成提示。`Const.summaryNotify`，见 dmworkbase/src/Service/Const.ts。 */
export const SUMMARY_NOTIFY_CONTENT_TYPE = 21;

/**
 * WK_TIP 系统消息号段。PR1534(#1379) 把总结完成提示从自定义 type-21 改成
 * WK_TIP(2000) 以免 App 适配，所以两代消息都要认。
 */
export const SUMMARY_TIP_CONTENT_TYPE = 2000;

/**
 * 这条消息是否值得刷角标。
 *
 * 不解析文案：总结提示的正文是服务端下发模板，按文案匹配会被 i18n 和模板
 * 改动打碎。只认两代明确类型，避免普通加群/频道更新系统消息触发 fresh 请求。
 */
export function shouldRefreshForMessage(message: unknown): boolean {
    const contentType = (message as { contentType?: unknown } | null | undefined)?.contentType;
    if (typeof contentType !== 'number' || !Number.isFinite(contentType)) return false;
    return contentType === SUMMARY_NOTIFY_CONTENT_TYPE || contentType === SUMMARY_TIP_CONTENT_TYPE;
}

/**
 * 固定窗口节流调度器。返回的 `trigger` 可以被任意触发源调用。
 *
 * 语义是【固定窗口】而非尾部去抖（CR round-6 术语纠正）：第一个 trigger 排一个
 * `debounceMs` 后执行的任务，窗口内后续的 trigger 被【丢弃】而不是重置计时器。
 * 选固定窗口是有意的：真去抖下，持续不断的事件流（例如重连后持续涌入的消息）
 * 会把刷新无限期往后推；固定窗口保证“最晚 `debounceMs` 后一定会刷一次”，
 * 同时仍然把成簇事件压成一个请求。
 */
export function createAttentionSync(deps: AttentionSyncDeps) {
    const debounceMs = deps.debounceMs ?? 800;
    const now = deps.now ?? Date.now;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRunAt = 0;

    const run = () => {
        timer = null;
        lastRunAt = now();
        deps.refresh();
    };

    return {
        trigger(): void {
            if (timer !== null) return;
            timer = setTimeout(run, debounceMs);
        },
        /** 立即刷新并重置窗口。用于必须尽快反映的场景。 */
        triggerNow(): void {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            run();
        },
        cancel(): void {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        },
        /** 测试用：上次真正执行刷新的时刻。 */
        getLastRunAt(): number {
            return lastRunAt;
        },
    };
}

export type AttentionSync = ReturnType<typeof createAttentionSync>;
