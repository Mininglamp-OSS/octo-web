// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getSkill: vi.fn(),
  fetchMcpDetail: vi.fn(),
  getExpert: vi.fn(),
  getSquad: vi.fn(),
  loadExpertReviewSnapshot: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

const skill = {
  id: "skill-1",
  name: "Skill one",
  listingState: "draft",
  visibility: "private",
  displayStatus: "draft",
};
const connector = {
  id: "connector-1",
  name: "Connector one",
  listingState: "published",
  visibility: "space",
  displayStatus: "published",
};
const expert = {
  id: "expert-1",
  name: "Expert one",
  kind: "agent",
  version: "1.0.0",
};
const squad = {
  id: "squad-1",
  name: "Squad one",
  kind: "squad",
  version: "1.0.0",
};

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: {
    error: h.toastError,
    success: h.toastSuccess,
    warning: h.toastWarning,
  },
}));

vi.mock("@dmwork/skillmarket", () => ({
  getCategories: (...args: unknown[]) => h.getCategories(...args),
  getSkill: (...args: unknown[]) => h.getSkill(...args),
  SkillDetailModal: ({
    skillId,
    onEdit,
    onDelete,
  }: {
    skillId: string | null;
    onEdit?: (item: typeof skill) => void;
    onDelete?: (item: typeof skill) => void;
  }) =>
    skillId ? (
      <div data-testid="skill-detail" data-id={skillId}>
        <button type="button" onClick={() => onEdit?.(skill)}>
          detail-edit
        </button>
        <button type="button" onClick={() => onDelete?.(skill)}>
          detail-delete
        </button>
      </div>
    ) : null,
  EditSkillModal: ({ skill: item }: { skill: typeof skill | null }) =>
    item ? <div data-testid="skill-edit" data-id={item.id} /> : null,
  NewSkillModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="skill-upgrade" /> : null,
  DeleteConfirmModal: ({ skill: item }: { skill: typeof skill | null }) =>
    item ? <div data-testid="skill-delete" data-id={item.id} /> : null,
}));

vi.mock("../../api/mcpService", () => ({
  fetchMcpDetail: (...args: unknown[]) => h.fetchMcpDetail(...args),
}));

vi.mock("../../api/expertService", () => ({
  getExpert: (...args: unknown[]) => h.getExpert(...args),
  getSquad: (...args: unknown[]) => h.getSquad(...args),
  loadExpertReviewSnapshot: (...args: unknown[]) =>
    h.loadExpertReviewSnapshot(...args),
}));

vi.mock("../../components/McpCreateModal", () => ({
  default: ({
    visible,
    editing,
    reviewMode,
    onSaved,
    onPublished,
  }: {
    visible: boolean;
    editing: typeof connector | null;
    reviewMode: boolean;
    onSaved: () => void;
    onPublished: () => void;
  }) =>
    visible ? (
      <div
        data-testid="connector-form"
        data-id={editing?.id}
        data-review={String(reviewMode)}
      >
        <button
          type="button"
          onClick={() => {
            onSaved();
            onPublished();
          }}
        >
          connector-saved
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/McpDetailModal", () => ({
  default: ({
    mcpId,
    canManage,
    onEdit,
  }: {
    mcpId: string | null;
    canManage?: boolean;
    onEdit?: (item: typeof connector) => void;
  }) =>
    mcpId ? (
      <div
        data-testid="connector-detail"
        data-id={mcpId}
        data-manage={String(canManage)}
      >
        <button type="button" onClick={() => onEdit?.(connector)}>
          connector-detail-edit
        </button>
      </div>
    ) : null,
}));

vi.mock("../../components/ExpertEditModal", () => ({
  default: ({ item }: { item: typeof expert | null }) =>
    item ? <div data-testid="expert-edit" data-id={item.id} /> : null,
}));
vi.mock("../../components/ExpertDetailModal", () => ({
  default: ({ item }: { item: typeof expert | typeof squad | null }) =>
    item ? <div data-testid="expert-detail" data-id={item.id} /> : null,
}));
vi.mock("../../components/ExpertBotPublishModal", () => ({
  default: () => null,
}));
vi.mock("../../components/ReviewSubmitModal", () => ({
  default: ({ target }: { target: { pluginId: string } | null }) =>
    target ? (
      <div data-testid="review-submit" data-id={target.pluginId} />
    ) : null,
}));

import MineActionHost from "./MineActionHost";
import type { MineActionRequest } from "@dmwork/skillmarket";

let container: HTMLDivElement;

function renderHost(
  request: MineActionRequest | null,
  onClose = vi.fn(),
  onChanged = vi.fn()
) {
  act(() => {
    ReactDOM.render(
      <MineActionHost
        request={request}
        onClose={onClose}
        onChanged={onChanged}
      />,
      container
    );
  });
  return { onClose, onChanged };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.clearAllMocks();
  h.getCategories.mockResolvedValue([]);
  h.getSkill.mockResolvedValue(skill);
  h.fetchMcpDetail.mockResolvedValue(connector);
  h.getExpert.mockResolvedValue(expert);
  h.getSquad.mockResolvedValue(squad);
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
});

