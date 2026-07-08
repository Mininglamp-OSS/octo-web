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
