// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  getDraft: vi.fn(),
  getInstruction: vi.fn(),
  getDependencies: vi.fn(),
  adoptUpdates: vi.fn(),
  skipUpdates: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock("@octo/base", () => ({
  t: (k: string) => k,
  useI18n: () => undefined,
  WKApp: { mittBus: { on: vi.fn(), off: vi.fn() } },
  WKInput: ({ value, onChange }: any) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  WKButton: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  WKModal: ({ children, footer, title, onCancel }: any) => (
    <section>
      {title === "skillMarket.publication.reconcileTitle" && <button onClick={onCancel}>Dismiss comparison</button>}
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("@dmwork/skillmarket/src/Service/PublicationService", () => ({
  PublicationService: api,
}));
vi.mock("../../ui/PublicationEditor", () => ({
  PublicationEditorFields: ({ onShowUpdates, onRetry, error }: any) => (
    <><button onClick={onShowUpdates}>View updates</button>{error && <p>{error}</p>}<button onClick={onRetry}>Retry editor</button></>
  ),
}));
import { WKApp } from "@octo/base";
import { PublicationEditor } from "./PublicationEditor";
import { DependencyUpdateFlow } from "./DependencyUpdateFlow";
let container: HTMLDivElement;
const updates = [
  {
    plugin_id: "skill",
    name: "Skill",
    from_version: "1.0.0",
    from_version_id: "s1",
    target_version: "1.1.0",
    target_version_id: "s2",
    is_skipped: false,
  },
];
const draft: any = {
  expected_draft_revision: "original",
  changelog: "Edited notes",
  plugin: {
    plugin_id: "expert",
    plugin_type: "expert",
    version: "1.0.1",
    manifest_json: { description: "Unsaved edit" },
  },
  relations: [
    {
      relation_id: "r",
      target_plugin_id: "skill",
      target_version_id: "s1",
      relation_type: "expert_skill",
      sort_order: 0,
    },
  ],
};
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getUpdates.mockResolvedValue({
    plugin_id: "expert",
    published_version_id: "e1",
    draft_revision: "current",
    updates,
  });
  api.adoptUpdates.mockResolvedValue({ display_status: "pending_review" });
  api.skipUpdates.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});
const mount = async (extra: any = {}) => {
  const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), ...extra };
  await act(async () =>
    ReactDOM.render(
      <DependencyUpdateFlow pluginId="expert" draft={draft} {...callbacks} />,
      container
    )
  );
  return callbacks;
};
const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
};
it("shows exact from/to labels and submits current unsaved edits with chosen pins", async () => {
  const cb = await mount();
  expect(container.textContent).toContain("v1.0.0 → v1.1.0");
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledWith(
    expect.any(String),
    "expert",
    expect.any(Object),
    expect.objectContaining({
      expected_draft_revision: "original",
      plugin: expect.objectContaining({
        manifest_json: { description: "Unsaved edit" },
      }),
      relations: [
        expect.objectContaining({ target_version_id: "s2", relation_id: "r" }),
      ],
    }),
    updates
  );
  expect(cb.onSaved).toHaveBeenCalledWith("skillMarket.review.submittedToast");
});
it("shows a configuration change and preserves a connector relation without a pin", async () => {
  const connector = { plugin_id: "mcp", name: "Search", plugin_type: "connector", target_config_revision: "config-2", is_skipped: false };
  const relation = { relation_id: "r", relation_type: "expert_connector", target_plugin_id: "mcp", sort_order: 0 };
  api.getUpdates.mockResolvedValue({ plugin_id: "expert", published_version_id: "e1", draft_revision: "current", updates: [connector] });
  await mount({draft: {...draft, relations: [relation]}});
  expect(container.textContent).toContain("skillMarket.publication.connectorConfigChanged");
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledWith(expect.any(String), "expert", expect.any(Object), expect.objectContaining({ relations: [relation] }), [connector]);
});
it("skip never submits or changes the edited draft, and uses the skip callback", async () => {
  const onSkipped = vi.fn();
  const cb = await mount({ onSkipped });
  await click("skillMarket.publication.skip");
  expect(api.skipUpdates).toHaveBeenCalledWith(
    expect.any(String),
    "expert",
    updates
  );
  expect(api.adoptUpdates).not.toHaveBeenCalled();
  expect(draft.relations[0].target_version_id).toBe("s1");
  expect(onSkipped).toHaveBeenCalledOnce();
  expect(cb.onSaved).not.toHaveBeenCalled();
});
it("does not clear reminders merely by canceling", async () => {
  await mount();
  await click("skillMarket.common.cancel");
  expect(api.skipUpdates).not.toHaveBeenCalled();
  expect(api.adoptUpdates).not.toHaveBeenCalled();
});
it("keeps input after a failed atomic submit", async () => {
  api.adoptUpdates.mockRejectedValueOnce(new Error("stale target"));
  const cb = await mount();
  await act(async () =>
    Simulate.change(
      container.querySelectorAll('input:not([type="checkbox"])')[1],
      { target: { value: "Keep these notes" } } as any
    )
  );
  await click("skillMarket.publication.confirmUpdate");
  expect(container.textContent).toContain("skillMarket.form.saveFailed");
  expect(container.textContent).not.toContain("stale target");
  expect(
    (
      container.querySelectorAll(
        'input:not([type="checkbox"])'
      )[1] as HTMLInputElement
    ).value
  ).toBe("Keep these notes");
  expect(cb.onClose).not.toHaveBeenCalled();
});
it("allows view and skip during review without a submit button", async () => {
  await mount({ pending: true });
  expect(container.textContent).not.toContain(
    "skillMarket.publication.confirmUpdate"
  );
  await click("skillMarket.publication.skip");
  expect(api.skipUpdates).toHaveBeenCalled();
  expect(api.adoptUpdates).not.toHaveBeenCalled();
});
it("retains manual adoption for a skipped target", async () => {
  api.getUpdates.mockResolvedValue({
    plugin_id: "expert",
    published_version_id: "e1",
    draft_revision: "current",
    updates: [{ ...updates[0], is_skipped: true }],
  });
  await mount();
  const checkbox = container.querySelector(
    'input[type="checkbox"]'
  ) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  await act(async () => {
    Simulate.change(checkbox, { target: { checked: true } } as any);
  });
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalled();
});
it("finishes adoption across an ordinary parent rerender", async () => {
  let complete!: (value: any) => void;
  api.adoptUpdates.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const cb = await mount();
  await click("skillMarket.publication.confirmUpdate");
  await mount({ ...cb, onClose: vi.fn() });
  await act(async () => {
    complete({ display_status: "published" });
  });
  expect(cb.onSaved).toHaveBeenCalled();
});

