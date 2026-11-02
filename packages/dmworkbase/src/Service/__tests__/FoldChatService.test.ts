import { beforeEach, expect, it, vi } from "vitest"
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock("../APIClient", () => ({ default: { shared: api } }))
import service from "../FoldChatService"
beforeEach(() => vi.clearAllMocks())
it("sends explicit space and preserves group/thread identity", async () => {
 api.get.mockResolvedValue([{ channel_id: "g:t", channel_type: 5 }])
 expect(await service.list("space-a")).toEqual([{ channel_id: "g:t", channel_type: 5 }])
 expect(api.get).toHaveBeenCalledWith("/conversation/folded", { headers: { "X-Space-Id": "space-a" } })
 await service.set("space-b", { channel_id: "g:t", channel_type: 5 }, false)
 expect(api.put).toHaveBeenCalledWith("/conversation/folded", {channel_id:"g:t",channel_type:5,folded:false}, {headers:{"X-Space-Id":"space-b"}})
})
