import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * bridge 层实名徽章分支判定单测。
 *
 * 背景：
 *   PR#1170 在 bridge/message/useMessageRow.ts 的 getMessageRow 里
 *   引入了「实名徽章」判断分支：
 *     1. 群成员 orgData.realname_verified → isRealnameVerified=true
 *     2. 群成员 orgData 缺失 → 回落 Person channelInfo.orgData
 *     3. bot 发送者（channelInfo.orgData.robot=1）→ 无论 realname_verified
 *        如何，一律压制为 false
 *
 *   UI 集成测试（MessageRow.test.tsx）只覆盖 props 透传，拦不住 bridge
 *   层的跨层 regression（比如有人「顺手」把 fallback 顺序反过来，或把
 *   bot 压制忘了）。这个文件就是在 bridge 层把 3 条分支钉死，任何回归
 *   直接红。
 */

const mockState = vi.hoisted(() => ({
    subscribesByChannel: new Map<string, any[]>(),
    channelInfoByUID: new Map<string, any>(),
    currentSpaceId: "",
    // self-viewer fallback 需要访问 WKApp.loginInfo.{uid,realnameVerified}
    loginInfoUid: "",
    loginInfoRealnameVerified: undefined as boolean | undefined,
    // self displayName 走 loginInfo.selfDisplayName() / .realName / .name
    loginInfoName: "",
    loginInfoRealName: undefined as string | undefined,
}))

vi.mock("../../../App", () => ({
    default: {
        shared: {
            get currentSpaceId() {
                return mockState.currentSpaceId
            },
            avatarUser: (uid: string) => `avatar://${uid}`,
        },
        loginInfo: {
            get uid() {
                return mockState.loginInfoUid
            },
            get realnameVerified() {
                return mockState.loginInfoRealnameVerified
            },
            get name() {
                return mockState.loginInfoName
            },
            get realName() {
                return mockState.loginInfoRealName
            },
            // mirror LoginInfo.selfDisplayName() runtime shape.
            selfDisplayName() {
                if (
                    mockState.loginInfoRealnameVerified === true &&
                    typeof mockState.loginInfoRealName === "string" &&
                    mockState.loginInfoRealName.length > 0
                ) {
                    return mockState.loginInfoRealName
                }
                return mockState.loginInfoName || ""
            },
        },
    },
}))

vi.mock("wukongimjssdk", async () => {
    const actual: any = await vi.importActual("wukongimjssdk")
    const sharedStub = {
        channelManager: {
            getChannelInfo: (ch: any) =>
                mockState.channelInfoByUID.get(ch.channelID),
            getSubscribes: (ch: any) =>
                mockState.subscribesByChannel.get(ch.channelID) || [],
        },
    }
    const stub = { shared: () => sharedStub }
    return {
        ...actual,
        // wukongimjssdk 同时暴露 default + named export `WKSDK`，
        // useMessageRow.ts 用 default import，所以 mock 两侧都要覆盖。
        default: stub,
        WKSDK: stub,
    }
})

import { getMessageRow } from "../useMessageRow"
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk"

function makeGroupMessage(opts: {
    fromUID: string
    groupID: string
}): any {
    const channel = new Channel(opts.groupID, ChannelTypeGroup)
    return {
        send: false,
        fromUID: opts.fromUID,
        channel,
        preMessage: undefined,
        timestamp: 1715000000,
        revoke: false,
        message: { remoteExtra: {} },
        fromHomeSpaceId: undefined,
        fromHomeSpaceName: undefined,
        fromIsExternal: false,
        fromSourceSpaceName: undefined,
    }
}

/**
 * 1v1 Person 会话消息工厂。
 *
 * message.channel 的 channelID 是对话 **对端** 的 UID：
 *   - 我给 bot 发消息 → fromUID=自己, conversationPeerUID=botUID
 *   - bot 给我发消息 → fromUID=botUID, conversationPeerUID=botUID
 *
 * 用于测 `isBotConversation`（按 message.channel 判）而非 `isBotSender`
 * （按 message.fromUID 查 Person channelInfo 判）。
 */
function makePersonMessage(opts: {
    fromUID: string
    conversationPeerUID: string
}): any {
    const channel = new Channel(opts.conversationPeerUID, ChannelTypePerson)
    return {
        send: false,
        fromUID: opts.fromUID,
        channel,
        preMessage: undefined,
        timestamp: 1715000000,
        revoke: false,
        message: { remoteExtra: {} },
        fromHomeSpaceId: undefined,
        fromHomeSpaceName: undefined,
        fromIsExternal: false,
        fromSourceSpaceName: undefined,
    }
}

