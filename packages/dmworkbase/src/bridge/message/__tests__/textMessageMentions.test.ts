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
})