it("finishes adoption when the editor's initial reminder request completes during submission", async () => {
  let finishAlerts!: (value: unknown) => void;
  let finishAdoption!: (value: unknown) => void;
  api.getUpdates.mockImplementationOnce(() => new Promise(resolve => { finishAlerts = resolve; }));
  api.adoptUpdates.mockImplementationOnce(() => new Promise(resolve => { finishAdoption = resolve; }));
  api.getDraft.mockResolvedValue({
    draft_revision: "original", draft_changelog: "Notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", current_version: "1.0.1", published_version: "1.0.0" },
  });
  api.getInstruction.mockResolvedValue("Instructions");
  api.getDependencies.mockResolvedValue([]);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} onSaved={onSaved} onClose={onClose} onEditContent={vi.fn()} />, container);
  });
  await click("View updates");
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledOnce();
  await act(async () => { finishAlerts({ updates }); });
  expect(api.getUpdates).toHaveBeenCalledTimes(2);
  await act(async () => { finishAdoption({ display_status: "published" }); });
  expect(onSaved).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it("routes a delisted resource to editing instead of calling the published-only update endpoint", async () => {
  const edit = vi.fn();
  await mount({ listingState: "delisted", onEdit: edit });
  expect(api.getUpdates).not.toHaveBeenCalled();
  expect(container.textContent).toContain("skillMarket.publication.editBeforeUpdates");
  await click("skillMarket.publication.editResource");
  expect(edit).toHaveBeenCalledOnce();
});
it("explains a stale list state without showing the raw conflict message", async () => {
  api.getUpdates.mockRejectedValue({ status: 409, msg: "plugin state conflicts with an existing resource" });
  await mount();
  expect(container.textContent).toContain("skillMarket.publication.updatesConflict");
  expect(container.textContent).not.toContain("plugin state conflicts");
});

