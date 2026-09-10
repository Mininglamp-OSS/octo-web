// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const busHandlers = new Set<() => void>();
const submitPluginReview = vi.fn();
let modalCancel: () => void;

vi.mock("@dmwork/skillmarket", () => ({ versionErrorKey: () => undefined }));
vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  WKApp: {
    mittBus: {
      on: (event: string, handler: () => void) => {
        expect(event).toBe("space-changed");
        busHandlers.add(handler);
      },
      off: (_event: string, handler: () => void) => busHandlers.delete(handler),
    },
  },
  WKInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  WKButton: ({ children, onClick, disabled, loading }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick} data-loading={Boolean(loading)}>
      {children}
    </button>
  ),
  // Mirrors WKModal/index.tsx: X is conditional on options.closable; Semi's
  // mask/Escape paths use maskClosable/closeOnEsc; all dispatch onCancel.
  WKModal: ({ visible, onCancel, options, children, footer }: {
    visible: boolean;
    onCancel: () => void;
    options?: { closable?: boolean; maskClosable?: boolean; closeOnEsc?: boolean };
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => {
    modalCancel = onCancel;
    if (!visible) return null;
    return (
      <div role="dialog" onKeyDown={(event) => {
        if (event.key === "Escape" && options?.closeOnEsc !== false) onCancel();
      }}>
        <button aria-label="mask" onClick={() => {
          if (options?.maskClosable !== false) onCancel();
        }} />
        {options?.closable !== false && <button aria-label="close" onClick={onCancel} />}
        {children}{footer}
      </div>
    );
  },
}));
vi.mock("@douyinfe/semi-ui", () => ({
  TextArea: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("../../api/pluginReview", () => ({
  submitPluginReview: (...args: unknown[]) => submitPluginReview(...args),
}));

import ReviewSubmitModal, { type ReviewSubmitTarget } from "../ReviewSubmitModal";

const PUBLISH = "skillMarket.plugin.actionPublish";
const CANCEL = "mcp.review.cancel";
let container: HTMLDivElement;
let onClose = vi.fn();
let onSubmitted = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function target(pluginId = "a"): ReviewSubmitTarget {
  return { pluginId, name: pluginId, version: "1.0.0", isUpgrade: false, initialChangelog: "changes" };
}

async function render(item: ReviewSubmitTarget | null) {
  await act(async () => {
    ReactDOM.render(
      <ReviewSubmitModal target={item} onClose={onClose} onSubmitted={onSubmitted} />,
      container
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  await act(async () => { button(label).click(); });
}

function editChangelog(value: string) {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Missing changelog");
  act(() => {
    textarea.value = value;
    Simulate.change(textarea);
  });
}

function changeSpace() {
  act(() => { for (const handler of [...busHandlers]) handler(); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  onClose = vi.fn();
  onSubmitted = vi.fn();
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
  expect(busHandlers.size).toBe(0);
  vi.resetAllMocks();
});

describe("ReviewSubmitModal submission session", () => {
  it("reports and closes a successful submission in the current session", async () => {
    submitPluginReview.mockResolvedValue(undefined);
    await render(target());
    await click(PUBLISH);
    expect(submitPluginReview).toHaveBeenCalledWith({
      pluginId: "a", version: "1.0.1", changelog: "changes",
    });
    expect(onSubmitted).toHaveBeenCalledWith("skillMarket.review.submittedToast");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(button(PUBLISH).disabled).toBe(false);
  });

  it("shows a current failure and allows retry", async () => {
    submitPluginReview.mockRejectedValue(new Error("current failure"));
    await render(target());
    await click(PUBLISH);
    expect(container.textContent).toContain("current failure");
    expect(button(PUBLISH).disabled).toBe(false);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["footer", "close", "mask", "Escape"])("allows idle dismissal through %s", async (path) => {
    await render(target());
    act(() => {
      if (path === "footer") button(CANCEL).click();
      else if (path === "Escape") container.querySelector('[role="dialog"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      else container.querySelector<HTMLButtonElement>(`[aria-label="${path}"]`)?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks every dismissal entry and duplicate submit while pending", async () => {
    const request = deferred<void>();
    submitPluginReview.mockReturnValue(request.promise);
    await render(target());
    const queuedCancel = modalCancel;
    await click(PUBLISH);
    expect(button(CANCEL).disabled).toBe(true);
    expect(container.querySelector('[aria-label="close"]')).toBeNull();
    act(() => {
      button(CANCEL).click();
      button(PUBLISH).click();
      container.querySelector<HTMLButtonElement>('[aria-label="mask"]')?.click();
      container.querySelector('[role="dialog"]')?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      modalCancel();
      queuedCancel(); // An already queued dismissal must consult the live lock.
    });
    expect(submitPluginReview).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { request.resolve(); });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["replacement", "success"], ["replacement", "failure"],
    ["reopen", "success"], ["reopen", "failure"],
    ["A-B-A", "success"], ["A-B-A", "failure"],
    ["Space A-B-A", "success"], ["Space A-B-A", "failure"],
  ])("ignores old %s %s, including finally, while the new session submits", async (transition, outcome) => {
    const oldRequest = deferred<void>();
    const newRequest = deferred<void>();
    submitPluginReview.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const a = target();
    await render(a);
    await click(PUBLISH);
    if (transition === "Space A-B-A") {
      changeSpace();
      changeSpace();
      await render(null);
      await render(a);
    } else if (transition === "reopen") {
      await render(null);
      await render(a);
    } else {
      await render(target("b"));
      if (transition === "A-B-A") await render(a);
    }
    editChangelog("new session edits");
    await click(PUBLISH);
    expect(submitPluginReview).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (outcome === "success") oldRequest.resolve();
      else oldRequest.reject(new Error("old failure"));
    });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("old failure");
    expect(container.querySelector("textarea")?.value).toBe("new session edits");
    expect(button(PUBLISH).disabled).toBe(true);
    expect(button(PUBLISH).dataset.loading).toBe("true");
    expect(button(CANCEL).disabled).toBe(true);
    await act(async () => { newRequest.resolve(); });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"])("abandons %s on a Space event even before the target changes", async (outcome) => {
    const request = deferred<void>();
    submitPluginReview.mockReturnValue(request.promise);
    await render(target());
    await click(PUBLISH);
    changeSpace();
    changeSpace();
    await act(async () => {
      if (outcome === "success") request.resolve();
      else request.reject(new Error("old Space failure"));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("old Space failure");
  });

  it.each(["success", "failure"])("abandons %s after unmount", async (outcome) => {
    const request = deferred<void>();
    submitPluginReview.mockReturnValue(request.promise);
    await render(target());
    await click(PUBLISH);
    act(() => { ReactDOM.unmountComponentAtNode(container); });
    expect(busHandlers.size).toBe(0);
    await act(async () => {
      if (outcome === "success") request.resolve();
      else request.reject(new Error("unmounted failure"));
    });
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rechecks the session after onSubmitted synchronously replaces the target", async () => {
    const request = deferred<void>();
    submitPluginReview.mockReturnValue(request.promise);
    onSubmitted.mockImplementation(() => {
      ReactDOM.render(
        <ReviewSubmitModal target={target("b")} onClose={onClose} onSubmitted={onSubmitted} />,
        container
      );
    });
    await render(target());
    await click(PUBLISH);
    await act(async () => { request.resolve(); });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ReviewSubmitModal snapshot session", () => {
  const content = { manifestJson: { name: "expert" }, pluginJson: { version: "1.0.0" } };

  it("freezes content and explicit empty relations from one snapshot read", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue({ content, relations: [] });
    submitPluginReview.mockResolvedValue(undefined);
    await render({ ...target(), needs: { content: true, relations: true }, loadSnapshot });
    await click(PUBLISH);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(submitPluginReview).toHaveBeenCalledWith({
      pluginId: "a", version: "1.0.1", changelog: "changes", ...content, relations: [],
    });
  });

  it.each(["content", "relations"])("blocks a resolved snapshot missing required %s", async (missing) => {
    const loadSnapshot = vi.fn().mockResolvedValue(missing === "content" ? { relations: [] } : { content });
    await render({ ...target(), needs: { content: true, relations: true }, loadSnapshot });
    expect(button(PUBLISH).disabled).toBe(true);
    await click(PUBLISH);
    expect(submitPluginReview).not.toHaveBeenCalled();
  });

  it.each(["target", "Space"])("ignores a stale snapshot after a %s change", async (transition) => {
    const oldRead = deferred<{ content: typeof content; relations: [] }>();
    await render({ ...target(), needs: { content: true, relations: true }, loadSnapshot: () => oldRead.promise });
    if (transition === "Space") changeSpace();
    else await render({ ...target("b"), needs: { content: true, relations: true } });
    await act(async () => { oldRead.resolve({ content, relations: [] }); });
    expect(button(PUBLISH).disabled).toBe(true);
    expect(container.textContent).not.toContain("mcp.review.relationsFrozen");
    expect(submitPluginReview).not.toHaveBeenCalled();
  });
});