describe("getMessageRow — realname badge branch logic", () => {
    beforeEach(() => {
        mockState.subscribesByChannel.clear()
        mockState.channelInfoByUID.clear()
        mockState.currentSpaceId = ""
        mockState.loginInfoUid = ""
        mockState.loginInfoRealnameVerified = undefined
        // reset self displayName mock state between tests.
        mockState.loginInfoName = ""
        mockState.loginInfoRealName = undefined
    })

    it("branch 1: 群成员 orgData.realname_verified=true → isRealnameVerified=true (primary path)", () => {
        // 群消息场景：subscriber 列表里命中 fromUID，orgData 标记已实名
        mockState.subscribesByChannel.set("g_alpha", [
            {
                uid: "u_alice",
                name: "alice",
                remark: "",
                orgData: { real_name: "Alice Wang", realname_verified: true },
            },
        ])
        // channelInfo 缺失 / 不影响分支判定
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_alice", groupID: "g_alpha" })
        )
        expect(row.isRealnameVerified).toBe(true)
        // 顺带验证名称走群成员路径（remark 空 → real_name，因为已 verified）
        expect(row.senderName).toBe("Alice Wang")
        expect(row.isBot).toBe(false)
    })

    it("branch 2: 群成员 orgData 缺失 + Person channelInfo.orgData.realname_verified=true → fallback → true", () => {
        // 群成员列表里没这个 uid（分页外 / 时序尚未到达），
        // Person channelInfo 有并标记实名，应回落并判 true。
        mockState.subscribesByChannel.set("g_beta", []) // 无命中
        mockState.channelInfoByUID.set("u_bob", {
            channel: new Channel("u_bob", ChannelTypePerson),
            title: "bob_nick",
            orgData: {
                realname_verified: true,
                real_name: "Bob Li",
                displayName: "Bob Li",
            },
        })
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_bob", groupID: "g_beta" })
        )
        expect(row.isRealnameVerified).toBe(true)
        // 群成员未命中时 senderName 走 channelInfo displayName 路径
        expect(row.senderName).toBe("Bob Li")
    })

    it("branch 3: bot sender (channelInfo.orgData.robot=1) → 一律 false，不管 realname_verified 和群成员 orgData", () => {
        // 即使 Person channelInfo 与群成员 orgData 都声称已实名，bot 也必须压制
        mockState.subscribesByChannel.set("g_gamma", [
            {
                uid: "u_botty",
                name: "GPT-Boy",
                orgData: { realname_verified: true, real_name: "Fake Human" },
            },
        ])
        mockState.channelInfoByUID.set("u_botty", {
            channel: new Channel("u_botty", ChannelTypePerson),
            title: "GPT-Boy",
            orgData: {
                realname_verified: true,
                real_name: "Fake Human",
                robot: 1, // ← 关键：bot 标识
                displayName: "GPT-Boy",
            },
        })
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_botty", groupID: "g_gamma" })
        )
        expect(row.isBot).toBe(true)
        expect(row.isRealnameVerified).toBe(false)
    })

    it("regression guard: 未实名 + 非 bot → false（字段全缺 / false 都走此分支）", () => {
        // 群成员 orgData 存在但 realname_verified=false；channelInfo 无 orgData。
        // 不应误渲染徽章。
        mockState.subscribesByChannel.set("g_delta", [
            {
                uid: "u_plain",
                name: "plain_user",
                orgData: { realname_verified: false },
            },
        ])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_plain", groupID: "g_delta" })
        )
        expect(row.isBot).toBe(false)
        expect(row.isRealnameVerified).toBe(false)
    })

    it("GH#326: 群消息存在个人备注时，senderName 优先使用 Person channelInfo 备注", () => {
        mockState.subscribesByChannel.set("g_remark", [
            {
                uid: "u_bot",
                name: "Bot Original",
                remark: "Group Bot Name",
            },
        ])
        mockState.channelInfoByUID.set("u_bot", {
            channel: new Channel("u_bot", ChannelTypePerson),
            title: "Bot Original",
            orgData: {
                remark: "Personal Bot Alias",
                displayName: "Personal Bot Alias",
                robot: 1,
            },
        })
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_bot", groupID: "g_remark" })
        )
        expect(row.senderName).toBe("Personal Bot Alias")
    })

    it("GH#326: 个人备注为空时仍回退到群成员名，避免 Person displayName 抢占群昵称", () => {
        mockState.subscribesByChannel.set("g_no_remark", [
            {
                uid: "u_bot",
                name: "Bot Original",
                remark: "Group Bot Name",
            },
        ])
        mockState.channelInfoByUID.set("u_bot", {
            channel: new Channel("u_bot", ChannelTypePerson),
            title: "Bot Original",
            orgData: {
                remark: "",
                displayName: "Bot Real Name",
                robot: 1,
            },
        })
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_bot", groupID: "g_no_remark" })
        )
        expect(row.senderName).toBe("Group Bot Name")
    })

    // ---------------------------------------------------------------------
    // 自己看自己的消息也显示实名徽章
    //
    // 背景：客户端群成员订阅列表通常不缓存 "自己" 的条目（WKSDK 优化，self
    // 走 WKApp.loginInfo 路径），且群 channelInfo orgData 不带 realname_verified
    // → branch 1/2 两路 fallback 对 self 永远拿不到。故追加 self-viewer fallback
    // 读 WKApp.loginInfo.realnameVerified。
    // ---------------------------------------------------------------------

    it("branch 5: own message + WKApp.loginInfo.realnameVerified=true → isRealnameVerified=true", () => {
        // 关键场景：自己发的消息，群成员缓存和 channelInfo 都拿不到 self 的
        // orgData（真实线上情形），仅靠 WKApp.loginInfo 断定。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        // 群成员列表空（WKSDK 通常不缓存 self），channelInfo 也缺失
        mockState.subscribesByChannel.set("g_self1", [])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_self", groupID: "g_self1" })
        )
        expect(row.isBot).toBe(false)
        expect(row.isRealnameVerified).toBe(true)
    })

    it("branch 5 negative: own message + realnameVerified=false → isRealnameVerified=false", () => {
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = false
        mockState.subscribesByChannel.set("g_self2", [])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_self", groupID: "g_self2" })
        )
        expect(row.isRealnameVerified).toBe(false)
    })

    it("branch 5 tri-state guard: own message + realnameVerified=undefined → false（严格 === true 判断）", () => {
        // Phase A 血泪教训：realnameVerified 是 boolean | undefined，
        // 若 fallback 用 truthy 判断，undefined 仍会被意外放行。这里钉死
        // undefined 必须判 false。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = undefined
        mockState.subscribesByChannel.set("g_self3", [])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_self", groupID: "g_self3" })
        )
        expect(row.isRealnameVerified).toBe(false)
    })

    it("branch 5 precedence: own message + realnameVerified=true BUT groupMember.orgData.realname_verified=false → 仍 true (self-fallback 兜底)", () => {
        // 防御：即使 groupMember 不知为何把自己带进列表了且 false（理论不该出现，
        // 但兜底防止 SDK 行为变更），self-fallback 通过 OR 连接仍能让整体为 true，
        // 保证 self-viewer 体验不回归。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        mockState.subscribesByChannel.set("g_self4", [
            {
                uid: "u_self",
                name: "me",
                orgData: { realname_verified: false },
            },
        ])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_self", groupID: "g_self4" })
        )
        expect(row.isRealnameVerified).toBe(true)
    })

    it("branch 5 bot guard: own message + realnameVerified=true BUT sender is bot → false（!isBotSender 优先级不变）", () => {
        // 硬约束：bot 发送者优先级不变。即便 fromUID===self 且 loginInfo 实名，
        // bot 依然不渲染徽章。!isBotSender 外层短路。
        mockState.loginInfoUid = "u_selfbot"
        mockState.loginInfoRealnameVerified = true
        mockState.channelInfoByUID.set("u_selfbot", {
            channel: new Channel("u_selfbot", ChannelTypePerson),
            title: "selfbot",
            orgData: { robot: 1, displayName: "selfbot" },
        })
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_selfbot", groupID: "g_self5" })
        )
        expect(row.isBot).toBe(true)
        expect(row.isRealnameVerified).toBe(false)
    })

    it("branch 5 scope guard: other-viewer path 不受影响 —— fromUID !== self + loginInfo.realnameVerified=true → 走原有 branch 1/2/4", () => {
        // 硬约束：只影响 self-viewer path。别人发的消息仍需靠 groupMember/
        // channelInfo 的 realname_verified，不能被 viewer 自己的实名状态污染。
        mockState.loginInfoUid = "u_me"
        mockState.loginInfoRealnameVerified = true
        // 对方未实名：两路都 false，整体应为 false
        mockState.subscribesByChannel.set("g_other", [
            {
                uid: "u_other",
                name: "other",
                orgData: { realname_verified: false },
            },
        ])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_other", groupID: "g_other" })
        )
        expect(row.isRealnameVerified).toBe(false)
    })

    // ---------------------------------------------------------------------
    // R3 (Jerry R2 Critical): "是不是 bot 会话" 必须按
    // `message.channel` 判，而不是按 `message.fromUID` 查 Person channelInfo 判。
    //
    // R1/R2 的 bug：自己在 bot 1v1 里发消息时
    //   - fromUID = self_uid → 按发送者查到的 channelInfo 是自己的 Person
    //     (robot≠1) → isBotSender=false
    //   - isOwnMessage=true + WKApp.loginInfo.realnameVerified=true → self-fallback
    //     命中 → 自己发给 bot 的消息错误显示实名 ✓
    //
    // 修复：新增 conversationChannelInfo = getChannelInfo(message.channel)，
    // 从而 isBotConversation 能正确判成 true，在 helper 里先于 self-fallback
    // 短路。
    // ---------------------------------------------------------------------

    it("🔑 R3 Critical regression: 自己在 bot 1v1 里发消息 → isBotConversation=true → 不显示徽章 (防 Jerry R2 回归)", () => {
        // 建模真实场景：
        //   - fromUID = self，message.channel.channelID = botUID
        //   - channelInfoByUID[self] 未设置（SDK 对 self 不缓存 Person channelInfo）
        //   - channelInfoByUID[botUID] = { orgData: { robot: 1 } }（message.channel 查得到）
        //   - WKApp.loginInfo.realnameVerified = true（self-fallback 本会命中）
        // 期望：isBotConversation 短路 → isRealnameVerified=false
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        mockState.channelInfoByUID.set("u_bot", {
            channel: new Channel("u_bot", ChannelTypePerson),
            title: "Assistant",
            orgData: { robot: 1, displayName: "Assistant" },
        })
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_self",
                conversationPeerUID: "u_bot",
            })
        )
        // isBot 反映 **发送者** channelInfo，不一定=isBotConversation。
        // 这里 fromUID=self、self 的 Person channelInfo 未设 → isBot=false。
        // 关键断言：实名徽章不能亮。
        expect(row.isRealnameVerified).toBe(false)
    })

    it("R3: bot 在 1v1 里给我发消息 → isBotConversation=true → 不显示徽章", () => {
        // fromUID=botUID、channel=Person(botUID)：从发送者查到的 channelInfo
        // 也是 bot 的 Person，所以 isBotSender 也 true。双保险，但 helper 里
        // isBotConversation 先短路。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = false
        mockState.channelInfoByUID.set("u_bot", {
            channel: new Channel("u_bot", ChannelTypePerson),
            title: "Assistant",
            orgData: { robot: 1, displayName: "Assistant" },
        })
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_bot",
                conversationPeerUID: "u_bot",
            })
        )
        expect(row.isBot).toBe(true)
        expect(row.isRealnameVerified).toBe(false)
    })

    it("R3: 普通 Person 1v1（对端非 bot）+ 自己发送 + realnameVerified=true → self-fallback 仍命中 → true", () => {
        // 对端是普通人的 1v1 会话：isBotConversation=false，self-fallback 应该
        // 照常生效，保证产品诉求「Web 上自己看自己的 ✓」不回归。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        mockState.channelInfoByUID.set("u_friend", {
            channel: new Channel("u_friend", ChannelTypePerson),
            title: "Friend",
            orgData: { displayName: "Friend" },
        })
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_self",
                conversationPeerUID: "u_friend",
            })
        )
        expect(row.isRealnameVerified).toBe(true)
    })

    it("R3: 普通群会话 + self + realnameVerified=true → self-fallback 仍命中 → true", () => {
        // 普通群：group channelInfo 未缓存（robot undefined） → isBotConversation=false。
        // self-fallback 正常生效。回归保护。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        mockState.subscribesByChannel.set("g_normal", [])
        const row = getMessageRow(
            makeGroupMessage({ fromUID: "u_self", groupID: "g_normal" })
        )
        expect(row.isRealnameVerified).toBe(true)
    })

    // ---------------------------------------------------------------------
    // R4 (Jerry R3 Non-blocking): conversation channelInfo timing race.
    //
    // 场景：message.channel 对应的 Person channelInfo 首帧未缓存。R3 的
    // useMessageRow 只监听 fromUID 的 channelInfo 到达；如果 fromUID=self
    // 且对端是 bot，self 的 Person channelInfo 本就不缓存（SDK 行为），
    // 对端 bot 的 channelInfo 如果也没到，`isBotConversation` 就会被误判
    // 为 false → self-fallback 错误亮徽章。
    //
    // R4 修复：
    //   1. getMessageRow 对 Person 1v1 + self-sent + conversationChannelInfo
    //      缺失 场景采取保守策略（把 isBotConversation 当 true），压制 self-fallback。
    //   2. useMessageRow hook 新增 message.channel 的 fetchChannelInfo + listener，
    //      待 channelInfo 到达后 forceUpdate rerender，回到真实判定路径。
    //
    // 以下两个单测钉死「纯判定层」在 conversationChannelInfo 有/无 两种
    // timing 状态下的行为，防止保守策略被误删或被过度放宽。
    // ---------------------------------------------------------------------

    it("🔴 R4 timing race: conversation channelInfo 首帧未缓存 + self-sent Person 1v1 → 保守压制 → 徽章不显示", () => {
        // 建模真实 race：
        //   - fromUID = self（SDK 不缓存 self 的 Person channelInfo）
        //   - message.channel = Person(u_bot) 但 channelInfoByUID 里没 u_bot
        //   - WKApp.loginInfo.realnameVerified = true（self-fallback 本会命中）
        // 期望：isRealnameVerified=false（保守策略，因为我们还不能区分 bot/非 bot，
        // 不应该让首帧错误亮 ✓ 在 bot DM 里）。
        // 待 useMessageRow 的 fetchChannelInfo 回包后 rerender 会走真实路径。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        // 故意不 set channelInfoByUID for conversation peer
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_self",
                conversationPeerUID: "u_bot",
            })
        )
        expect(row.isRealnameVerified).toBe(false)
    })

    it("R4 timing race: conversation channelInfo 后到达（非 bot）→ rerender 后 self-fallback 正确放行 → true", () => {
        // fetchChannelInfo 回包后的状态：u_friend 的 channelInfo 已进缓存且
        // robot!=1。此时 conservativeMissing=false，isBotConversation=false
        // （robot 不等于 1），self-fallback 命中 → true。
        //
        // 这和「R3 普通 Person 1v1」场景语义相同，但这里特别聚焦在
        // 「race 结束后状态」，防止 R4 的保守策略被过度放宽（不允许在
        // channelInfo 已到达的情况下也压制徽章）。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = true
        mockState.channelInfoByUID.set("u_friend", {
            channel: new Channel("u_friend", ChannelTypePerson),
            title: "Friend",
            orgData: { displayName: "Friend" }, // robot undefined
        })
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_self",
                conversationPeerUID: "u_friend",
            })
        )
        expect(row.isRealnameVerified).toBe(true)
    })

    it("R4 scope guard: conversation channelInfo 缺失 + other-sent Person 1v1 → 保守策略不触发（只影响 self-sent path）", () => {
        // 对方发给我的消息（fromUID=friend，peer=friend）。即便 conversationChannelInfo
        // 缺失，保守策略不应该触发 —— self-fallback 本来也不会走（isOwnMessage=false）。
        // 但发送者 Person channelInfo 若已 verified 仍需正常亮徽章。
        mockState.loginInfoUid = "u_self"
        mockState.loginInfoRealnameVerified = false
        mockState.channelInfoByUID.set("u_friend", {
            channel: new Channel("u_friend", ChannelTypePerson),
            title: "Friend",
            orgData: {
                realname_verified: true,
                real_name: "Friend Wu",
                displayName: "Friend Wu",
            },
        })
        // 注意：makePersonMessage 里 conversationPeerUID 就是 message.channel 的
        // channelID。这里 fromUID=friend，peer=friend（1v1 里对方给我发）。
        // conversationChannelInfo 此时能查到（同 friend），但我们故意测另一情景 —
        // 对端 channelInfo 非 self 时走普通路径。保守策略只在 isOwnMessage=true 时
        // 启用，这里 isOwnMessage=false，所以即使缺失也不会被压制。
        const row = getMessageRow(
            makePersonMessage({
                fromUID: "u_friend",
                conversationPeerUID: "u_friend",
            })
        )
        expect(row.isRealnameVerified).toBe(true)
    })
})
