import { describe, expect, it, vi } from "vitest"
import type { ForwardModalProps } from "../../../Components/ForwardModal/ForwardModal"
import type { ForwardSurfaceAction, ForwardSurfaceCommand, ForwardSurfacePort, ForwardSurfaceUpdate } from "../surfaceContract"
import { ForwardSurfaceSession, toForwardSurfaceModel } from "../surfaceSession"

const appearance = { locale: "zh-CN", theme: "light" } as const
const item = { channelID: "group-a", channelType: 2, displayName: "Group A" }

function setup(overrides: Partial<ForwardModalProps> = {}) {
  let listener: (command: ForwardSurfaceCommand) => void = () => {}
  const publish = vi.fn<ForwardSurfacePort["publish"]>().mockResolvedValue()
  const unsubscribe = vi.fn()
  const props: ForwardModalProps = {
    items: [item], allItems: [item], selectedIDs: [], inputValue: "", activeTab: "recent",
    onInputChange: vi.fn(), onToggleSelect: vi.fn(), onConfirm: vi.fn(),
    onCancel: vi.fn(), onTabChange: vi.fn(), onItemVisible: vi.fn(), onRetry: vi.fn(),
    ...overrides,
  }
  const session = new ForwardSurfaceSession({
    publish, subscribe: (next) => { listener = next; return unsubscribe },
  }, "picker-a")
  session.update(props, appearance)
  const act = (action: ForwardSurfaceAction, revision = 1, id = "picker-a") => listener({ id, revision, action })
  return { session, props, act, publish, unsubscribe }
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

describe("ForwardSurfaceSession", () => {
  it("publishes only serializable presentation data, including grant and Bot previews", () => {
    const { props } = setup({
      items: [{ ...item, channelType: 1 }],
      allItems: [{ ...item, channelType: 1 }],
      botPreview: { botsFor: () => [{ uid: "bot-a", name: "Bot A" }] },
      grant: {
        canGrant: true, enabled: true, role: "reader", onEnabledChange: vi.fn(), onRoleChange: vi.fn(),
        bots: {
          ready: true, peopleCount: 1, botCount: 1, toggleBot: vi.fn(), retry: vi.fn(),
          groups: [{ uid: "group-a", name: "Person A", bots: [{ uid: "bot-a", name: "Bot A", selected: true }] }],
        },
      },
    })
    const model = toForwardSurfaceModel(props, appearance)
    expect(model.grant?.bots?.groups[0].bots[0].selected).toBe(true)
    expect(model.botPreview?.[0].bots[0].uid).toBe("bot-a")
    expect(Object.keys(model.grant!)).not.toContain("onEnabledChange")
    expect(Object.keys(model.grant!.bots!)).not.toContain("toggleBot")
    expect(JSON.parse(JSON.stringify(model))).toMatchObject({ inputValue: "", locale: "zh-CN" })
  })

  it("does not republish unchanged models but refreshes authoritative callbacks", async () => {
    const { props, session, publish, act } = setup({ selectedIDs: ["group-a"] })
    const onConfirm = vi.fn()
    session.update({ ...props, onConfirm }, appearance)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    act({ type: "confirm" })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it("accepts queued typing and clearing before a render", () => {
    const { props, act, session } = setup()
    act({ type: "input", value: "a" })
    act({ type: "input", value: "" })
    expect(props.onInputChange).toHaveBeenNthCalledWith(1, "a")
    expect(props.onInputChange).toHaveBeenNthCalledWith(2, "")
    session.update({ ...props }, appearance)
    act({ type: "input", value: "b" }, 1)
    expect(props.onInputChange).toHaveBeenLastCalledWith("b")
  })

  it("rejects foreign sessions, future revisions and unknown candidates", () => {
    const { props, act } = setup()
    act({ type: "toggle", channelID: "group-a", channelType: 2 }, 1, "old-picker")
    act({ type: "toggle", channelID: "group-a", channelType: 2 }, 3)
    act({ type: "toggle", channelID: "group-a", channelType: 1 })
    act({ type: "toggle", channelID: "injected", channelType: 2 })
    expect(props.onToggleSelect).not.toHaveBeenCalled()
    act({ type: "toggle", channelID: "group-a", channelType: 2 })
    expect(props.onToggleSelect).toHaveBeenCalledWith(item)
  })

  it("blocks confirmation until the changed selection has been rendered, then confirms once", async () => {
    const { props, act, session, publish, unsubscribe } = setup({ selectedIDs: ["group-a"] })
    await flush()
    act({ type: "toggle", channelID: "group-a", channelType: 2 })
    act({ type: "confirm" })
    expect(props.onConfirm).not.toHaveBeenCalled()
    session.update({ ...props }, appearance)
    await flush()
    act({ type: "confirm" }, 1)
    expect(props.onConfirm).not.toHaveBeenCalled()
    act({ type: "confirm" }, 2)
    act({ type: "confirm" }, 2)
    session.dispose()
    await flush()
    expect(props.onConfirm).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(publish.mock.calls.map(([value]) => [value.revision, value.model === null]))
      .toEqual([[1, false], [2, false], [3, true]])
  })

  it("preserves empty-selection and unresolved authorization guards", () => {
    const { props, act, session } = setup()
    act({ type: "confirm" })
    expect(props.onConfirm).not.toHaveBeenCalled()
    session.update({
      ...props, selectedIDs: ["group-a"],
      grant: {
        canGrant: true, enabled: true, role: "reader", onEnabledChange: vi.fn(), onRoleChange: vi.fn(),
        bots: { ready: false, error: true, peopleCount: 0, botCount: 0, groups: [], toggleBot: vi.fn() },
      },
    }, appearance)
    act({ type: "confirm" }, 2)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it("only toggles authorized Bots from the current grant snapshot", () => {
    const toggleBot = vi.fn()
    const { act, session, props } = setup({
      grant: {
        canGrant: true, enabled: true, role: "reader", onEnabledChange: vi.fn(), onRoleChange: vi.fn(),
        bots: {
          ready: true, peopleCount: 1, botCount: 1, toggleBot,
          groups: [{ uid: "person", name: "Person", bots: [{ uid: "bot-a", name: "Bot", selected: true }] }],
        },
      },
    })
    act({ type: "toggleBot", uid: "injected" })
    expect(toggleBot).not.toHaveBeenCalled()
    act({ type: "toggleBot", uid: "bot-a" })
    expect(toggleBot).toHaveBeenCalledWith("bot-a")
    session.update({ ...props, grant: { ...props.grant!, canGrant: false } }, appearance)
    act({ type: "toggleBot", uid: "bot-a" }, 2)
    expect(toggleBot).toHaveBeenCalledOnce()
  })

  it("closes on cancel or unmount and ignores late actions", async () => {
    const { props, act, session, publish } = setup()
    act({ type: "cancel" })
    session.dispose()
    act({ type: "input", value: "late" })
    await flush()
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(props.onInputChange).not.toHaveBeenCalled()
    expect(publish.mock.calls.at(-1)?.[0].model).toBeNull()
  })

  it("cancels the owner when publishing fails instead of leaving a hidden picker alive", async () => {
    const { props, publish, act } = setup()
    publish.mockRejectedValueOnce(new Error("renderer unavailable"))
    await flush()
    expect(props.onCancel).toHaveBeenCalledOnce()
    act({ type: "confirm" })
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it("serializes asynchronous updates and close in order", async () => {
    const { session, props, publish } = setup()
    let finish!: () => void
    publish.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    session.update({ ...props, inputValue: "new" }, appearance)
    session.dispose()
    finish()
    await flush()
    expect(publish.mock.calls.map(([value]: [ForwardSurfaceUpdate]) => value.revision)).toEqual([1, 3])
  })
})
