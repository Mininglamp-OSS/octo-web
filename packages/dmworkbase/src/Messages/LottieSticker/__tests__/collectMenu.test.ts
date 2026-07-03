import { describe, it, expect, vi } from "vitest"
import { buildAddStickerMenu, AddStickerMenuDeps } from "../collectMenu"
import { MessageContentTypeConst } from "../../../Service/Const"

// 位图贴纸消息里 content.url 存的是原始存储路径（收藏时原样透传给后端）。
const BITMAP_PATH = "file/preview/sticker/uid-1/abc.png"

function makeDeps(overrides: Partial<AddStickerMenuDeps> = {}): AddStickerMenuDeps {
    return {
        stickerCustomEnabled: true,
        collect: vi.fn().mockResolvedValue({}),
        emitUpdated: vi.fn(),
        t: (key: string) => key,
        toast: { success: vi.fn(), error: vi.fn() },
        ...overrides,
    }
}

// onClick 内是 .then().catch() 异步链，冲刷一轮宏任务确保回调跑完。
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// P2-2：菜单显隐门控——flag 关 / 非可收藏位图贴纸都必须隐藏（返回 null）。
describe("buildAddStickerMenu — visibility gate (P2-2)", () => {
    it("hides the menu when stickerCustomEnabled is false, even for a collectable sticker", () => {
        const item = buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH },
            makeDeps({ stickerCustomEnabled: false })
        )
        expect(item).toBeNull()
    })

    it("hides the menu when the flag is on but the message is not a collectable bitmap sticker", () => {
        const deps = makeDeps({ stickerCustomEnabled: true })
        // tgs / 未知格式（历史 Lottie 贴纸）
        expect(
            buildAddStickerMenu(MessageContentTypeConst.lottieSticker, { format: "tgs", url: BITMAP_PATH }, deps)
        ).toBeNull()
        // 空 url（历史或坏消息，没有可收藏的路径）
        expect(
            buildAddStickerMenu(MessageContentTypeConst.lottieSticker, { format: "png", url: "" }, deps)
        ).toBeNull()
        // 非贴纸消息类型（图片 =2）
        expect(
            buildAddStickerMenu(MessageContentTypeConst.image, { format: "png", url: BITMAP_PATH }, deps)
        ).toBeNull()
    })

    it("shows the menu when the flag is on and the sticker is a collectable bitmap", () => {
        const on = buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH },
            makeDeps()
        )
        expect(on).not.toBeNull()
        expect(on!.title).toBe("base.module.contextMenus.addSticker")
        // contentType 13（emoji 贴纸）同样可收藏
        const emojiVariant = buildAddStickerMenu(
            MessageContentTypeConst.lottieEmojiSticker,
            { format: "webp", url: BITMAP_PATH },
            makeDeps()
        )
        expect(emojiVariant).not.toBeNull()
    })
})

// P2-1：onClick 的收藏调用 + 成功广播 + 按 error.code 的错误分发。
describe("buildAddStickerMenu — onClick collect & error dispatch (P2-1)", () => {
    it("collects with path/placeholder, then toasts success and broadcasts stickers-updated", async () => {
        const deps = makeDeps()
        const item = buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH, placeholder: "ph" },
            deps
        )!
        item.onClick()
        await flush()
        expect(deps.collect).toHaveBeenCalledWith({ path: BITMAP_PATH, placeholder: "ph" })
        expect(deps.toast.success).toHaveBeenCalledWith("base.sticker.collectSuccess")
        expect(deps.emitUpdated).toHaveBeenCalledTimes(1)
        expect(deps.toast.error).not.toHaveBeenCalled()
    })

    it("sends placeholder=undefined when the message placeholder is empty (lets backend default win)", async () => {
        const deps = makeDeps()
        buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH, placeholder: "" },
            deps
        )!.onClick()
        await flush()
        expect(deps.collect).toHaveBeenCalledWith({ path: BITMAP_PATH, placeholder: undefined })
    })

    it("shows the dedicated quota toast on err.server.sticker.quota_exceeded (no success, no broadcast)", async () => {
        const deps = makeDeps({
            collect: vi.fn().mockRejectedValue({ code: "err.server.sticker.quota_exceeded" }),
        })
        buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH },
            deps
        )!.onClick()
        await flush()
        expect(deps.toast.error).toHaveBeenCalledWith("base.sticker.quotaExceeded")
        expect(deps.toast.success).not.toHaveBeenCalled()
        expect(deps.emitUpdated).not.toHaveBeenCalled()
    })

    it("falls back to err.msg for a non-quota error", async () => {
        const deps = makeDeps({
            collect: vi.fn().mockRejectedValue({ code: "err.server.sticker.request_invalid", msg: "bad path" }),
        })
        buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH },
            deps
        )!.onClick()
        await flush()
        expect(deps.toast.error).toHaveBeenCalledWith("bad path")
    })

    it("falls back to the generic collectFailed copy when the error has neither code nor msg", async () => {
        const deps = makeDeps({ collect: vi.fn().mockRejectedValue({}) })
        buildAddStickerMenu(
            MessageContentTypeConst.lottieSticker,
            { format: "png", url: BITMAP_PATH },
            deps
        )!.onClick()
        await flush()
        expect(deps.toast.error).toHaveBeenCalledWith("base.sticker.collectFailed")
    })
})
