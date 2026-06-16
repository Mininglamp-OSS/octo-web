import { WKApp } from '@octo/base';

/**
 * 聊天上下文里创建总结成功后的收尾动作。
 *
 * 关键点：聊天侧栏创建总结后**不应**调用 `WKApp.openSummaryDetail`——后者会无条件
 * `switchToMenuById("summary")`，把用户从聊天踢到「智能总结」主 Tab。这里改为只在
 * 聊天侧栏内打开/刷新「智能总结」面板。`forceOpen` 保证面板已打开时不会被 toggle 关闭；
 * 新任务由 ChatSummaryNewModal 派发的 window 'chat-summary-created' 事件驱动列表刷新。
 */
export function notifyChatSummaryCreated(channel: {
    channelID: string;
    channelType: number;
}): void {
    WKApp.mittBus.emit('wk:toggle-summary-panel', {
        channelId: channel.channelID,
        channelType: channel.channelType,
        summaryPanelView: 'history',
        forceOpen: true,
    });
}
