import { describe, it, expect, beforeAll } from "vitest"
import {
    buildChatContext,
    ChatContextMember,
    ChatContextMessage,
    ChatContextChannelInfo,
} from "@octo/base/src/Components/Conversation/chatContext"
import { i18n } from "@octo/base/src/i18n/instance"

// Pin the locale so member_context assertions are deterministic regardless of
// the host navigator language (jsdom defaults to en-US).
beforeAll(() => {
    i18n.setLocale("zh-CN", { persist: false, notify: false })
})

const ChannelTypePerson = 1
const ChannelTypeGroup = 2
const ChannelTypeCommunityTopic = 5

const LOGIN_UID = "me"

// member_context prefix (聊天成员：)
const PREFIX = "聊天成员："
const members = (body: string) => PREFIX + body

type OrgData = {
    real_name?: string | null
    realname_verified?: boolean | number | string | null
    robot?: number
}

function makeMember(
    uid: string,
    name?: string,
    remark?: string,
    isDeleted?: number,
    orgData?: OrgData,
): ChatContextMember {
    return { uid, name, remark, isDeleted: isDeleted ?? 0, orgData }
}

function makeMessage(fromUID: string, text?: string, senderTitle?: string): ChatContextMessage {
    return {
        fromUID,
        from: senderTitle ? { title: senderTitle } : undefined,
        content: text ? { text } : undefined,
    }
}

