// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import { GroupManagement } from "../index"
import { Channel } from "wukongimjssdk"

describe("GroupManagement guards", () => {
  it("covers member mapping, route count, picker entry points, and lifecycle", () => {
    const context: any = { routeData: () => ({ channelInfo: { orgData: { member_count: "3" } }, subscribers: [] }), push: vi.fn(), pop: vi.fn() }
    const panel: any = new GroupManagement({ channel: new Channel("g", 2), context, isCreator: true } as any)
    panel.context = { t: (key: string) => key }
    panel.setState = (update: any) => {
      const next = typeof update === "function" ? update(panel.state, panel.props) : update
      if (next) panel.state = { ...panel.state, ...next }
    }
    const manager: any = { uid: "u1", name: "Alice", remark: "A", avatar: "a" }
    const bot: any = { uid: "bot", name: "Bot", orgData: { robot: 1 } }
    panel.state.managers = [manager]
    panel.state.botAdmins = [bot]
    expect(panel.readAllowNoMention()).toBe(true)
    expect(panel.toMemberItem(manager, "manager", true).name).toBe("A")
    expect(panel.findManager({ id: "u1" })).toBe(manager)
    expect(panel.findBotAdmin({ id: "bot" })).toBe(bot)
    expect(panel.memberCount()).toBe(3)
    panel.handleAddManager(); panel.handleAddBotAdmin(); panel.handleDisband()
    panel.handleRemoveManager(manager); panel.handleRemoveBotAdmin(bot)
    panel.componentWillUnmount()
    expect(context.push).toHaveBeenCalledTimes(2)
  })
})
