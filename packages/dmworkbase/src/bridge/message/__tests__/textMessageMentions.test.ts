import { describe, expect, it } from "vitest"
import { buildTextMessageMentions } from "../textMessageMentions"

const PART_TYPE_MENTION = 2

describe("buildTextMessageMentions", () => {
    it("synthesizes broadcast mentions for @所有人 and @所有AI flags", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@所有人 @所有AI 请同步",
                mention: { humans: 1, ais: 1 },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([
            { name: "@所有人", uid: "all" },
            { name: "@所有AI", uid: "all" },
        ])
    })

    it("keeps member mentions while adding synthetic @所有AI", () => {
        const mentions = buildTextMessageMentions({
            parts: [
                {
                    type: PART_TYPE_MENTION,
                    text: "@陈皮皮",
                    data: { uid: "uid_chen" },
                },
            ],
            content: {
                text: "@陈皮皮 @所有AI 看一下",
                mention: { ais: 1 },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([
            { name: "@陈皮皮", uid: "uid_chen" },
            { name: "@所有AI", uid: "all" },
        ])
    })

    it("uses edited content flags before original mention flags", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@所有人 原消息",
                mention: { humans: 1 },
            },
            editContent: {
                text: "@所有AI 编辑后",
                mention: { ais: 1 },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@所有AI", uid: "all" }])
    })

    it("falls back to contentObj.mention when SDK mention lacks three-state fields", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@所有AI 请处理",
                contentObj: { mention: { ais: 1 } },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@所有AI", uid: "all" }])
    })

    it("restores member mentions from mention.entities when decoded parts are unavailable", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "请 @张三 和 @李四 跟进",
                // SDK MessageText.decode() creates a Mention instance on
                // content.mention, but unsupported entity fields remain only on
                // contentObj.mention.
                mention: { all: false },
                contentObj: {
                    mention: {
                        entities: [
                            { uid: "uid_zhang", offset: 2, length: 3 },
                            { uid: "uid_li", offset: 8, length: 3 },
                        ],
                    },
                },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([
            { name: "@张三", uid: "uid_zhang" },
            { name: "@李四", uid: "uid_li" },
        ])
    })

    it("restores legacy member mentions from mention.uids when entities are absent", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                contentObj: {
                    content: "@张三 @所有人 @李四",
                    mention: { uids: ["uid_zhang", "uid_li"], humans: 1 },
                },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([
            { name: "@张三", uid: "uid_zhang" },
            { name: "@李四", uid: "uid_li" },
            { name: "@所有人", uid: "all" },
        ])
    })

    it("does not bind all-AI routing uids to raw member mention text", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@所有AI 总结一下 @张三 的发言",
                mention: { ais: 1, uids: ["bot_1", "bot_2"] },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@所有AI", uid: "all" }])
    })

    it("skips embedded @ tokens before consuming legacy mention uids", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                contentObj: {
                    content: "ping eve@example.com 然后 @张三 跟进",
                    mention: { uids: ["uid_zhang"] },
                },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@张三", uid: "uid_zhang" }])
    })

    it("does not recover member entities that overlap a broadcast sentinel entity", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@张三 看一下",
                mention: {
                    entities: [
                        { uid: "-2", offset: 0, length: 3 },
                        { uid: "uid_zhang", offset: 0, length: 3 },
                    ],
                    humans: 1,
                },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@所有人", uid: "all" }])
    })

    it("ignores malformed or non-mention entities and keeps valid ordering", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "@张三 普通文本 @李四",
                mention: {
                    entities: [
                        { uid: "bad", offset: -1, length: 3 },
                        { uid: "not-a-mention", offset: 4, length: 4 },
                        { uid: "uid_li", offset: 9, length: 3 },
                        { uid: "uid_zhang", offset: 0, length: 3 },
                    ],
                },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([
            { name: "@张三", uid: "uid_zhang" },
            { name: "@李四", uid: "uid_li" },
        ])
    })

    it("does not consume legacy member uids for ordinary text or broadcast tokens", () => {
        const mentions = buildTextMessageMentions({
            parts: [],
            content: {
                text: "alice@example.com @所有人",
                mention: { uids: ["uid_should_not_bind"], humans: 1 },
            },
            partMentionType: PART_TYPE_MENTION,
        })

        expect(mentions).toEqual([{ name: "@所有人", uid: "all" }])
    })
})
