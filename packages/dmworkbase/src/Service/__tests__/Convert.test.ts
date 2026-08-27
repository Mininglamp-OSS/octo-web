import { describe, expect, it } from "vitest"
import { Channel } from "wukongimjssdk"
import { Convert, applyMsgLevelExternalFields, applyMsgLevelExternalFieldsWithFallback } from "../Convert"

describe("Convert model boundaries", () => {
  it("maps user/group channel data and reminders", () => {
    const user: any = Convert.userToChannelInfo({ uid: "u1", name: "Nick", remark: "", realname_verified: 1, real_name: "Real", category: "system", online: 1 })
    expect(user.channel.channelID).toBe("u1")
    expect(user.orgData.displayName).toBe("Real")
    expect(user.logo).toContain("users/u1")
    const group: any = Convert.groupToChannelInfo({ group_no: "g1", name: "Group", remark: "", allow_no_mention: 0, online: 0 })
    expect(group.orgData.allow_no_mention).toBe(0)
    expect(group.logo).toContain("groups/g1")
    const reminder: any = Convert.toReminder({ channel_id: "g1", channel_type: 2, message_id: "m", message_seq: 3, id: "r", reminder_type: 1, text: "todo", data: {}, is_locate: 1, version: 2, done: 0 })
    expect(reminder.isLocate).toBe(true)
    expect(reminder.done).toBe(false)
  })

  it("preserves wire fields and fills only missing external source data", () => {
    const target: any = {}
    applyMsgLevelExternalFields(target, { from_is_external: 1, from_source_space_name: "Other", from_home_space_id: "s", from_home_space_name: "Space" })
    expect(target).toMatchObject({ from_is_external: 1, from_home_space_id: "s" })
    applyMsgLevelExternalFields(target, { from_home_space_id: "new" })
    expect(target.from_home_space_id).toBe("new")
    applyMsgLevelExternalFieldsWithFallback({ fromUID: "u", channel: new Channel("u", 1) }, {})
    applyMsgLevelExternalFields(null, null)
  })

  it("maps conversation extras and space snapshot fields", () => {
    const conversation: any = Convert.toConversation({ channel_id: "g", channel_type: 2, unread: 2, timestamp: 10, stick: 1, category_id: "cat", category_sort: 4, space_id: "space", my_source_space_id: "source", space_unread: 1, extra: { browse_to: 3, keep_message_seq: 4, keep_offset_y: 5, draft: "d", version: 2 } })
    expect(conversation.extra.spaceId).toBe("space")
    expect(conversation.extra.categoryId).toBe("cat")
    expect(conversation.remoteExtra.draft).toBe("d")
  })

  it("converts a wire message and message extra", () => {
    const extra: any = Convert.toMessageExtra({ message_id: 12, message_seq: 4, readed: 1, readed_at: 10, revoke: 1, revoker: "u", readed_count: 2, unread_count: 3, extra_version: 4, edited_at: 5 })
    expect(extra.messageID).toBe("12")
    expect(extra.readed).toBe(true)
    const message: any = Convert.toMessage({ message_id: 12, channel_id: "g", channel_type: 2, message_seq: 4, client_seq: 1, client_msg_no: "c", from_uid: "u", timestamp: 10, payload: { type: 9999 }, from_is_external: 1 })
    expect(message.messageID).toBe("12")
    expect(message.isDeleted).toBe(false)
  })
})