it("reloads a conflict while keeping version, notes and dependency choices", async () => {
  api.getUpdates.mockResolvedValue({ plugin_id: "expert", published_version_id: "e1", draft_revision: "original", updates: [...updates, { ...updates[0], plugin_id: "other", name: "Other" }] });
  api.adoptUpdates.mockRejectedValueOnce({ status: 409, msg: "stale target" });
  await mount();
  await act(async () => {
    Simulate.change(container.querySelectorAll('input:not([type="checkbox"])')[0], { target: { value: "1.0.2" } } as any);
    Simulate.change(container.querySelectorAll('input:not([type="checkbox"])')[1], { target: { value: "Keep my notes" } } as any);
    Simulate.change(container.querySelectorAll('input[type="checkbox"]')[1], { target: { checked: false } } as any);
  });
  await click("skillMarket.publication.confirmUpdate");
  await click("skillMarket.list.retry");
  expect(api.getUpdates).toHaveBeenCalledTimes(2);
  expect((container.querySelectorAll('input:not([type="checkbox"])')[0] as HTMLInputElement).value).toBe("1.0.2");
  expect((container.querySelectorAll('input:not([type="checkbox"])')[1] as HTMLInputElement).value).toBe("Keep my notes");
  expect((container.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked).toBe(false);
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledTimes(2);
  expect(api.adoptUpdates.mock.calls[1][3].expected_draft_revision).toBe("original");
});

it.each(["list", "editor"])("keeps a changed draft in explicit conflict after retry from %s", async (entry) => {
  api.getUpdates.mockResolvedValueOnce({
    published_version_id: "e1", draft_revision: "original", updates,
  }).mockResolvedValue({
    published_version_id: "e1", draft_revision: "new-revision", updates,
  });
  api.getDraft.mockResolvedValue({
    draft_revision: "original", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", current_version: "1.0.1" },
  });
  api.getInstruction.mockResolvedValue("Instructions");
  api.adoptUpdates.mockRejectedValueOnce({ status: 409 });
  const edit = vi.fn();
  await mount({ draft: entry === "editor" ? draft : undefined, onEdit: edit });
  await click("skillMarket.publication.confirmUpdate");
  api.getDraft.mockResolvedValue({
    draft_revision: "new-revision", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Concurrent edit", current_version: "1.0.1" },
  });
  await click("skillMarket.list.retry");
  expect(container.textContent).toContain("skillMarket.publication.draftConflict");
  const confirm = Array.from(container.querySelectorAll("button")).find(
    button => button.textContent === "skillMarket.publication.confirmUpdate"
  )!;
  expect(confirm.disabled).toBe(true);
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledOnce();
  await click("skillMarket.publication.editResource");
  expect(edit).toHaveBeenCalledOnce();
});

it("submits after correcting a locally invalid version without reloading", async () => {
  await mount();
  const input = () => container.querySelectorAll('input:not([type="checkbox"])')[0];
  await act(async () => { Simulate.change(input(), { target: { value: "invalid" } } as any); });
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).not.toHaveBeenCalled();
  await act(async () => { Simulate.change(input(), { target: { value: "1.0.2" } } as any); });
  await click("skillMarket.publication.confirmUpdate");
  expect(api.adoptUpdates).toHaveBeenCalledOnce();
  expect(api.getUpdates).toHaveBeenCalledOnce();
});

