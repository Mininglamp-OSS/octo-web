import { describe, it, expect } from "vitest"
import { partitionFolded } from "./model"
describe("folded aggregation", () => {
 it("keeps unread ownership, mentions and independent thread keys while moving by latest activity", () => {
  const conv = (id: string, type: number, timestamp: number, unread: number, muted = false, mention = false) => ({ channel: { channelID: id, channelType: type }, timestamp, unread, muted, isMentionMe: mention }) as any
  const group = conv("g",2,10,3), thread = conv("g:t",5,30,5,true,true), dm = conv("u",1,20,2)
  const keys = new Set(["2::g","5::g:t"])
  let view = partitionFolded([group,thread,dm],keys,c => (c as any).muted)
  expect(view).toMatchObject({recent:[dm], timestamp:30, unread:3, mention:true, hasUnread:true})
  group.timestamp=40; view=partitionFolded([group,thread,dm],keys,c => (c as any).muted)
  expect(view.timestamp).toBe(40)
  keys.delete("2::g"); view=partitionFolded([group,thread,dm],keys,c => (c as any).muted)
  expect(view.recent).toEqual([group,dm]); expect(view.unread).toBe(0); expect(view.hasUnread).toBe(true)
 })
})