describe("MineActionHost", () => {
  it("opens each owning flow over the all tab", async () => {
    renderHost({
      requestId: 1,
      pluginId: skill.id,
      type: "skill",
      action: "view",
    });
    await act(async () => undefined);
    expect(
      container
        .querySelector('[data-testid="skill-detail"]')
        ?.getAttribute("data-id")
    ).toBe(skill.id);

    renderHost({
      requestId: 2,
      pluginId: connector.id,
      type: "connector",
      action: "upgrade",
    });
    await act(async () => undefined);
    expect(
      container
        .querySelector('[data-testid="connector-form"]')
        ?.getAttribute("data-review")
    ).toBe("true");

    renderHost({
      requestId: 3,
      pluginId: expert.id,
      type: "expert",
      action: "edit",
    });
    await act(async () => undefined);
    expect(
      container
        .querySelector('[data-testid="expert-edit"]')
        ?.getAttribute("data-id")
    ).toBe(expert.id);

    renderHost({
      requestId: 4,
      pluginId: squad.id,
      type: "squad",
      action: "upgrade",
    });
    await act(async () => undefined);
    expect(
      container
        .querySelector('[data-testid="review-submit"]')
        ?.getAttribute("data-id")
    ).toBe(squad.id);
  });

  it("keeps owner actions in skill and connector details", async () => {
    renderHost({
      requestId: 1,
      pluginId: skill.id,
      type: "skill",
      action: "view",
    });
    await act(async () => undefined);
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(
      container.querySelector('[data-testid="skill-edit"]')
    ).not.toBeNull();

    renderHost({
      requestId: 2,
      pluginId: connector.id,
      type: "connector",
      action: "view",
    });
    await act(async () => undefined);
    expect(
      container
        .querySelector('[data-testid="connector-detail"]')
        ?.getAttribute("data-manage")
    ).toBe("true");
    act(() => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "connector-detail-edit"
      ) as HTMLButtonElement;
      button.click();
    });
    expect(
      container
        .querySelector('[data-testid="connector-form"]')
        ?.getAttribute("data-review")
    ).toBe("true");
  });

  it("ignores a stale load after a newer action replaces it", async () => {
    let resolveSkill: (value: typeof skill) => void = () => {};
    h.getSkill.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSkill = resolve;
      })
    );
    renderHost({
      requestId: 1,
      pluginId: skill.id,
      type: "skill",
      action: "edit",
    });

    renderHost({
      requestId: 2,
      pluginId: connector.id,
      type: "connector",
      action: "view",
    });
    expect(
      container.querySelector('[data-testid="connector-detail"]')
    ).not.toBeNull();
    await act(async () => resolveSkill(skill));

    expect(container.querySelector('[data-testid="skill-edit"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="connector-detail"]')
    ).not.toBeNull();
  });

  it("refreshes the all list only once when a modal reports multiple success callbacks", async () => {
    const onChanged = vi.fn();
    renderHost(
      {
        requestId: 1,
        pluginId: connector.id,
        type: "connector",
        action: "edit",
      },
      vi.fn(),
      onChanged
    );
    await act(async () => undefined);
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reports a load failure and closes the pending action", async () => {
    const onClose = vi.fn();
    h.getExpert.mockRejectedValueOnce(new Error("load failed"));

    renderHost(
      { requestId: 1, pluginId: expert.id, type: "expert", action: "edit" },
      onClose
    );
    await act(async () => undefined);

    expect(h.toastError).toHaveBeenCalledWith("load failed");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="expert-edit"]')).toBeNull();
  });
});