it("reconciles the actual parent editor with the latest draft before saving preserved inputs", async () => {
  const original = {
    draft_revision: "original", draft_changelog: "Notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", listing_state: "published", current_version: "1.0.1", published_version: "1.0.0" },
  };
  const latest = { ...original, draft_revision: "latest", plugin: { ...original.plugin, manifest_json: { description: "Concurrent description", extra: "keep remote metadata" } } };
  api.getDraft.mockResolvedValueOnce(original).mockResolvedValue(latest);
  api.getDependencies.mockResolvedValue([]);
  api.getInstruction.mockResolvedValue("Instructions");
  api.getUpdates.mockResolvedValueOnce({ published_version_id: "e1", draft_revision: "original", updates })
    .mockResolvedValue({ published_version_id: "e1", draft_revision: "latest", updates });
  api.adoptUpdates.mockRejectedValueOnce({ status: 409 });
  api.saveDraft.mockResolvedValue({ ...latest, draft_revision: "saved" });
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} onSaved={vi.fn()} onClose={vi.fn()} onEditContent={vi.fn()} />, container);
  });
  await click("View updates");
  const inputs = container.querySelectorAll('input:not([type="checkbox"])');
  await act(async () => {
    Simulate.change(inputs[0], { target: { value: "1.0.2" } } as any);
    Simulate.change(inputs[1], { target: { value: "Preserved update notes" } } as any);
  });
  await click("skillMarket.publication.confirmUpdate");
  await click("skillMarket.list.retry");
  await click("skillMarket.publication.editResource");
  expect(api.getDraft).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Concurrent description");
  expect(container.textContent).toContain("Preserved update notes");
  await click("skillMarket.plugin.actionSaveDraft");
  expect(api.saveDraft).not.toHaveBeenCalled();
  await click("skillMarket.publication.keepLocal");
  await click("skillMarket.plugin.actionSaveDraft");
  expect(api.saveDraft).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    expected_draft_revision: "latest", changelog: "Preserved update notes",
    plugin: expect.objectContaining({ version: "1.0.2", manifest_json: expect.objectContaining({ extra: "keep remote metadata", description: "Unsaved edit" }) }),
    relations: [expect.objectContaining({ target_version_id: "s2" })],
  }));
});

it("reports uninitialized recovery inputs as null instead of cleared values", async () => {
  api.getUpdates.mockRejectedValueOnce({ status: 500 });
  const edit = vi.fn();
  await mount({ draft: undefined, onEdit: edit });
  expect(container.textContent).toContain("skillMarket.common.loadFailed");
  await click("skillMarket.publication.editResource");
  expect(edit).toHaveBeenCalledWith({ version: null, changelog: null, versions: {} });
});

it("keeps the selected target versions when the retry reload fails", async () => {
  api.getUpdates
    .mockResolvedValueOnce({ plugin_id: "expert", published_version_id: "e1", draft_revision: "original", updates })
    .mockRejectedValueOnce({ status: 500 });
  api.getDraft.mockResolvedValue({
    expected_draft_revision: "original", draft_changelog: "Notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", current_version: "1.0.1", published_version: "1.0.0" },
  });
  api.getInstruction.mockResolvedValue("Instructions");
  api.adoptUpdates.mockRejectedValueOnce({ status: 409 });
  const edit = vi.fn();
  await mount({ draft: undefined, onEdit: edit });
  await click("skillMarket.publication.confirmUpdate");
  await click("skillMarket.list.retry");
  expect(container.textContent).toContain("skillMarket.common.loadFailed");
  await click("skillMarket.publication.editResource");
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ versions: { skill: "s2" } }));
});

