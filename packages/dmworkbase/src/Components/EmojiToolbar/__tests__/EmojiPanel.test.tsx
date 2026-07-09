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
        // 默认值 = 历史硬编码值 (改动前 MAX_STICKER_BYTES=1MB / 512px / 5 种格式),
        // 各 case 按需覆盖来模拟运维在管理台调整上限。
        stickerUploadLimits: {
            maxSizeKB: 1024,
            maxDimension: 512,
            allowedFormats: [".gif", ".png", ".jpg", ".jpeg", ".webp"],
        },
        listener: null as (() => void) | null,
        // 按事件名捕获 mittBus 订阅的回调，让 test 能像真实广播那样手动触发。
        mittHandlers: {} as Record<string, () => void>,
        // 控制 mocked Image 的 decode 结果: {width,height} 模拟解码成功, "error" 模拟
        // 解码失败(fail-open 分支)。默认给一张远小于 512px 的合法图片。
        nextImageResult: { width: 100, height: 100 } as { width: number; height: number } | "error",
    };
    return {
        state,
        getAllEmoji: vi.fn().mockReturnValue([]),
        userStickers: vi.fn().mockResolvedValue({ list: [] }),
        uploadSticker: vi.fn().mockResolvedValue({ path: "sticker-path", format: "png" }),
        addSticker: vi.fn().mockResolvedValue({}),
        deleteSticker: vi.fn().mockResolvedValue({}),
        toastError: vi.fn(),
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

// EmojiToolbar/index.tsx 的 readStickerImageDimensions 用 new Image() + object URL 读
// naturalWidth/naturalHeight; jsdom 不会真的解码图片 (onload 不会自然触发), 所以用这个
// 假 Image 类接管, 按 hoisted.state.nextImageResult 同步调度 onload/onerror。
class MockImage {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
        queueMicrotask(() => {
            const result = hoisted.state.nextImageResult;
            if (result === "error") {
                this.onerror?.();
                return;
            }
            this.naturalWidth = result.width;
            this.naturalHeight = result.height;
            this.onload?.();
        });
    }
}

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
            get stickerUploadLimits() {
                return hoisted.state.stickerUploadLimits;
            },
            addConfigChangeListener: hoisted.addConfigChangeListener,
        },
        dataSource: {
            commonDataSource: {
                userStickers: hoisted.userStickers,
                uploadSticker: hoisted.uploadSticker,
                addSticker: hoisted.addSticker,
                deleteSticker: hoisted.deleteSticker,
                getFileURL: (p: string) => p,
            },
        },
    },
    __esModule: true,
}));

vi.mock("../../../i18n", () => ({
    // 把 interpolation values 编码进返回值, 让 test 既能断言具体是哪条校验文案触发,
    // 也能断言传给它的动态上限值 (例如 dimensionTooLarge 的 {{dimension}})。
    t: (key: string, options?: { values?: Record<string, unknown> }) =>
        options?.values ? `${key}:${JSON.stringify(options.values)}` : key,
}));

