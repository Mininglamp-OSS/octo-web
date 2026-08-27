import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import { matchBotfatherCommandEvent, matchesCommandPrefix } from "../vm"

describe("botfather command event matching", () => {
  it("requires a command boundary", () => {
    expect(matchesCommandPrefix("/help", "/help")).toBe(true)
    expect(matchesCommandPrefix("/help now", "/help")).toBe(true)
    expect(matchesCommandPrefix("/helper", "/help")).toBe(false)
    expect(matchesCommandPrefix("", "/help")).toBe(false)
  })

  it("maps known commands and preserves the generic fallback", () => {
    expect(matchBotfatherCommandEvent("hello")).toBeUndefined()
    expect(matchBotfatherCommandEvent("/quickstart")).toBe("botfather_quickstart_viewed")
    expect(matchBotfatherCommandEvent("/setname Alice")).toBe("bot_profile_edited")
    expect(matchBotfatherCommandEvent("/setdescription x")).toBe("bot_profile_edited")
    expect(matchBotfatherCommandEvent("/mybots")).toBe("bot_list_viewed")
    expect(matchBotfatherCommandEvent("/token")).toBe("bot_token_managed")
    expect(matchBotfatherCommandEvent("/revoke")).toBe("bot_token_managed")
    expect(matchBotfatherCommandEvent("/deletebot")).toBe("bot_deleted")
    expect(matchBotfatherCommandEvent("/connect")).toBe("bot_connect_prompt_got")
    expect(matchBotfatherCommandEvent("/disconnect")).toBe("bot_agent_disconnected")
    expect(matchBotfatherCommandEvent("/pending")).toBe("bot_friend_request_handled")
    expect(matchBotfatherCommandEvent("/approve")).toBe("bot_friend_request_handled")
    expect(matchBotfatherCommandEvent("/reject")).toBe("bot_friend_request_handled")
    expect(matchBotfatherCommandEvent("/help")).toBe("botfather_help_viewed")
    expect(matchBotfatherCommandEvent("/cancel")).toBe("botfather_command_cancelled")
    expect(matchBotfatherCommandEvent("/install")).toBe("chrome_plugin_install_triggered")
    expect(matchBotfatherCommandEvent("/unknown args")).toBe("botfather_command_sent")
    expect(matchBotfatherCommandEvent("/installation")).toBe("botfather_command_sent")
  })
})
