// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  confirm: vi.fn(),
  disband: vi.fn(),
  loadMembers: vi.fn(),
  syncDisband: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  pop: vi.fn(),
}))

vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => null,
  Toast: {
    error: hoisted.toastError,
    success: hoisted.toastSuccess,
    warning: vi.fn(),
  },
}))
vi.mock("@octo/ui", () => ({ modalConfirm: hoisted.confirm }))
vi.mock("../../WKAvatar", () => ({ default: () => null }))
vi.mock("../../../i18n", () => ({
  I18nContext: {},
  t: (key: string) => key,
}))
vi.mock("../../../Service/Context", () => ({
  RouteContextConfig: class {},
  default: {},
}))
vi.mock("../../../Service/Const", () => ({ GroupRole: { normal: 0 } }))
vi.mock("../MemberPicker", () => ({ GroupManagementMemberPicker: () => null }))
vi.mock("../../../ui/channelSetting/GroupManagementView", () => ({
  default: () => null,
}))
vi.mock("../../../bridge/channelSetting/groupManagementActions", () => ({
  addGroupManagementBotAdmins: vi.fn(),
  addGroupManagementManagers: vi.fn(),
  disbandGroupManagementGroup: hoisted.disband,
  loadGroupManagementMembers: hoisted.loadMembers,
  readGroupManagementAllowNoMention: vi.fn(() => true),
  refreshGroupManagementChannelInfo: vi.fn(() => Promise.resolve()),
  removeGroupManagementBotAdmin: vi.fn(),
  removeGroupManagementManager: vi.fn(),
  setGroupManagementAllowNoMention: vi.fn(),
  subscribeGroupManagementChannelInfo: vi.fn(() => vi.fn()),
  syncGroupManagementDisbandState: hoisted.syncDisband,
}))
vi.mock("../../../bridge/channelSetting/groupManagementAllowNoMention", () => ({
  shouldApplyFetchResult: () => true,
  shouldListenerApply: () => true,
}))

import { GroupManagement } from "../index"

const channel = { channelID: "group-1", channelType: 2 } as any

function makeComponent() {
  const component = new GroupManagement({
    channel,
    isCreator: true,
    context: { pop: hoisted.pop, push: vi.fn(), routeData: () => undefined } as any,
  })
  // Exercise the class action methods without mounting the full settings UI.
  component.setState = ((update: any) => {
    Object.assign(component.state, typeof update === "function" ? update(component.state) : update)
  }) as any
  return component
}

beforeEach(() => {
  hoisted.confirm.mockReset()
  hoisted.disband.mockReset()
  hoisted.loadMembers.mockReset()
  hoisted.syncDisband.mockReset()
  hoisted.toastError.mockReset()
  hoisted.toastSuccess.mockReset()
  hoisted.pop.mockReset()
})

describe("GroupManagement disband action", () => {
  it("syncs local disband state and closes after the request succeeds", async () => {
    hoisted.disband.mockResolvedValueOnce(undefined)
    const component = makeComponent()

    component.handleDisband()
    const { onOk } = hoisted.confirm.mock.calls[0][0]
    await onOk()

    expect(hoisted.syncDisband).toHaveBeenCalledWith({ channel })
    expect(hoisted.pop).toHaveBeenCalledTimes(1)
    expect(hoisted.toastSuccess).toHaveBeenCalledTimes(1)
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })

  it("keeps the panel open and does not sync when the request fails", async () => {
    hoisted.disband.mockRejectedValueOnce({ msg: "server rejected" })
    const component = makeComponent()

    component.handleDisband()
    const { onOk } = hoisted.confirm.mock.calls[0][0]
    await onOk()

    expect(hoisted.toastError).toHaveBeenCalledWith("server rejected")
    expect(hoisted.syncDisband).not.toHaveBeenCalled()
    expect(hoisted.pop).not.toHaveBeenCalled()
  })
})

describe("GroupManagement member loading", () => {
  it("stores loaded managers and bot admins and clears loading", async () => {
    hoisted.loadMembers.mockResolvedValueOnce({
      managers: [{ uid: "manager" }],
      botAdmins: [{ uid: "bot" }],
    })
    const component = makeComponent()

    await component.loadMembers()

    expect(component.state.loading).toBe(false)
    expect(component.state.managers).toEqual([{ uid: "manager" }])
    expect(component.state.botAdmins).toEqual([{ uid: "bot" }])
  })

  it("clears loading and reports an error when member loading fails", async () => {
    hoisted.loadMembers.mockRejectedValueOnce({ msg: "members unavailable" })
    const component = makeComponent()

    await component.loadMembers()

    expect(component.state.loading).toBe(false)
    expect(hoisted.toastError).toHaveBeenCalledWith("members unavailable")
  })
})