describe("buildChatContext", () => {
    describe("group chat with ≤100 members (strategy 1)", () => {
        it("should collect all member names", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Bob"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice，Bob"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should list name and remark as separate comma entries (group nick first)", () => {
            const subscribers = [
                makeMember("u1", "Alice", "小A"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("小A，Alice"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should not duplicate when remark equals name", () => {
            const subscribers = [
                makeMember("u1", "Alice", "Alice"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should exclude current user", () => {
            const subscribers = [
                makeMember(LOGIN_UID, "Me"),
                makeMember("u1", "Alice"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should exclude deleted members", () => {
            const subscribers = [
                makeMember("u1", "Alice", undefined, 1),
                makeMember("u2", "Bob"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Bob"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should skip empty/whitespace names", () => {
            const subscribers = [
                makeMember("u1", "", "Nickname"),
                makeMember("u2", "  ", "  "),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Nickname"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should deduplicate names across members", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Alice"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should append messages after member names line", () => {
            const subscribers = [makeMember("u1", "Alice")]
            const messages = [makeMessage("u1", "hello", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBe("[Alice]: hello")
        })

        it("should handle exactly 100 members (still strategy 1)", () => {
            const subscribers: ChatContextMember[] = []
            for (let i = 0; i < 100; i++) {
                subscribers.push(makeMember(`u${i}`, `User${i}`))
            }
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toContain(PREFIX)
            expect(result.memberContext!.replace(PREFIX, "").split("，").length).toBe(100)
        })
    })

    describe("realname (real_name / orgData) handling", () => {
        it("lists all three layers as separate comma entries when all differ (实名/群昵称/昵称)", () => {
            const subscribers = [
                makeMember("u1", "zhangsan", "小张", 0, {
                    real_name: "张三",
                    realname_verified: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("张三，小张，zhangsan"))
        })

        it("real_name=王大棍, remark=棍哥, name=大棍子 → three separate comma entries", () => {
            const subscribers = [
                makeMember("u1", "大棍子", "棍哥", 0, {
                    real_name: "王大棍",
                    realname_verified: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("王大棍，棍哥，大棍子"))
            expect(result.memberContext).not.toContain("王大棍/棍哥/大棍子")
        })

        it("dedupes when real_name equals remark (real_name==群昵称)", () => {
            const subscribers = [
                makeMember("u1", "lisi", "李四", 0, {
                    real_name: "李四",
                    realname_verified: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("李四，lisi"))
        })

        it("collapses to bare name when all three are identical", () => {
            const subscribers = [
                makeMember("u1", "王五", "王五", 0, {
                    real_name: "王五",
                    realname_verified: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("王五"))
        })

        it("falls back to nickname/remark when not verified (有群昵称)", () => {
            const subscribers = [
                makeMember("u1", "zhao", "老赵", 0, {
                    real_name: "赵真名",
                    realname_verified: 0,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("老赵，zhao"))
        })

        it("falls back to bare nickname when not verified and no remark", () => {
            const subscribers = [
                makeMember("u1", "qian", undefined, 0, {
                    real_name: "钱真名",
                    realname_verified: false,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("qian"))
        })

        it("accepts verified as string \"1\"", () => {
            const subscribers = [
                makeMember("u1", "zhangsan", undefined, 0, {
                    real_name: "张三",
                    realname_verified: "1",
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("张三，zhangsan"))
        })

        it("accepts verified as string \"true\"", () => {
            const subscribers = [
                makeMember("u1", "zhangsan", undefined, 0, {
                    real_name: "张三",
                    realname_verified: "true",
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("张三，zhangsan"))
        })

        it("ignores empty real_name even when verified=true (no stray /)", () => {
            const subscribers = [
                makeMember("u1", "zhangsan", undefined, 0, {
                    real_name: "",
                    realname_verified: true,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("zhangsan"))
        })

        it("does not augment realname for bots (robot===1)", () => {
            const subscribers = [
                makeMember("u1", "客服助手", undefined, 0, {
                    real_name: "X",
                    realname_verified: 1,
                    robot: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("客服助手"))
        })

        it("joins multiple members with full-width comma", () => {
            const subscribers = [
                makeMember("u1", "zhangsan", "小张", 0, {
                    real_name: "张三",
                    realname_verified: 1,
                }),
                makeMember("u2", "lisi", "李四", 0, {
                    real_name: "李四",
                    realname_verified: 1,
                }),
                makeMember("u3", "王五", "王五", 0, {
                    real_name: "王五",
                    realname_verified: 1,
                }),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(
                members("张三，小张，zhangsan，李四，lisi，王五"),
            )
        })

        it("augments realname for active members in >100 branch", () => {
            const subscribers: ChatContextMember[] = []
            for (let i = 0; i < 150; i++) {
                subscribers.push(makeMember(`u${i}`, `User${i}`))
            }
            subscribers[5] = makeMember("u5", "zhangsan", "小张", 0, {
                real_name: "张三",
                realname_verified: 1,
            })
            const messages = [makeMessage("u5", "hi", "User5")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("张三，小张，zhangsan"))
        })
    })

    describe("self_name", () => {
        it("lists self real_name and nickname as separate comma entries when verified", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
                self: {
                    name: "zhaoqi",
                    realName: "赵七",
                    realnameVerified: true,
                },
            })
            expect(result.selfName).toBe("赵七，zhaoqi")
        })

        it("uses group nickname and nickname when not verified", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
                self: {
                    name: "admin",
                    remark: "群主",
                    realName: "某真名",
                    realnameVerified: false,
                },
            })
            expect(result.selfName).toBe("群主，admin")
        })

        it("falls back to bare nickname for self", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
                self: {
                    name: "admin",
                },
            })
            expect(result.selfName).toBe("admin")
        })

        it("is undefined when self is not provided", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.selfName).toBeUndefined()
        })
    })

    describe("group chat with >100 members (strategy 2)", () => {
        function makeLargeGroup(count: number): ChatContextMember[] {
            const subs: ChatContextMember[] = []
            for (let i = 0; i < count; i++) {
                subs.push(makeMember(`u${i}`, `User${i}`))
            }
            return subs
        }

        it("should only collect names of active senders from messages", () => {
            const subscribers = makeLargeGroup(150)
            const messages = [
                makeMessage("u0", "hi", "User0"),
                makeMessage("u5", "hello", "User5"),
            ]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toContain(PREFIX)
            expect(result.memberContext).toContain("User0")
            expect(result.memberContext).toContain("User5")
            expect(result.memberContext).not.toContain("User1，")
        })

        it("should exclude current user from active senders", () => {
            const subscribers = makeLargeGroup(150)
            subscribers.push(makeMember(LOGIN_UID, "MeUser"))
            const messages = [
                makeMessage(LOGIN_UID, "my message"),
                makeMessage("u0", "reply", "User0"),
            ]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).not.toContain("MeUser")
            expect(result.memberContext).toContain("User0")
        })

        it("should limit active UIDs to 100", () => {
            const subscribers = makeLargeGroup(200)
            const messages: ChatContextMessage[] = []
            for (let i = 0; i < 120; i++) {
                messages.push(makeMessage(`u${i}`, `msg${i}`))
            }
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            const names = result.memberContext!.replace(PREFIX, "").split("，")
            expect(names.length).toBeLessThanOrEqual(100)
        })

        it("should return only messages when no active senders match subscribers", () => {
            const subscribers = makeLargeGroup(150)
            const messages = [makeMessage("unknown_uid", "hello", "Unknown")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("[Unknown]: hello")
        })

        it("should handle no messages in large group", () => {
            const subscribers = makeLargeGroup(150)
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBeUndefined()
        })

        it("should exclude deleted active senders", () => {
            const subscribers = makeLargeGroup(150)
            subscribers[5].isDeleted = 1
            const messages = [
                makeMessage("u5", "hi", "User5"),
                makeMessage("u10", "hey", "User10"),
            ]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).not.toContain("User5")
            expect(result.memberContext).toContain("User10")
        })

        it("should collect remark for active senders when different from name", () => {
            const subscribers = makeLargeGroup(150)
            subscribers[5].remark = "五号"
            const messages = [makeMessage("u5", "hi", "User5")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toContain("User5")
            expect(result.memberContext).toContain("五号")
        })
    })

    describe("DM (person) chat — skip memberContext", () => {
        it("should NOT produce memberContext for DM", () => {
            const channelInfo: ChatContextChannelInfo = { title: "Alice" }
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.channelType).toBe(ChannelTypePerson)
        })

        it("should prepend channel label from channelInfo title", () => {
            const channelInfo: ChatContextChannelInfo = { title: "Alice" }
            const messages = [makeMessage("alice_uid", "hi", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("私聊「Alice」\n[Alice]: hi")
        })

        it("should use orgData.remark as fallback for channel label", () => {
            const channelInfo: ChatContextChannelInfo = {
                orgData: { remark: "小A" },
            }
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("私聊「小A」")
        })

        it("should treat whitespace-only title as empty and fall back to remark", () => {
            const channelInfo: ChatContextChannelInfo = {
                title: "  ",
                orgData: { remark: "小A" },
            }
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("私聊「小A」")
        })

        it("should handle missing channelInfo (no label, no memberContext)", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo: null,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBeUndefined()
        })

        it("should still build chatContext messages for DM", () => {
            const channelInfo: ChatContextChannelInfo = { title: "Alice" }
            const messages = [
                makeMessage("alice_uid", "你好", "Alice"),
                makeMessage(LOGIN_UID, "嗯嗯", "Me"),
            ]
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("私聊「Alice」\n[Alice]: 你好\n[Me]: 嗯嗯")
        })
    })

    describe("message formatting", () => {
        it("should include last 10 messages", () => {
            const messages: ChatContextMessage[] = []
            for (let i = 0; i < 15; i++) {
                messages.push(makeMessage(`u${i}`, `msg${i}`, `User${i}`))
            }
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            const lines = result.chatContext!.split("\n")
            expect(lines.length).toBe(10)
            expect(lines[0]).toBe("[User5]: msg5")
            expect(lines[9]).toBe("[User14]: msg14")
        })

        it("should fallback to fromUID when sender title is missing", () => {
            const messages = [makeMessage("uid123", "hello")]
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("[uid123]: hello")
        })

        it("should handle empty message text", () => {
            const messages = [makeMessage("u1", undefined, "Alice")]
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("[Alice]: ")
        })
    })

    describe("thread (ChannelTypeCommunityTopic) chat", () => {
        it("should collect all member names (same as group)", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Bob"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice，Bob"))
            expect(result.chatContext).toBeUndefined()
        })

        it("should use strategy 2 (active senders) when >100 members", () => {
            const subscribers: ChatContextMember[] = []
            for (let i = 0; i < 150; i++) {
                subscribers.push(makeMember(`u${i}`, `User${i}`))
            }
            const messages = [
                makeMessage("u0", "hi", "User0"),
                makeMessage("u5", "hello", "User5"),
            ]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toContain(PREFIX)
            expect(result.memberContext).toContain("User0")
            expect(result.memberContext).toContain("User5")
            expect(result.memberContext).not.toContain("User1，")
        })

        it("should return undefined memberContext when subscribers is empty", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBeUndefined()
        })
    })

    describe("channel label", () => {
        it("DM: chatContext starts with 私聊 label, no memberContext", () => {
            const channelInfo: ChatContextChannelInfo = { title: "张三" }
            const messages = [makeMessage("zhangsan", "你好", "张三")]
            const result = buildChatContext({
                messages,
                subscribers: [],
                channelType: ChannelTypePerson,
                loginUID: LOGIN_UID,
                channelInfo,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("私聊「张三」\n[张三]: 你好")
            expect(result.channelType).toBe(1)
        })

        it("Group: chatContext starts with 群聊 label, has memberContext", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Bob"),
            ]
            const messages = [makeMessage("u1", "hi", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
                groupName: "产品组",
            })
            expect(result.memberContext).toBe(members("Alice，Bob"))
            expect(result.chatContext).toBe("群聊「产品组」\n[Alice]: hi")
            expect(result.channelType).toBe(2)
        })

        it("Thread: chatContext starts with 群聊+子区 label, has memberContext", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Bob"),
            ]
            const messages = [makeMessage("u1", "hey", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
                groupName: "产品组",
                threadName: "UI设计",
            })
            expect(result.memberContext).toBe(members("Alice，Bob"))
            expect(result.chatContext).toBe("群聊「产品组」- 子区「UI设计」\n[Alice]: hey")
            expect(result.channelType).toBe(5)
        })

        it("Thread: only threadName provided (no groupName)", () => {
            const subscribers = [makeMember("u1", "Alice")]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
                threadName: "UI设计",
            })
            expect(result.chatContext).toBe("子区「UI设计」")
        })

        it("backward compat: no groupName → no label line for group", () => {
            const subscribers = [makeMember("u1", "Alice")]
            const messages = [makeMessage("u1", "hi", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBe("[Alice]: hi")
        })

        it("backward compat: no groupName/threadName → no label line for thread", () => {
            const subscribers = [makeMember("u1", "Alice")]
            const messages = [makeMessage("u1", "hi", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeCommunityTopic,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(members("Alice"))
            expect(result.chatContext).toBe("[Alice]: hi")
        })

        it("channelType is always set in result", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.channelType).toBe(2)
        })
    })

    describe("edge cases", () => {
        it("should return empty result when no subscribers and no messages", () => {
            const result = buildChatContext({
                messages: [],
                subscribers: [],
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBeUndefined()
        })

        it("should return only messages when no names to inject (all excluded)", () => {
            const subscribers = [makeMember(LOGIN_UID, "Me")]
            const messages = [makeMessage("u1", "hello", "User1")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("[User1]: hello")
        })

        it("should handle unknown channel type (no name injection, no label)", () => {
            const subscribers = [makeMember("u1", "Alice")]
            const messages = [makeMessage("u1", "hello", "Alice")]
            const result = buildChatContext({
                messages,
                subscribers,
                channelType: 99, // unknown
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBe("[Alice]: hello")
        })

        it("should handle member with undefined name and remark", () => {
            const subscribers = [makeMember("u1")]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBeUndefined()
            expect(result.chatContext).toBeUndefined()
        })

        it("regression: pure-nickname group uses new prefix + full-width comma", () => {
            const subscribers = [
                makeMember("u1", "Alice"),
                makeMember("u2", "Bob"),
            ]
            const result = buildChatContext({
                messages: [],
                subscribers,
                channelType: ChannelTypeGroup,
                loginUID: LOGIN_UID,
            })
            expect(result.memberContext).toBe(
                "聊天成员：Alice，Bob",
            )
        })
    })
})
