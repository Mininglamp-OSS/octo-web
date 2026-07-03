import { isStickerMessageCollectable } from "./collect"

// 「添加到我的贴纸」右键菜单的纯逻辑，从 module.tsx 抽出以便单测（module.tsx 顶层
// import 链太重，jsdom 下无法直接加载）。所有外部依赖（flag / 接口 / 广播 / i18n /
// Toast）都由调用方注入，本函数不直接依赖 WKApp / semi-ui，行为与内联版完全一致。

// 贴纸消息内容里本菜单会读到的字段（LottieSticker 的子集，避免 import 重量级类）。
export interface StickerCollectContent {
    format?: string | null
    url?: string | null
    placeholder?: string | null
}

export interface AddStickerMenuDeps {
    // 灰度开关：关闭时整个入口隐藏，与 EmojiToolbar 的「我的贴纸」tab/上传/删除保持一致。
    stickerCustomEnabled: boolean
    collect: (req: { path: string; placeholder?: string }) => Promise<unknown>
    // 收藏成功后广播，让已加载过贴纸的 EmojiPanel 重拉列表。
    emitUpdated: () => void
    t: (key: string) => string
    toast: { success: (msg: string) => void; error: (msg: string) => void }
}

export interface AddStickerMenuItem {
    title: string
    onClick: () => void
}

// 返回菜单项；不满足展示条件（flag 关 / 非可收藏位图贴纸）时返回 null（菜单隐藏）。
export function buildAddStickerMenu(
    contentType: number,
    content: StickerCollectContent,
    deps: AddStickerMenuDeps
): AddStickerMenuItem | null {
    // 灰度关闭时同样门控，避免用户收藏后却看不到、也管理不了。
    if (!deps.stickerCustomEnabled) {
        return null
    }
    if (!isStickerMessageCollectable(contentType, content.format, content.url)) {
        return null
    }
    return {
        title: deps.t("base.module.contextMenus.addSticker"),
        onClick: () => {
            deps
                .collect({
                    path: content.url as string,
                    // placeholder 空串留给后端用默认值，避免把消息侧的空字符串顶掉服务端默认。
                    placeholder: content.placeholder || undefined,
                })
                .then(() => {
                    deps.toast.success(deps.t("base.sticker.collectSuccess"))
                    deps.emitUpdated()
                })
                .catch((err: { code?: string; msg?: string }) => {
                    // 错误按 error.code 判断，不依赖 HTTP status。
                    if (err?.code === "err.server.sticker.quota_exceeded") {
                        deps.toast.error(deps.t("base.sticker.quotaExceeded"))
                    } else {
                        deps.toast.error(err?.msg || deps.t("base.sticker.collectFailed"))
                    }
                })
        },
    }
}
