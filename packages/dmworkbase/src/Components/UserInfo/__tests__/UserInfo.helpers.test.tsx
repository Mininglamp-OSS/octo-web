// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import UserInfo from "../index"

function makeUser(overrides: any = {}) {
  return {
    uid: "u1",
    channelInfo: { orgData: {} },
    isSelf: () => false,
    isExternalToViewer: () => false,
    relation: () => 1,
    displayName: () => "User",
    ...overrides,
  }
}

describe("UserInfo helper branches", () => {
  it("filters remark rows and selects footer modes", () => {
    const view: any = new UserInfo({ uid: "u1" })
    view.context = { t: (key: string) => key }
    const vm: any = makeUser({
      sections: () => [{ title: "Profile", rows: [{ properties: { key: "userinfo.remark" } }, { properties: { title: "Other" } }] }],
    })
    expect(view.getVisibleSections(vm, {} as any)[0].rows).toHaveLength(1)
    expect(view.getFooter(makeUser({ isSelf: () => true }), {} as any)).toBeUndefined()
    expect(view.getFooter(makeUser({ isExternalToViewer: () => true }), {} as any)).toEqual({ hint: "base.userInfo.externalOnlyGroup" })
    expect(view.getFooter(makeUser({ relation: () => 1 }), {} as any)).toBeTruthy()
    expect(view.getFooter(makeUser({ relation: () => 0, vercode: "code" }), {} as any)).toBeTruthy()
    expect(view.getFooter(makeUser({ relation: () => 0 }), {} as any)).toBeUndefined()
  })

  it("covers bot footer path without mounting the full route page", () => {
    const view: any = new UserInfo({ uid: "bot" })
    view.context = { t: (key: string) => key }
    const footer = view.getFooter(makeUser({ channelInfo: { orgData: { robot: 1 } }, relation: () => 0 }), { push: vi.fn() } as any)
    expect(footer).toBeTruthy()
  })
})
