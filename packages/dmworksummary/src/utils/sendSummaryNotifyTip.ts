import { Channel, ChannelTypeGroup, WKSDK } from 'wukongimjssdk';
import { ChannelTypeCommunityTopic, WKApp, SummaryNotifyContent } from '@octo/base';
import type { SourceItem } from '../types/summary';
import { SourceType } from '../types/summary';

/**
 * Send a "XXX summarized the chat" tip message to each source group/thread.
 *
 * Modeled after the screenshot notification (contentType=20):
 * - Client constructs a SummaryNotifyContent (contentType=21) with from_uid/from_name
 * - Sends directly via WuKongIM SDK to each source channel
 * - Renders as a grey system tip in the chat
 *
 * Only group and thread sources receive the notification (DMs are skipped).
 * Errors are silently ignored — the tip is best-effort.
 */
export async function sendSummaryNotifyTip(sources: SourceItem[]): Promise<void> {
    if (!sources || sources.length === 0) return;

    const uid = WKApp.loginInfo.uid;
    const name = WKApp.loginInfo.name || '';

    for (const source of sources) {
        try {
            let channel: Channel | null = null;

            if (source.source_type === SourceType.GROUP_CHAT) {
                channel = new Channel(source.source_id, ChannelTypeGroup);
            } else if (source.source_type === SourceType.THREAD) {
                // Thread channels use ChannelTypeCommunityTopic (5)
                channel = new Channel(source.source_id, ChannelTypeCommunityTopic);
            }
            // Skip DM sources — no need to notify yourself

            if (!channel) continue;

            const msg = new SummaryNotifyContent();
            msg.fromUID = uid;
            msg.fromName = name;

            await WKSDK.shared().chatManager.send(msg, channel);
        } catch {
            // Best-effort: don't block on notification failures
        }
    }
}