vi.mock("@douyinfe/semi-ui", () => ({
    Toast: {
        success: vi.fn(),
        error: (...a: unknown[]) => hoisted.toastError(...a),
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
let originalImage: typeof Image;
let originalCreateObjectURL: typeof URL.createObjectURL;
let originalRevokeObjectURL: typeof URL.revokeObjectURL;

beforeEach(() => {
    hoisted.state.stickerCustomEnabled = true;
    hoisted.state.stickerUploadLimits = {
        maxSizeKB: 1024,
        maxDimension: 512,
        allowedFormats: [".gif", ".png", ".jpg", ".jpeg", ".webp"],
    };
    hoisted.state.nextImageResult = { width: 100, height: 100 };
    hoisted.state.listener = null;
    hoisted.state.mittHandlers = {};
    hoisted.addConfigChangeListener.mockClear();
    hoisted.getAllEmoji.mockClear();
    hoisted.uploadSticker.mockClear();
    hoisted.addSticker.mockClear();
    hoisted.deleteSticker.mockClear();
    hoisted.userStickers.mockClear();
    hoisted.mittOn.mockClear();
    hoisted.mittOff.mockClear();
    hoisted.toastError.mockClear();

    originalImage = global.Image;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    (global as unknown as { Image: typeof Image }).Image = MockImage as unknown as typeof Image;
    URL.createObjectURL = vi.fn(() => "blob:mock-sticker-url");
    URL.revokeObjectURL = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    global.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
});

function render(el: React.ReactElement) {
    act(() => {
        ReactDOM.render(el, container);
    });
}

function tabs(): Element[] {
    return Array.from(container.querySelectorAll(".wk-emojipanel-tab-item"));
}

function fileInputEl(): HTMLInputElement {
    return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function selectFile(file: File) {
    const input = fileInputEl();
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

// onFileChange 现在有多段 await (dimension 探测走 queueMicrotask, 再串 uploadSticker /
// addSticker / requestStickers)。一个 macrotask 足以让所有排队的 microtask 先跑完。
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
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

describe("EmojiPanel sticker hover preview（原位放大预览）", () => {
    const STICKER = {
        sticker_id: "s1",
        path: "sticker-1.png",
        category: "sticker",
        placeholder: "",
        format: "png",
    };

    // 切到「我的贴纸」tab 并等首屏懒加载完成，返回渲染出来的第一个贴纸格子。
    async function mountWithSticker(): Promise<HTMLElement> {
        hoisted.userStickers.mockResolvedValueOnce({ list: [STICKER] });
        render(<EmojiPanel />);
        await act(async () => {
            tabs()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
        });
        const item = container.querySelector(".wk-sticker-item") as HTMLElement;
        expect(item).not.toBeNull();
        return item;
    }

    // React 17 的 onMouseEnter/onMouseLeave 由根节点上的 mouseover/mouseout 合成而来，
    // 直接 dispatch 原生 mouseenter/mouseleave 不会触发合成事件，故用 mouseover/mouseout。
    function hover(el: HTMLElement) {
        act(() => {
            el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
        });
    }
    function leave(el: HTMLElement) {
        act(() => {
            el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
        });
    }

    it("portals an enlarged preview to <body> after the hover delay elapses", async () => {
        const item = await mountWithSticker();

        vi.useFakeTimers();
        hover(item);
        // 延时未到之前不浮出，避免鼠标扫过网格时狂闪。
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();

        const preview = document.body.querySelector(".wk-sticker-preview");
        expect(preview).not.toBeNull();
        // 位图贴纸走 <img>，且尺寸远大于 60px 缩略图（由 CSS 控制，这里只断言渲染出媒体）。
        expect(preview!.querySelector("img")).not.toBeNull();
    });

    it("hides the preview when the pointer leaves the sticker grid", async () => {
        const item = await mountWithSticker();
        const ul = container.querySelector(".wk-emojipanel-content ul") as HTMLElement;

        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        leave(ul);
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("clears a still-pending preview timer on unmount without throwing", async () => {
        const item = await mountWithSticker();

        vi.useFakeTimers();
        hover(item); // 起了延时但还没浮出
        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        // 卸载后即使 fire 掉挂起的 timer 也不应 setState 报错或残留浮层。
        expect(() => {
            act(() => {
                vi.advanceTimersByTime(500);
            });
        }).not.toThrow();
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("hides the preview on scroll while it is visible (frozen rect would go stale)", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 网格滚动/窗口缩放会让一次性捕获的 rect 失真；捕获阶段 scroll 监听应隐藏预览。
        act(() => {
            window.dispatchEvent(new Event("scroll"));
        });
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("clears the preview when the hovered sticker is deleted (no ghost)", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 删除 × 的 onClick stopPropagation 绕过 <li> 的 hide；onDelete 顶部需自行清预览。
        const del = item.querySelector(".wk-sticker-del") as HTMLElement;
        act(() => {
            del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(hoisted.deleteSticker).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("hides the preview when leaving a sticker for non-sticker space inside the grid", async () => {
        const item = await mountWithSticker();
        const ul = container.querySelector(".wk-emojipanel-content ul") as HTMLElement;
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 指针离开贴纸但仍在 <ul> 内（relatedTarget 是 ul，非贴纸）：<ul> 的 mouseleave
        // 不触发，需靠 .wk-sticker-item 上的 onMouseLeave 隐藏，避免预览滞留在空白处。
        act(() => {
            item.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: ul }));
        });
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("cancels a pending preview when leaving the sticker before the delay elapses", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item); // 起了 120ms 延时但还没浮出
        leave(item); // 延时内离开 → 应清掉待触发的 timer
        act(() => {
            vi.advanceTimersByTime(300);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("keeps the preview visible when moving directly onto another sticker (seamless swap)", async () => {
        hoisted.userStickers.mockResolvedValueOnce({
            list: [STICKER, { ...STICKER, sticker_id: "s2", path: "sticker-2.png" }],
        });
        render(<EmojiPanel />);
        await act(async () => {
            tabs()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
        });
        const items = container.querySelectorAll(".wk-sticker-item");
        const a = items[0] as HTMLElement;
        const b = items[1] as HTMLElement;

        vi.useFakeTimers();
        hover(a);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 从 a 直接移到另一张贴纸 b（relatedTarget 是贴纸）：不应隐藏——交给 b 的
        // onMouseEnter 无缝切换目标，保留 Discord 式跟随。
        act(() => {
            a.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: b }));
        });
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 仅证明"没被隐藏"还不够——真实鼠标移动会在 a 的 mouseout 之外，紧接着在 b 上触发
        // mouseover。补上这一步，断言预览的媒体确实换成了 b（而不只是继续显示着 a 的旧图）。
        hover(b);
        const img = document.body.querySelector(".wk-sticker-preview img") as HTMLImageElement | null;
        expect(img?.src).toContain("sticker-2.png");
    });

    it("clears a visible preview when a background refresh removes the previewed sticker (no ghost)", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 已加载过贴纸的面板才会重拉（stickersLoaded 已在 mountWithSticker 里置 true），
        // 模拟后台「stickers-updated」广播把正在预览的这张贴纸移除掉——指针没有移动，
        // 不会触发任何既有的 hide 路径，必须靠 requestStickers 自己核对 sticker_id。
        hoisted.userStickers.mockResolvedValueOnce({ list: [] });
        await act(async () => {
            hoisted.state.mittHandlers["stickers-updated"]?.();
            await Promise.resolve();
        });
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("clears a visible preview when a background refresh fails (grid goes empty too)", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).not.toBeNull();

        // 失败分支把 stickers 清空——和成功分支返回空列表是同一类残影，预览必须一起清掉，
        // 否则放大卡片会浮在一个已经空掉的网格上方。
        hoisted.userStickers.mockRejectedValueOnce(new Error("network error"));
        await act(async () => {
            hoisted.state.mittHandlers["stickers-updated"]?.();
            await Promise.resolve();
        });
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("does not show a pending preview for a sticker removed by a refresh before the delay elapses", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item); // 起了 120ms 延时，还没浮出

        // 延时排队期间后台广播把这张贴纸移除掉。
        hoisted.userStickers.mockResolvedValueOnce({ list: [] });
        await act(async () => {
            hoisted.state.mittHandlers["stickers-updated"]?.();
            await Promise.resolve();
        });

        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();
        expect(document.body.querySelector(".wk-sticker-preview")).toBeNull();
    });

    it("marks the portaled preview aria-hidden so it is not announced as a duplicate", async () => {
        const item = await mountWithSticker();
        vi.useFakeTimers();
        hover(item);
        act(() => {
            vi.advanceTimersByTime(120);
        });
        vi.useRealTimers();

        const preview = document.body.querySelector(".wk-sticker-preview");
        expect(preview?.getAttribute("aria-hidden")).toBe("true");
    });
});

describe("EmojiPanel sticker upload validation (WKApp.remoteConfig.stickerUploadLimits)", () => {
    const bytes = (size: number) => new Uint8Array(size);

    it("uploads when size, extension and dimensions are all within the configured limits", async () => {
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.uploadSticker).toHaveBeenCalledTimes(1);
        expect(hoisted.addSticker).toHaveBeenCalledTimes(1);
        expect(hoisted.toastError).not.toHaveBeenCalled();
    });

    it("rejects an extension outside allowedFormats and does not upload", async () => {
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.bmp", { type: "image/bmp" }));
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining("base.sticker.formatUnsupported")
        );
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("rejects an extension that ops narrowed out of allowedFormats", async () => {
        // 运维在管理台把 allowedFormats 收窄到只剩 png——历史上被接受的 gif 现在应被拒。
        hoisted.state.stickerUploadLimits = {
            ...hoisted.state.stickerUploadLimits,
            allowedFormats: [".png"],
        };
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.gif", { type: "image/gif" }));
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining("base.sticker.formatUnsupported")
        );
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("rejects a file exceeding the configured maxSizeKB and does not upload", async () => {
        hoisted.state.stickerUploadLimits = { ...hoisted.state.stickerUploadLimits, maxSizeKB: 1 };
        render(<EmojiPanel />);
        selectFile(new File([bytes(2048)], "s.png", { type: "image/png" })); // 2KB > 1KB limit
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining("base.sticker.tooLarge")
        );
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("accepts a file the historical 1MB default would have rejected once ops widens maxSizeKB", async () => {
        hoisted.state.stickerUploadLimits = { ...hoisted.state.stickerUploadLimits, maxSizeKB: 5120 };
        render(<EmojiPanel />);
        selectFile(new File([bytes(2 * 1024 * 1024)], "s.png", { type: "image/png" })); // 2MB
        await flush();

        expect(hoisted.uploadSticker).toHaveBeenCalledTimes(1);
    });

    it("rejects an image exceeding the configured maxDimension and does not upload", async () => {
        hoisted.state.nextImageResult = { width: 1024, height: 300 };
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining("base.sticker.dimensionTooLarge")
        );
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("interpolates the configured maxDimension into the dimension-exceeded message", async () => {
        hoisted.state.stickerUploadLimits = { ...hoisted.state.stickerUploadLimits, maxDimension: 900 };
        hoisted.state.nextImageResult = { width: 901, height: 10 };
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining('"dimension":"900"')
        );
    });

    it("fails open and proceeds to upload when local dimension decoding errors out", async () => {
        // 本地探测失败(文件损坏等)不该拦掉合法上传——交给服务端 modules/file 侧兜底。
        hoisted.state.nextImageResult = "error";
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.uploadSticker).toHaveBeenCalledTimes(1);
    });

    it("binds the file input's accept attribute to the configured allowedFormats", () => {
        hoisted.state.stickerUploadLimits = {
            ...hoisted.state.stickerUploadLimits,
            allowedFormats: [".png", ".webp"],
        };
        render(<EmojiPanel />);
        expect(fileInputEl().accept).toBe(".png,.webp");
    });
});

describe("EmojiPanel sticker upload — async race fixes", () => {
    const bytes = (size: number) => new Uint8Array(size);

    it("sets uploading synchronously before the dimension-decode await resolves, closing the re-entrancy window", () => {
        // 修复前 uploading 只在 dimension 探测 resolve 之后才置位, 探测期间「+」按钮的
        // !uploading 门控形同虚设, 用户能在同一次选择还没校验完时再选一张触发并发上传。
        render(<EmojiPanel />);
        // spinner 图标只在 isSticker(切到「我的贴纸」tab)时才会挂载, 先切过去。
        act(() => {
            tabs()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        act(() => {
            selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        });
        // 此刻 dimension 探测的 queueMicrotask 还没跑(没有 flush), 但同步校验通过后
        // uploading 应该已经是 true——spinner 图标是 uploading 状态在 DOM 上的唯一体现。
        expect(container.querySelector(".wk-sticker-spin")).not.toBeNull();
    });

    it("resets uploading back to false after the post-await dimension check rejects the file", async () => {
        hoisted.state.nextImageResult = { width: 1024, height: 300 };
        render(<EmojiPanel />);
        act(() => {
            tabs()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(container.querySelector(".wk-sticker-spin")).toBeNull();
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("re-reads live stickerUploadLimits after the dimension-decode await instead of the pre-await snapshot", async () => {
        // 300x10 在初始 maxDimension=512 下本应通过; 探测这段 await 期间运维把上限收窄到
        // 200——校验必须用收窄后的新值判断, 而不是发起探测那一刻捕获的旧 limits。
        hoisted.state.nextImageResult = { width: 300, height: 10 };
        queueMicrotask(() => {
            hoisted.state.stickerUploadLimits = {
                ...hoisted.state.stickerUploadLimits,
                maxDimension: 200,
            };
        });
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.toastError).toHaveBeenCalledWith(
            expect.stringContaining('"dimension":"200"')
        );
        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });

    it("re-checks stickerCustomEnabled after the dimension-decode await and blocks a mid-flight disable", async () => {
        queueMicrotask(() => {
            hoisted.state.stickerCustomEnabled = false;
        });
        render(<EmojiPanel />);
        selectFile(new File([bytes(100)], "s.png", { type: "image/png" }));
        await flush();

        expect(hoisted.uploadSticker).not.toHaveBeenCalled();
    });
});
