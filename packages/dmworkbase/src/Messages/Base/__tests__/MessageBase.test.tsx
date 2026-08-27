// @vitest-environment jsdom

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Channel, ChannelTypeGroup, ChannelTypePerson, MessageStatus } from "wukongimjssdk"

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
import { MessageReasonCode } from "../../../Service/Const"
import { getImChannelInfo, getImChannelSubscribers } from "../../../im-runtime/channelRuntime"

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
    channel: () => new Channel("group-a", ChannelTypeGroup),
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

describe("MessageBase display helpers", () => {
  function instance(message = createMessage(), selectionMode = false): any {
    const value: any = new (MessageBase as any)({ message, context: createContext(selectionMode) })
    value.context = { t: (key: string) => key }
    return value
  }

  it("handles standalone, continuation, bubble and avatar decisions", () => {
    const first = createMessage()
    first.bubblePosition = BubblePosition.first
    const value = instance(first)
    expect(value.forceStandalone()).toBe(false)
    expect(value.getDisplayBubblePosition()).toBe(BubblePosition.first)
    expect(value.needAvatar()).toBe(true)
    expect(value.needHead()).toBe(true)
    expect(value.getBubbleRadius(false, first)).toContain("8px")
    expect(value.getMessageStyle(false, first).marginBottom).toBe("15px")
    expect(value.getBubbleBoxClassName()).toContain("first")

    const sent = { ...first, send: true, bubblePosition: BubblePosition.middle }
    const sentValue = instance(sent)
    expect(sentValue.getBubbleRadius(true, sent)).toContain("4px")
    expect(sentValue.getBubbleBoxClassName()).toContain("send")
    expect(sentValue.getMessageStyle(true, sent).marginLeft).toBe("0px")
  })

  it("resolves message errors for group, robot and system failures", () => {
    const reasons = [
      [MessageReasonCode.reasonSubscriberNotExist, "removedFromGroup"],
      [MessageReasonCode.reasonSystemError, "system"],
    ] as const
    for (const [reason, key] of reasons) {
      const msg = { ...createMessage(), reasonCode: reason } as any
      expect(instance(msg).getMessageErrorReason()).toContain(key)
    }
    const muted = { ...createMessage(), reasonCode: MessageReasonCode.reasonNotAllowSend } as any
    expect(instance(muted).getMessageErrorReason()).toContain("muted")
    const robot = instance({ ...muted, channel: new Channel("bot", ChannelTypePerson) } as any)
    robot.props.context.channel = () => robot.props.message.channel
    expect(robot.getMessageErrorReason()).toContain("muted")
  })

  it("cleans listeners and delegates message actions", () => {
    const value = instance()
    const unsubscribeInfo = vi.fn()
    const unsubscribeSubscribers = vi.fn()
    value.unsubscribeChannelInfoListener = unsubscribeInfo
    value.unsubscribeSubscriberChangeListener = unsubscribeSubscribers
    value.componentWillUnmount()
    expect(unsubscribeInfo).toHaveBeenCalledOnce()
    expect(unsubscribeSubscribers).toHaveBeenCalledOnce()
    value.props.context.deleteMessages = vi.fn()
    value.onMessageDelete()
    expect(value.props.context.deleteMessages).toHaveBeenCalledWith([value.props.message.message])
  })

  it("renders selectable and failed message shells", () => {
    const message = {
      ...createMessage(),
      send: true,
      status: MessageStatus.Fail,
      bubblePosition: BubblePosition.single,
      checked: true,
    } as any
    const context = createContext(true)
    context.resendMessage = vi.fn()
    const html = renderToStaticMarkup(
      <MessageBase message={message} context={context} threadInfo={{ count: 2 } as any}>
        body
      </MessageBase>,
    )
    expect(html).toContain("wk-message-base-check-open")
    expect(html).toContain("messageFail")
    expect(html).toContain("wk-message-error-reason")
  })

  it("covers continuation spacing and standalone overrides", () => {
    const current = createMessage() as any
    current.bubblePosition = BubblePosition.middle
    current.preMessage = { ...current, fromUID: current.fromUID, send: false }
    current.nextMessage = { ...current, fromUID: "other", send: false }
    const context = createContext(false)
    context.forceStandaloneMessage = () => true
    const value = instance(current)
    value.props.context = context
    expect(value.isContinue()).toBe(false)
    expect(value.getDisplayBubblePosition()).toBe(BubblePosition.single)
    expect(value.getMessageStyle(false, current).marginBottom).toBe("15px")
    expect(value.getBubbleBoxClassName()).toContain("single")
  })

  it("renders group member metadata, external origin, badges and context actions", () => {
    const channel = new Channel("group-a", ChannelTypeGroup)
    const message = {
      ...createMessage(),
      channel,
      fromUID: "sender-a",
      fromHomeSpaceId: "home-b",
      fromHomeSpaceName: "Other Space",
      bubblePosition: BubblePosition.single,
      checked: false,
    } as any
    vi.mocked(getImChannelSubscribers).mockReturnValue([{ uid: "sender-a", name: "Member", orgData: { real_name: "Member" }, is_external: 1, home_space_id: "home-b", home_space_name: "Other Space" }] as any)
    vi.mocked(getImChannelInfo).mockReturnValue({ title: "Fallback", channel, orgData: { displayName: "Display" } } as any)
    const context = createContext(false)
    context.showContextMenus = vi.fn()
    const html = renderToStaticMarkup(
      <MessageBase message={message} context={context} bubbleStyle={{ color: "red" }}>
        body
      </MessageBase>,
    )
    expect(html).toContain("Member")
    expect(html).toContain("Other Space")
    expect(html).toContain("senderAvatar")
  })
})