it.each(["initial-load", "reload"])("preserves parent inputs through %s failure and reconciliation", async failure => {
  const value = {
    draft_revision: "original", draft_changelog: "Parent notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", current_version: "1.0.1", published_version: "1.0.0" },
  };
  api.getDraft.mockResolvedValue(value);
  api.getDependencies.mockResolvedValue([]);
  api.getInstruction.mockResolvedValue("Instructions");
  if (failure === "initial-load") api.getUpdates.mockRejectedValue(new Error("unavailable"));
  else {
    api.getUpdates.mockResolvedValueOnce({ updates })
      .mockResolvedValueOnce({ updates, draft_revision: "original" })
      .mockRejectedValue(new Error("reload unavailable"));
  }
  api.adoptUpdates.mockRejectedValueOnce({ status: 409 });
  api.saveDraft.mockResolvedValue(value);
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} onSaved={vi.fn()} onClose={vi.fn()} onEditContent={vi.fn()} />, container);
  });
  await click("View updates");
  if (failure === "reload") {
    await act(async () => {
      Simulate.change(container.querySelectorAll('input:not([type="checkbox"])')[1], { target: { value: "Updated recovery notes" } } as any);
    });
    await click("skillMarket.publication.confirmUpdate");
    await click("skillMarket.list.retry");
  }
  await click("skillMarket.publication.editResource");
  expect(container.textContent).toContain("Parent notes");
  await click("skillMarket.publication.keepLocal");
  await click("skillMarket.plugin.actionSaveDraft");
  const payload = api.saveDraft.mock.calls[0][1];
  expect(payload.plugin.version).toBe("1.0.1");
  expect(payload.changelog).toBe(failure === "reload" ? "Updated recovery notes" : "Parent notes");
  expect(payload.relations[0].target_version_id).toBe(failure === "reload" ? "s2" : "s1");
});

it("reconciles recovery passed by a list with the freshly loaded editor draft", async () => {
  const value = {
    draft_revision: "latest", draft_changelog: "Server notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", current_version: "1.0.1", published_version: "1.0.0" },
  };
  api.getDraft.mockResolvedValue(value);
  api.getDependencies.mockResolvedValue([]);
  api.getInstruction.mockResolvedValue("Instructions");
  api.saveDraft.mockResolvedValue(value);
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} recovery={{ version: "1.0.3", changelog: "List notes", versions: { skill: "s2" } }} onSaved={vi.fn()} onClose={vi.fn()} onEditContent={vi.fn()} />, container);
  });
  expect(container.textContent).toContain("List notes");
  await click("skillMarket.publication.keepLocal");
  await click("skillMarket.plugin.actionSaveDraft");
  expect(api.saveDraft.mock.calls[0][1]).toMatchObject({
    expected_draft_revision: "latest", changelog: "List notes", plugin: { version: "1.0.3" },
    relations: [expect.objectContaining({ target_version_id: "s2" })],
  });
});

it.each(["delayed", "failed"])("keeps list recovery safe during %s draft initialization", async mode => {
  const value = {
    draft_revision: "latest", draft_changelog: "Server notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", current_version: "1.0.1", published_version: "1.0.0" },
  };
  const recovery = { version: "1.0.9", changelog: "Retained list notes", versions: { skill: "s2" } };
  let complete!: (value: any) => void;
  api.getDraft.mockResolvedValue(value);
  if (mode === "failed") api.getDependencies.mockRejectedValueOnce(new Error("read failed")).mockResolvedValue([]);
  else api.getDependencies.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  api.getInstruction.mockResolvedValue("Instructions");
  api.saveDraft.mockResolvedValue(value);
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} recovery={recovery} onSaved={vi.fn()} onClose={vi.fn()} onEditContent={vi.fn()} />, container);
  });
  await click("skillMarket.plugin.actionSaveDraft");
  await click("skillMarket.publication.publishNewVersion");
  expect(api.saveDraft).not.toHaveBeenCalled();
  if (mode === "failed") {
    expect(container.textContent).toContain("skillMarket.common.loadFailed");
    // The mock field component exposes the editor's normal retry action.
    await click("Retry editor");
  } else await act(async () => complete([]));
  expect(container.textContent).toContain("Retained list notes");
  expect(api.getDraft).toHaveBeenCalledTimes(mode === "failed" ? 2 : 1);
  await click("skillMarket.publication.keepLocal");
  await click("skillMarket.plugin.actionSaveDraft");
  expect(api.saveDraft.mock.calls[0][1]).toMatchObject({
    expected_draft_revision: "latest", changelog: "Retained list notes", plugin: { version: "1.0.9" },
    relations: [expect.objectContaining({ target_version_id: "s2" })],
  });
});

