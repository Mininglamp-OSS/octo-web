// @vitest-environment jsdom

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Channel, ChannelTypeGroup, MessageStatus } from "wukongimjssdk"

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "viewer",
      selfDisplayName: () => "Viewer",
      realnameVerified: false,
    },
    shared: { currentSpaceId: "space-a" },
  },
}))

vi.mock("../../../i18n", async () => {
  const ReactModule = await import("react")
  return {
    I18nContext: ReactModule.createContext({
      t: (key: string) => key,
    }),
  }
})

vi.mock("@douyinfe/semi-ui", () => ({
  Checkbox: ({ children, prefixCls: _prefixCls, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { prefixCls?: string }) => (
    <label>
      <input type="checkbox" {...props} />
      {children}
    </label>
  ),
  CheckboxGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popconfirm: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../../../im-runtime/channelRuntime", () => ({
  addImChannelInfoListener: vi.fn(() => vi.fn()),
  addImSubscriberChangeListener: vi.fn(() => vi.fn()),
  fetchImChannelInfo: vi.fn(),
  getImChannelInfo: vi.fn(() => undefined),
  getImChannelSubscribers: vi.fn(() => []),
}))

vi.mock("../../../Components/WKAvatar", () => ({
  default: () => <span data-testid="avatar" />,
}))

import MessageBase from "../index"
import { BubblePosition, MessageWrap } from "../../../Service/Model"

function createMessage(): MessageWrap {
  const channel = new Channel("group-a", ChannelTypeGroup)
  const rawMessage = {
    channel,
    contentType: 1,
    fromUID: "sender-a",
    messageSeq: 1,
    send: false,
    status: MessageStatus.Normal,
    timestamp: 1,
  }

  return {
    ...rawMessage,
    bubblePosition: BubblePosition.single,
    message: rawMessage,
  } as unknown as MessageWrap
}

function createContext(selectionMode: boolean) {
  return {
    editOn: () => selectionMode,
    forceStandaloneMessage: () => false,
    checkeMessage: vi.fn(),
    onTapAvatar: vi.fn(),
    showContextMenus: vi.fn(),
  } as any
}

describe("MessageBase avatar interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not render an actionable avatar button in selection mode", () => {
    const html = renderToStaticMarkup(
      <MessageBase message={createMessage()} context={createContext(true)}>
        message
      </MessageBase>,
    )

    expect(html).not.toContain("<button")
    expect(html).toContain('class="senderAvatar"')
  })

  it("keeps the avatar button outside selection mode", () => {
    const html = renderToStaticMarkup(
      <MessageBase message={createMessage()} context={createContext(false)}>
        message
      </MessageBase>,
    )

    expect(html).toContain('<button type="button" class="senderAvatar"')
  })
})
