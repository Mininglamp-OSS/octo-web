// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentViewer } from "./types";

const hoisted = vi.hoisted(() => {
  type Handler = (payload: { menuId: string }) => void;
  const handlers = new Map<string, Set<Handler>>();
  const load = vi.fn();
  const on = vi.fn((type: string, handler: Handler) => {
    const current = handlers.get(type) || new Set<Handler>();
    current.add(handler);
    handlers.set(type, current);
  });
  const off = vi.fn((type: string, handler: Handler) => {
    handlers.get(type)?.delete(handler);
  });

  return {
    load,
    on,
    off,
    emit(type: string, payload: { menuId: string }) {
      handlers.get(type)?.forEach((handler) => handler(payload));
    },
    resetHandlers() {
      handlers.clear();
    },
  };
});

vi.mock("../../App", () => ({
  default: {
    mittBus: {
      on: hoisted.on,
      off: hoisted.off,
    },
  },
}));

vi.mock("./service", () => ({
  documentRepository: {
    load: hoisted.load,
  },
}));

import { useDocumentState } from "./useDocumentState";

const viewer: DocumentViewer = {
  uid: "u-chenyi",
  name: "陈一",
  accessibleChannelIds: ["group-product-plan"],
  accessibleSpaceNames: ["产品部公共空间"],
};

function Probe() {
  const { state } = useDocumentState(viewer);
  return <div data-loaded={state ? "true" : "false"} />;
}

let container: HTMLDivElement;

async function flushUpdates() {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderProbe() {
  await act(async () => {
    ReactDOM.render(<Probe />, container);
    await flushUpdates();
  });
}

beforeEach(() => {
  hoisted.resetHandlers();
  hoisted.load.mockReset().mockResolvedValue({ files: [], spaces: [] });
  hoisted.on.mockClear();
  hoisted.off.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("useDocumentState", () => {
  it("reloads when the Documents navigation menu is activated", async () => {
    await renderProbe();
    expect(hoisted.load).toHaveBeenCalledTimes(1);

    await act(async () => {
      hoisted.emit("wk:nav-menu-activated", { menuId: "chat" });
      await flushUpdates();
    });
    expect(hoisted.load).toHaveBeenCalledTimes(1);

    await act(async () => {
      hoisted.emit("wk:nav-menu-activated", { menuId: "documents" });
      await flushUpdates();
    });
    expect(hoisted.load).toHaveBeenCalledTimes(2);
  });

  it("stops reloading after the consumer unmounts", async () => {
    await renderProbe();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    const loadCalls = hoisted.load.mock.calls.length;

    await act(async () => {
      hoisted.emit("wk:nav-menu-activated", { menuId: "documents" });
      await flushUpdates();
    });

    expect(hoisted.load).toHaveBeenCalledTimes(loadCalls);
    expect(hoisted.off).toHaveBeenCalledWith(
      "wk:nav-menu-activated",
      expect.any(Function)
    );
  });
});
