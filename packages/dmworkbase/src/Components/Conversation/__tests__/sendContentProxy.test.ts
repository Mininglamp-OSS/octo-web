/**
 * Tests for `wrapSendContentForInjection` (YUJ-1378 / octo-web#62).
 *
 * 覆盖：
 *   1. 不需要注入 → 返回原 content（identity check）
 *   2. mention.ais → wire encode() / contentObj / encodeJSON 都带 mention.ais=1
 *   3. mention.humans → 同上 humans
 *   4. mention.all（legacy）单独存在 → 不会被错误注入 humans/ais
 *   5. space_id 注入 (DM 场景)
 *   6. space_id + mention.ais 组合
 *   7. 原始 content 不被 mutate（转发安全）
 *   8. encode() 经过 swap-call-restore，结束后 content.encodeJSON 恢复原状
 */

import { describe, it, expect } from "vitest"
import { MessageText, Mention } from "wukongimjssdk"
import { wrapSendContentForInjection } from "../sendContentProxy"

function decodeWire(content: { encode: () => Uint8Array }): any {
    return JSON.parse(new TextDecoder().decode(content.encode()))
}

describe("wrapSendContentForInjection", () => {
    it("returns the original content untouched when nothing to inject", () => {
        const msg = new MessageText("hi")
        const wrapped = wrapSendContentForInjection(msg, {})
        expect(wrapped).toBe(msg)
    })

    it("returns identity when injection flags are all falsy", () => {
        const msg = new MessageText("hi")
        const wrapped = wrapSendContentForInjection(msg, {
            spaceId: null,
            mentionHumans: false,
            mentionAis: false,
        })
        expect(wrapped).toBe(msg)
    })

    it("injects mention.ais=1 into the wire payload (group @所有AI scenario)", () => {
        const msg = new MessageText("@所有AI go")
        const mn = new Mention()
        ;(mn as any).ais = 1
        msg.mention = mn

        const wrapped = wrapSendContentForInjection(msg, { mentionAis: true })

        const wire = decodeWire(wrapped)
        expect(wire.mention).toBeDefined()
        expect(wire.mention.ais).toBe(1)
        expect(wire.space_id).toBeUndefined() // group → no space_id

        // encodeJSON output mirrors encode() bytes
        expect(wrapped.encodeJSON().mention.ais).toBe(1)
        // contentObj for local echo also carries the injection
        expect(wrapped.contentObj.mention.ais).toBe(1)
    })

    it("preserves mention.entities in the wire payload when SDK encode overwrites mention", () => {
        const msg = new MessageText("@所有AI ping @ops")
        const mn = new Mention()
        ;(mn as any).ais = 1
        ;(mn as any).entities = [{ uid: "-3", offset: 0, length: 5 }]
        mn.uids = ["bot_a"]
        msg.mention = mn

        const wrapped = wrapSendContentForInjection(msg, { mentionAis: true })

        const wire = decodeWire(wrapped)
        expect(wire.mention.uids).toEqual(["bot_a"])
        expect(wire.mention.ais).toBe(1)
        expect(wire.mention.entities).toEqual([{ uid: "-3", offset: 0, length: 5 }])
        expect(wrapped.contentObj.mention.entities).toEqual([
            { uid: "-3", offset: 0, length: 5 },
        ])
    })

    it("injects mention.humans=1 (@所有人 three-state path)", () => {
        const msg = new MessageText("@所有人 ping")
        const mn = new Mention()
        ;(mn as any).humans = 1
        msg.mention = mn

        const wrapped = wrapSendContentForInjection(msg, { mentionHumans: true })

        const wire = decodeWire(wrapped)
        expect(wire.mention.humans).toBe(1)
        expect(wire.mention.ais).toBeUndefined()
    })

    it("preserves legacy mention.all=1 alongside humans/ais being absent", () => {
        const msg = new MessageText("@everyone")
        const mn = new Mention()
        mn.all = true
        msg.mention = mn

        const wrapped = wrapSendContentForInjection(msg, {
            mentionHumans: false,
            mentionAis: false,
        })
        // no injection requested → identity
        expect(wrapped).toBe(msg)
        const wire = decodeWire(wrapped)
        expect(wire.mention.all).toBe(1)
        expect(wire.mention.humans).toBeUndefined()
        expect(wire.mention.ais).toBeUndefined()
    })

    it("injects space_id only (DM no-mention scenario, regression of #784)", () => {
        const msg = new MessageText("plain dm")

        const wrapped = wrapSendContentForInjection(msg, { spaceId: "space-xyz" })

        const wire = decodeWire(wrapped)
        expect(wire.space_id).toBe("space-xyz")
        expect(wire.mention).toBeUndefined()
        // contentObj for local echo also carries space_id (filterPersonMessagesBySpace #784)
        expect(wrapped.contentObj.space_id).toBe("space-xyz")
    })

    it("injects both space_id and mention.ais (DM @所有AI scenario)", () => {
        const msg = new MessageText("ai in DM")
        const mn = new Mention()
        ;(mn as any).ais = 1
        msg.mention = mn

        const wrapped = wrapSendContentForInjection(msg, {
            spaceId: "space-1",
            mentionAis: true,
        })

        const wire = decodeWire(wrapped)
        expect(wire.space_id).toBe("space-1")
        expect(wire.mention.ais).toBe(1)
        expect(wrapped.contentObj.space_id).toBe("space-1")
        expect(wrapped.contentObj.mention.ais).toBe(1)
    })

    it("does not mutate the original content (forwarding-safety)", () => {
        const msg = new MessageText("forward me")
        const mn = new Mention()
        ;(mn as any).ais = 1
        msg.mention = mn
        const originalEncodeJSON = msg.encodeJSON
        const originalEncode = msg.encode
        const originalContentObj = msg.contentObj

        const wrapped = wrapSendContentForInjection(msg, { mentionAis: true })
        // touch encode to trigger the swap-call-restore path
        wrapped.encode()

        // Original is intact — no own-property leak
        expect(msg.encodeJSON).toBe(originalEncodeJSON)
        expect(msg.encode).toBe(originalEncode)
        expect(msg.contentObj).toBe(originalContentObj)
        // Direct encodeJSON on original still goes through SDK (drops ais)
        const directJson = msg.encodeJSON()
        expect(directJson.mention?.ais).toBeUndefined()
    })

    it("encode() restores content.encodeJSON even if encode() throws", () => {
        const msg = new MessageText("boom")
        const mn = new Mention()
        ;(mn as any).ais = 1
        msg.mention = mn
        const originalEncodeJSON = msg.encodeJSON

        const wrapped = wrapSendContentForInjection(msg, { mentionAis: true })
        // Sabotage the underlying encode to throw mid-call
        const realEncode = msg.encode.bind(msg)
        msg.encode = function () {
            throw new Error("simulated SDK failure")
        }
        expect(() => wrapped.encode()).toThrow("simulated SDK failure")
        // encodeJSON on original is restored even on throw
        expect(msg.encodeJSON).toBe(originalEncodeJSON)
        // restore for cleanliness
        msg.encode = realEncode
    })

    it("contentObj fallback uses encodeJSON()+type when content.contentObj is empty", () => {
        const msg = new MessageText("fresh msg")
        // MessageText newly constructed has no contentObj set (decodeJSON not called)
        // → fallback path: { ...encodeJSON(), type: contentType }
        const wrapped = wrapSendContentForInjection(msg, { spaceId: "S" })
        expect(wrapped.contentObj.space_id).toBe("S")
        expect(wrapped.contentObj.type).toBe(msg.contentType)
        // payload still has the underlying text content for messageToMap
        expect(wrapped.contentObj.content).toBe("fresh msg")
    })
})
