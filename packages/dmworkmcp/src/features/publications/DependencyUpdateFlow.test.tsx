// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({
  getUpdates: vi.fn(),
  getDraft: vi.fn(),
  getInstruction: vi.fn(),
  adoptUpdates: vi.fn(),
  skipUpdates: vi.fn(),
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
  WKModal: ({ children, footer }: any) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("@dmwork/skillmarket/src/Service/PublicationService", () => ({
  PublicationService: api,
}));
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
  expect(container.textContent).toContain("stale target");
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