it.each(["resolve", "reject"])("ignores stale recovery %s after Space navigation", async outcome => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve, reject) => {
    finish = outcome === "resolve" ? resolve : () => reject(new Error("late failure"));
  });
  api.getUpdates.mockRejectedValue(new Error("load failed"));
  const cb = await mount({ onEdit: () => pending });
  await click("skillMarket.publication.editResource");
  const spaceChange = vi.mocked(WKApp.mittBus.on).mock.calls.filter(call => call[0] === "space-changed").pop()![1] as () => void;
  act(() => spaceChange());
  expect(cb.onClose).toHaveBeenCalledOnce();
  await act(async () => {
    ReactDOM.render(<DependencyUpdateFlow key="replacement" pluginId="new-expert" draft={draft} onClose={cb.onClose} onSaved={vi.fn()} />, container);
  });
  await act(async () => finish());
  expect(cb.onClose).toHaveBeenCalledOnce();
});

it.each(["resolve", "reject"])("blocks Retry during pending edit recovery until it %s", async outcome => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve, reject) => {
    finish = outcome === "resolve" ? resolve : () => reject(new Error("edit failed"));
  });
  api.adoptUpdates.mockRejectedValueOnce({ status: 409 });
  const cb = await mount({ onEdit: () => pending });
  await click("skillMarket.publication.confirmUpdate");
  await click("skillMarket.publication.editResource");
  const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "skillMarket.list.retry")!;
  expect(retry.disabled).toBe(true);
  await act(async () => retry.click());
  expect(api.getUpdates).toHaveBeenCalledOnce();
  await act(async () => finish());
  if (outcome === "resolve") expect(cb.onClose).toHaveBeenCalledOnce();
  else {
    expect(cb.onClose).not.toHaveBeenCalled();
    const cancel = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "skillMarket.common.cancel")!;
    expect(cancel.disabled).toBe(false);
    expect(retry.disabled).toBe(false);
    await click("skillMarket.list.retry");
    expect(api.getUpdates).toHaveBeenCalledTimes(2);
  }
});

it("abandons list recovery on comparison dismissal without accepting local edits", async () => {
  const value = {
    draft_revision: "latest", draft_changelog: "Server notes", relations: draft.relations,
    plugin: { ...draft.plugin, plugin_name: "Expert", visibility: "space", current_version: "1.0.1", published_version: "1.0.0" },
  };
  api.getDraft.mockResolvedValue(value);
  api.getDependencies.mockResolvedValue([]);
  api.getInstruction.mockResolvedValue("Instructions");
  const close = vi.fn();
  await act(async () => {
    ReactDOM.render(<PublicationEditor item={{ id: "expert" } as any} recovery={{ version: "1.0.9", changelog: "Local notes", versions: { skill: "s2" } }} onSaved={vi.fn()} onClose={close} onEditContent={vi.fn()} />, container);
  });
  await click("Dismiss comparison");
  expect(close).toHaveBeenCalledOnce();
  // Even before the owner unmounts the editor, dismissal must not accept
  // the local payload or release the explicit reconciliation save blocker.
  await click("skillMarket.plugin.actionSaveDraft");
  expect(api.saveDraft).not.toHaveBeenCalled();
});
