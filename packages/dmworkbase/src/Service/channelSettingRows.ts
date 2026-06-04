import { Channel, ChannelInfo } from "wukongimjssdk"
import { ChannelTypeGroup } from "wukongimjssdk"
import { Row } from "./Section"
import { ListItemSwitch, ListItemSwitchContext } from "../Components/ListItem"
import { ChannelSettingManager } from "./ChannelSetting"

/**
 * 群级「允许群内 Bot 免@回答」总开关行（YUJ-3088 / 配套 YUJ-2996）。
 *
 * 两轴语义：最终免at = bot主人开了本群免at(no_mention) AND 群管理员允许本群免at(allow_no_mention)。
 * 本行管的是「群管理员 allow_no_mention 轴」。
 *
 * 可见性守卫：
 *   - 仅 ChannelTypeGroup（排除 CustomerService / CommunityTopic）；
 *   - 仅群主/管理员（isManagerOrCreator）；普通成员返回 undefined（不渲染）。
 *
 * checked：channelInfo.orgData.allow_no_mention !== 0，默认开（缺省=1，零回归）。
 * onCheck：loading=true → setAllowNoMention → 成功 loading=false + refresh()；失败 loading=false。
 */
export function buildAllowNoMentionRow(opts: {
    channel: Channel
    channelInfo?: ChannelInfo
    isManagerOrCreator: boolean
    title: string
    refresh: () => void
}): Row | undefined {
    const { channel, channelInfo, isManagerOrCreator, title, refresh } = opts

    if (channel.channelType !== ChannelTypeGroup) {
        return undefined
    }
    if (!isManagerOrCreator) {
        return undefined
    }

    return new Row({
        cell: ListItemSwitch,
        properties: {
            title,
            checked: channelInfo?.orgData?.allow_no_mention !== 0,
            onCheck: (v: boolean, ctx: ListItemSwitchContext) => {
                ctx.loading = true
                ChannelSettingManager.shared
                    .setAllowNoMention(v, channel)
                    .then(() => {
                        ctx.loading = false
                        refresh()
                    })
                    .catch(() => {
                        ctx.loading = false
                    })
            },
        },
    })
}
