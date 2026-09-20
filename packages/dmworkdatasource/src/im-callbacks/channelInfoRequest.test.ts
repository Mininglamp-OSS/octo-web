import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import WKSDK, { Channel, ChannelInfo } from "wukongimjssdk"
import { createChannelInfoRequest } from "./channelInfoRequest"

const channel = new Channel("peer", 1)
const info = Object.assign(new ChannelInfo(), {
  channel, title: "Peer", orgData: { displayName: "Peer" },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("channel info requests", () => {
  it("deduplicates concurrent requests and retries transient failures with a bound", async () => {
    const load = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue(info)
    const request = createChannelInfoRequest(load, () => () => true)
    const first = request(channel)
    expect(request(channel)).toBe(first)
    await vi.advanceTimersByTimeAsync(300)
    await expect(first).resolves.toBe(info)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 408, 429, 500, 503])("bounds retries and cools down errors with status %s", async (status) => {
    const error = { status }
    const load = vi.fn().mockRejectedValue(error)
    const request = createChannelInfoRequest(load, () => () => true)
    const first = request(channel)
    const rejected = expect(first).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await rejected
    expect(load).toHaveBeenCalledTimes(3)
    for (let i = 0; i < 10; i++) await expect(request(channel)).rejects.toBe(error)
    expect(load).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(30_000)
    load.mockResolvedValue(info)
    await expect(request(channel)).resolves.toBe(info)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it.each([400, 401, 403, 404, 422])("does not automatically retry status %s", async (status) => {
    const load = vi.fn().mockRejectedValue({ status })
    const request = createChannelInfoRequest(load, () => () => true)
    await expect(request(channel)).rejects.toEqual({ status })
    await vi.runAllTimersAsync()
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("honors the normalized HTTP status", async () => {
    const error = { status: 500, normalized: { httpStatus: 403 } }
    const load = vi.fn().mockRejectedValue(error)
    await expect(createChannelInfoRequest(load, () => () => true)(channel)).rejects.toBe(error)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("cancels retry after a context change and does not reuse the previous cooldown", async () => {
    let revision = 1
    const capture = () => {
      const captured = revision
      return () => captured === revision
    }
    const load = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue(info)
    const request = createChannelInfoRequest(load, capture)
    const old = request(channel)
    const rejected = expect(old).rejects.toThrow("context expired")
    revision++
    await expect(request(channel)).resolves.toBe(info)
    await vi.runAllTimersAsync()
    await rejected
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("rejects a late successful response before the SDK can write it into a new context", async () => {
    let current = true
    let resolve!: (info: ChannelInfo) => void
    const load = () => new Promise<ChannelInfo>(done => { resolve = done })
    const request = createChannelInfoRequest(load, () => () => current)
    const sdk = WKSDK.shared()
    const previous = sdk.config.provider.channelInfoCallback
    sdk.config.provider.channelInfoCallback = request
    sdk.channelManager.deleteChannelInfo(channel)
    try {
      const pending = sdk.channelManager.fetchChannelInfo(channel)
      const rejected = expect(pending).rejects.toThrow("context expired")
      current = false
      resolve(info)
      await rejected
      expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined()
    } finally {
      sdk.config.provider.channelInfoCallback = previous
    }
  })

  it("leaves a previously cached name intact when a refresh fails", async () => {
    const sdk = WKSDK.shared()
    const previous = sdk.config.provider.channelInfoCallback
    sdk.channelManager.setChannleInfoForCache(info)
    sdk.config.provider.channelInfoCallback = createChannelInfoRequest(
      vi.fn().mockRejectedValue({ status: 403 }), () => () => true,
    )
    try {
      await expect(sdk.channelManager.fetchChannelInfo(channel)).rejects.toEqual({ status: 403 })
      expect(sdk.channelManager.getChannelInfo(channel)).toBe(info)
    } finally {
      sdk.channelManager.deleteChannelInfo(channel)
      sdk.config.provider.channelInfoCallback = previous
    }
  })
})
