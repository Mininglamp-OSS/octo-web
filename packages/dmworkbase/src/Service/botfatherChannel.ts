export const BOTFATHER_UID = "botfather"

/**
 * BotFather DM 的 channel-id 判定。DAP「BotFather 命令使用分布」图的分母
 * (`botfather_opened`,`Pages/Chat` 挂载)与分子(botfather 命令事件,`Conversation/vm.ts`)
 * **共用本判定**,保证图两侧永远同步——只要有一侧的门收窄/放宽,另一侧随之变化。
 *
 * 用**后缀匹配**而非 `=== "botfather"`:Space 部署下 Person channelID =
 * `s{spaceId}_botfather`(`pkg/space/channel.go` BuildChannelID;spaceId 为任意字符串,
 * 真实部署是 `minglue_default` → `sminglue_default_botfather`,`pkg/space/channel_test.go:12` 钉)。
 * 裸 `botfather` 只在无 Space 时出现。对齐后端 `modules/botfather/api.go:168`
 * `rawToUID == BotFatherUID || strings.HasSuffix(rawToUID, "_"+BotFatherUID)`。
 *
 * **不能用 `stripSpacePrefix`**:其正则 `^s[0-9a-f]{32}_` 只认 32-hex spaceId,脱不掉
 * `minglue_default` 这类真实 id → 硬等 `=== "botfather"` 会让分母在真实 Space 部署恒 0(PR #1510 P1-1)。
 *
 * 注:与后端一致,对固定 UID 采后缀匹配是无歧义的;不覆盖 `SpaceService`/`Model` 等处已有的
 * 五处裸 `=== "botfather"` 比较(那属同类历史问题,另开 issue,不在本改动范围)。
 */
export function isBotfatherChannelID(channelID: string): boolean {
    return channelID === BOTFATHER_UID || channelID.endsWith("_" + BOTFATHER_UID)
}
