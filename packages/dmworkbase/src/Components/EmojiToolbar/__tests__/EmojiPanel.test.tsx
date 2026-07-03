// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 可变 mock state, 让 test 能运行时切换 flag 并手动触发 configChangeListener 回调,
// 忠实模拟 App.tsx notifyConfigChangeListeners 的真实运行时行为。
const hoisted = vi.hoisted(() => {
    const state = {
        stickerCustomEnabled: true,
        listener: null as (() => void) | null,
        // 按事件名捕获 mittBus 订阅的回调，让 test 能像真实广播那样手动触发。
        mittHandlers: {} as Record<string, () => void>,
    };
    return {
        state,
        getAllEmoji: vi.fn().mockReturnValue([]),
        userStickers: vi.fn().mockResolvedValue({ list: [] }),
        uploadSticker: vi.fn().mockResolvedValue({ path: "sticker-path", format: "png" }),
        addSticker: vi.fn().mockResolvedValue({}),
        addConfigChangeListener: vi.fn((cb: () => void) => {
            state.listener = cb;
            return () => {
                if (state.listener === cb) state.listener = null;
            };
        }),
        mittOn: vi.fn((event: string, cb: () => void) => {
            state.mittHandlers[event] = cb;
        }),
        mittOff: vi.fn((event: string, cb: () => void) => {
            if (state.mittHandlers[event] === cb) delete state.mittHandlers[event];
        }),
    };
});

vi.mock("../../../App", () => ({
    default: {
        endpointManager: {
            invoke: () => ({ getAllEmoji: hoisted.getAllEmoji }),
        },
        mittBus: { on: hoisted.mittOn, off: hoisted.mittOff },
        remoteConfig: {
            // getter: EmojiPanel.render 每次都读最新值, 与真实 WKRemoteConfig 单例语义一致。
            get stickerCustomEnabled() {
                return hoisted.state.stickerCustomEnabled;
            },
            addConfigChangeListener: hoisted.addConfigChangeListener,
        },
        dataSource: {
            commonDataSource: {
                userStickers: hoisted.userStickers,
                uploadSticker: hoisted.uploadSticker,
                addSticker: hoisted.addSticker,
                getFileURL: (p: string) => p,
            },
        },
    },
    __esModule: true,
}));

vi.mock("../../../i18n", () => ({
    t: (key: string) => key,
}));

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    },
}));

// LottieSticker 只被 EmojiToolbar (非 EmojiPanel) 用到, 但 index.tsx 顶部 import
// 拉入的 tgs-player / lottie-web 在 jsdom 下会 crash, 直接 stub。
vi.mock("../../../Messages/LottieSticker", () => ({
    LottieSticker: class {},
    isBitmapStickerFormat: () => true,
}));

// IconClick 只被 EmojiToolbar 用, EmojiPanel 不渲染它; stub 掉避免副作用。
vi.mock("../../IconClick", () => ({
    default: (props: any) =>
        React.createElement("div", { onClick: props.onClick }),
}));

// require("./emoji_tab_icon.png") 在 EmojiPanel.render 里被调用, 让 vitest 有静态 stub。
vi.mock("../emoji_tab_icon.png", () => ({ default: "stub.png" }));

import { EmojiPanel } from "../index";

let container: HTMLDivElement;

beforeEach(() => {
    hoisted.state.stickerCustomEnabled = true;
    hoisted.state.listener = null;
    hoisted.state.mittHandlers = {};
    hoisted.addConfigChangeListener.mockClear();
    hoisted.getAllEmoji.mockClear();
    hoisted.uploadSticker.mockClear();
    hoisted.addSticker.mockClear();
    hoisted.userStickers.mockClear();
    hoisted.mittOn.mockClear();
    hoisted.mittOff.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
});

function render(el: React.ReactElement) {
    act(() => {
        ReactDOM.render(el, container);
    });
}

function tabs(): Element[] {
    return Array.from(container.querySelectorAll(".wk-emojipanel-tab-item"));
}

