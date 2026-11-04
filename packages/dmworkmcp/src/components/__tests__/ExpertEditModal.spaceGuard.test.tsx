// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  getDraft: vi.fn(),
  getDependencies: vi.fn(),
  getInstruction: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
}));
const handlers: Record<string, Array<() => void>> = {};
// The editor uses the shared Semi Select. Native rendering keeps these
// service/space lifecycle tests independent of Semi's canvas animation runtime.
vi.mock("@douyinfe/semi-ui", () => ({
  Select: ({ value, onChange, optionList, disabled, "aria-label": label }: any) => (
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
      {optionList.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  WKApp: {
    mittBus: {
      on: (name: string, fn: () => void) => {
        (handlers[name] ??= []).push(fn);
      },
      off: (name: string, fn: () => void) => {
        handlers[name] = (handlers[name] ?? []).filter((x) => x !== fn);
      },
    },
  },
  WKInput: ({ value, onChange, ...props }: any) => (
    <input
      {...props}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  WKButton: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  WKModal: ({ visible, children, footer }: any) =>
    visible ? (
      <section>
        {children}
        {footer}
      </section>
    ) : null,
}));
vi.mock("@dmwork/skillmarket/src/Service/PublicationService", () => ({
  PublicationService: api,
}));
vi.mock("../../features/publications/DependencyUpdateFlow", () => ({
  DependencyUpdateFlow: () => null,
}));
import ExpertEditModal from "../ExpertEditModal";
const item = {
  id: "expert",
  name: "Expert",
  kind: "agent",
  visibility: "space",
  version: "1.0.0",
  listingState: "published",
  displayStatus: "published",
} as any;
const makeDraft = () => ({
  draft_revision: "a".repeat(64),
  plugin: {
    plugin_id: "expert",
    plugin_name: "Expert",
    plugin_type: "expert",
    visibility: "space",
    current_version: "1.0.0",
    published_version: "1.0.0",
    published_version_id: "released",
    listing_state: "published",
    manifest_json: { plugin_name: "Expert", description: "Description" },
    plugin_json: {
      attachments: [
        { path: "AGENTS.md", content_type: "raw", raw_content: "Instructions" },
      ],
    },
    tags: [],
  },
  relations: [],
});
let container: HTMLDivElement;
const click = async (label: string) => {
  const b = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
  expect(b).toBeTruthy();
  await act(async () => {
    b!.click();
  });
};
const edit = async (index: number, value: string) => {
  const input = container.querySelectorAll("input")[index];
  await act(async () => {
    Simulate.change(input, { target: { value } } as any);
  });
};
const mount = async (props: any = {}) => {
  const callbacks = {
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onEditContent: vi.fn(),
    ...props,
  };
  await act(async () => {
    ReactDOM.render(<ExpertEditModal item={item} {...callbacks} />, container);
  });
  return callbacks;
};
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  api.getUpdates.mockResolvedValue({ updates: [] });
  api.getDraft.mockResolvedValue(makeDraft());
  api.getDependencies.mockResolvedValue([]);
  api.getInstruction.mockResolvedValue("Instructions");
  api.saveDraft.mockImplementation(async (_base, payload) => ({
    ...makeDraft(),
    draft_revision: "b".repeat(64),
    plugin: {
      ...makeDraft().plugin,
      ...payload.plugin,
      current_version: payload.plugin.version,
    },
    relations: payload.relations,
  }));
  api.publishDraft.mockResolvedValue({ display_status: "published" });
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});
describe("unified expert editor", () => {
  it.each(["private", "space"])(
    "offers draft save and publication for %s resources",
    async (visibility) => {
      api.getDraft.mockResolvedValue({
        ...makeDraft(),
        plugin: { ...makeDraft().plugin, visibility },
      });
      await mount();
      expect(container.textContent).toContain(
        "skillMarket.plugin.actionSaveDraft"
      );
      expect(container.textContent).toContain(
        "skillMarket.publication.publishNewVersion"
      );
      expect(container.querySelectorAll("textarea")).toHaveLength(2);
      expect(container.querySelectorAll("input")[1].value).toBe("1.0.1");
    }
  );
  it("saves description and instructions without changing original release", async () => {
    const callbacks = await mount();
    const textareas = container.querySelectorAll("textarea");
    await act(async () => {
      Simulate.change(textareas[0], {
        target: { value: "Edited description" },
      } as any);
      Simulate.change(textareas[1], {
        target: { value: "Edited instructions" },
      } as any);
    });
    await click("skillMarket.plugin.actionSaveDraft");
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        expected_draft_revision: "a".repeat(64),
        plugin: expect.objectContaining({
          manifest_json: expect.objectContaining({
            description: "Edited description",
          }),
          plugin_json: expect.objectContaining({
            attachments: expect.arrayContaining([
              expect.objectContaining({ raw_content: "Edited instructions" }),
            ]),
          }),
        }),
      })
    );
    expect(api.publishDraft).not.toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it("conditionally publishes the saved revision", async () => {
    await mount();
    await edit(2, "Release notes");
    await click("skillMarket.publication.publishNewVersion");
    expect(api.publishDraft).toHaveBeenCalledWith(
      expect.any(String),
      "expert",
      "1.0.1",
      "Release notes",
      "b".repeat(64)
    );
  });
  it("retains input and does not publish after a save conflict", async () => {
    api.saveDraft.mockRejectedValueOnce({ status: 409, msg: "conflict" });
    const callbacks = await mount();
    await edit(0, "Edited");
    await edit(2, "Notes");
    await click("skillMarket.publication.publishNewVersion");
    expect(container.textContent).toContain("skillMarket.publication.updatesConflict");
    expect(container.querySelector("input")!.value).toBe("Edited");
    expect(api.publishDraft).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });
  it("retains the committed draft and input when publication fails", async () => {
    api.publishDraft.mockRejectedValueOnce(new Error("publication failed"));
    const callbacks = await mount();
    await edit(2, "Notes");
    await click("skillMarket.publication.publishNewVersion");
    expect(container.textContent).toContain("skillMarket.form.saveFailed");
    expect(callbacks.onClose).not.toHaveBeenCalled();
    await click("skillMarket.publication.publishNewVersion");
    expect(api.saveDraft.mock.calls[1][1].expected_draft_revision).toBe(
      "b".repeat(64)
    );
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it("saves the current draft before opening the original Bot chooser", async () => {
    const callbacks = await mount();
    await edit(0, "Before Bot");
    await click("mcp.expert.botUpdateTitleAgent");
    expect(api.saveDraft).toHaveBeenCalled();
    expect(callbacks.onEditContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "expert", draftRevision: "b".repeat(64) })
    );
    expect(api.publishDraft).not.toHaveBeenCalled();
  });
  it("does not open the Bot chooser if saving fails", async () => {
    api.saveDraft.mockRejectedValueOnce(new Error("save failed"));
    const callbacks = await mount();
    await click("mcp.expert.botUpdateTitleAgent");
    expect(callbacks.onEditContent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("skillMarket.form.saveFailed");
  });
  it("ignores a save settling after a Space switch", async () => {
    let resolve: (value: any) => void = () => {};
    api.saveDraft.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const callbacks = await mount();
    await click("skillMarket.plugin.actionSaveDraft");
    await act(async () => {
      handlers["space-changed"].forEach((fn) => fn());
      resolve({ ...makeDraft(), draft_revision: "b".repeat(64) });
    });
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(api.publishDraft).not.toHaveBeenCalled();
  });
  it("ignores a stale load after switching resources", async () => {
    let resolve: (value: any) => void = () => {};
    api.getDraft.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const callbacks = await mount();
    await act(async () => {
      ReactDOM.render(
        <ExpertEditModal
          item={{ ...item, id: "next", name: "Next" }}
          {...callbacks}
        />,
        container
      );
    });
    await act(async () => {
      resolve({
        ...makeDraft(),
        plugin: { ...makeDraft().plugin, plugin_name: "Stale" },
      });
    });
    expect(container.querySelector("input")!.value).not.toBe("Stale");
  });
  it("blocks editing and publication while a review is pending", async () => {
    await mount({ item: { ...item, displayStatus: "pending_review" } });
    expect(
      Array.from(container.querySelectorAll("input")).every((i) => i.disabled)
    ).toBe(true);
    expect(container.textContent).toContain(
      "skillMarket.publication.viewUpdates"
    );
  });
  it("keeps connectors without a version selector", async () => {
    api.getDependencies.mockResolvedValue([
      { id: "connector", name: "Connector", type: "connector", versions: [] },
    ]);
    await mount();
    expect(container.textContent).toContain(
      "skillMarket.publication.connectorCurrent"
    );
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
  it("finishes saving when a parent rerenders with a fresh close callback", async () => {
    let complete!: (value: any) => void;
    api.saveDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const callbacks = await mount();
    await click("skillMarket.plugin.actionSaveDraft");
    await mount({ ...callbacks, onClose: vi.fn() });
    await act(async () => {
      complete(makeDraft());
    });
    expect(callbacks.onSaved).toHaveBeenCalled();
  });

  it("shows current dependency reasons from the draft even when the original item has no diagnostics", async () => {
    api.getDraft.mockResolvedValueOnce({ ...makeDraft(), dependency_issues: [{ target_plugin_id: "skill", target_name: "内容创作规范", relation_type: "expert_skill", reason: "delisted" }] });
    await mount();
    expect(container.textContent).toContain("内容创作规范");
    expect(container.textContent).toContain("skillMarket.plugin.dependencyIssue.delisted");
  });

  it("keeps own fields editable and the Bot handoff usable with an unavailable dependency", async () => {
    api.getDependencies.mockResolvedValueOnce([
      {
        id: "hidden",
        name: "",
        type: "skill",
        current: "old",
        versions: [],
        unavailable: true,
      },
    ]);
    const cb = await mount();
    expect(container.textContent).toContain(
      "skillMarket.publication.unavailableDependency"
    );
    await edit(0, "Repair draft");
    await click("mcp.expert.botUpdateTitleAgent");
    expect(api.saveDraft).toHaveBeenCalled();
    expect(cb.onEditContent).toHaveBeenCalled();
  });
});

it.each(["draft", "delisted"])("does not query published-only updates while editing %s", async listing_state => {
  api.getDraft.mockResolvedValue({ ...makeDraft(), plugin: {
    ...makeDraft().plugin, listing_state, published_version_id: listing_state === "draft" ? undefined : "released",
  } });
  await mount();
  expect(api.getUpdates).not.toHaveBeenCalled();
  expect(container.textContent).toContain("skillMarket.plugin.actionSaveDraft");
});
it("queries updates for a published baseline", async () => {
  await mount();
  expect(api.getUpdates).toHaveBeenCalledOnce();
});
