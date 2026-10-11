import { beforeEach, expect, it, vi } from "vitest";
import { installScreenshotToolbar } from "./screenshot";
import type { ScreenshotHost } from "@octo/base/src/features/chat-composer/screenshot/contract";

const f = vi.hoisted(() => ({ register: vi.fn(), namespace: vi.fn() }));
vi.mock("@octo/base", () => ({
  i18n: { registerNamespace: f.namespace },
  WKApp: { endpoints: { registerChatToolbar: f.register } },
}));
vi.mock("@octo/base/src/features/chat-composer/screenshot/ScreenshotToolbar", () => ({
  ScreenshotToolbar: () => null,
}));
beforeEach(() => vi.clearAllMocks());

it.each([undefined, null, false, "capture"])('does not register for a legacy or malformed host (%s)', captureScreenshot => {
  const dispose = installScreenshotToolbar({ captureScreenshot } as unknown as ScreenshotHost);
  expect(f.register).not.toHaveBeenCalled();
  expect(f.namespace).not.toHaveBeenCalled();
  expect(dispose).not.toThrow();
});

it("registers only for a capable embedded host and stops rendering after disposal", () => {
  const dispose = installScreenshotToolbar({ captureScreenshot: async () => ({ status: "cancelled" }) });
  expect(f.register).toHaveBeenCalledOnce();
  const [id, render] = f.register.mock.calls[0];
  expect(id).toBe("chattoolbar.screenshot");
  expect(render({})).toBeTruthy();
  dispose();
  expect(render({})).toBeUndefined();
});