describe("EmojiPanel sticker gating", () => {
    it("renders the sticker tab when stickerCustomEnabled is true", () => {
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);
        expect(tabs()).toHaveLength(2);
    });

    it("hides the sticker tab and all sticker controls when stickerCustomEnabled is false", () => {
        hoisted.state.stickerCustomEnabled = false;
        render(<EmojiPanel />);
        expect(tabs()).toHaveLength(1);
        expect(container.querySelector(".wk-sticker-add")).toBeNull();
        expect(container.querySelector(".wk-sticker-item")).toBeNull();
        expect(container.querySelector(".wk-sticker-empty")).toBeNull();
    });

    it("falls back to the emoji view when the flag flips false while the panel is on the sticker tab", () => {
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);

        const stickerTab = tabs()[1];
        act(() => {
            stickerTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        // 前置校验: 切换后确实进入了 sticker 视图, 上传入口渲染出来。
        expect(container.querySelector(".wk-sticker-add")).not.toBeNull();

        // 模拟后端翻 flag + notifyConfigChangeListeners。
        hoisted.state.stickerCustomEnabled = false;
        act(() => {
            hoisted.state.listener?.();
        });

        expect(tabs()).toHaveLength(1);
        expect(container.querySelector(".wk-sticker-add")).toBeNull();
        expect(container.querySelector(".wk-sticker-item")).toBeNull();
    });

    it("subscribes on mount and unsubscribes on unmount", () => {
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);
        expect(hoisted.addConfigChangeListener).toHaveBeenCalledTimes(1);
        expect(hoisted.state.listener).not.toBeNull();

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        expect(hoisted.state.listener).toBeNull();
    });

    it("re-fetches when an already-loaded panel receives stickers-updated", async () => {
        // P2-1: 收藏成功后广播 stickers-updated → 已加载过贴纸的面板重拉列表。
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);

        // 切到贴纸 tab 触发首次懒加载，stickersLoaded 置 true。
        const stickerTab = tabs()[1];
        await act(async () => {
            stickerTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
        });
        expect(hoisted.userStickers).toHaveBeenCalledTimes(1);
        hoisted.userStickers.mockClear();

        // 广播事件：已加载面板应再拉一次。
        await act(async () => {
            hoisted.state.mittHandlers["stickers-updated"]?.();
            await Promise.resolve();
        });
        expect(hoisted.userStickers).toHaveBeenCalledTimes(1);
    });

    it("does not re-fetch when the panel has not loaded stickers yet", async () => {
        // 懒加载语义：没点开过贴纸 tab（stickersLoaded=false）时，广播不触发多余请求。
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);
        expect(hoisted.userStickers).not.toHaveBeenCalled();

        await act(async () => {
            hoisted.state.mittHandlers["stickers-updated"]?.();
            await Promise.resolve();
        });
        expect(hoisted.userStickers).not.toHaveBeenCalled();
    });

    it("subscribes to stickers-updated on mount and unsubscribes on unmount", () => {
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);
        expect(typeof hoisted.state.mittHandlers["stickers-updated"]).toBe("function");

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        expect(hoisted.state.mittHandlers["stickers-updated"]).toBeUndefined();
    });

    it("does not upload when the flag flips false between opening the file picker and picking a file", async () => {
        // 覆盖 review 里 Jerry-Xin 标出的 race window: 「+ 按钮点击 → 用户选文件」之间的异步窗口,
        // 后端灰度翻掉 stickerCustomEnabled 后, onFileChange 不应再走 uploadSticker/addSticker。
        hoisted.state.stickerCustomEnabled = true;
        render(<EmojiPanel />);

        // 切到 sticker tab, 让 file input 及关联 handler 挂上。
        const stickerTab = tabs()[1];
        act(() => {
            stickerTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).not.toBeNull();

        // 模拟浏览器把用户选中的文件塞到 fileInput.files。
        const file = new File(["hello"], "s.png", { type: "image/png" });
        Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

        // 用户在 file picker 里犹豫的这段时间, 后端灰度关闭了 flag。
        hoisted.state.stickerCustomEnabled = false;
        act(() => {
            hoisted.state.listener?.();
        });

        // 用户最终确认了选择, onFileChange 触发。
        await act(async () => {
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            // 等 microtask 让 async onFileChange 走完 early guard。
            await Promise.resolve();
        });

        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
        expect(hoisted.addSticker).not.toHaveBeenCalled();
    });
});
