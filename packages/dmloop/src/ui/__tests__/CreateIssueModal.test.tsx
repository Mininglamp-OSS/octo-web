/**
 * @vitest-environment jsdom
 */
import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createIssue: vi.fn().mockResolvedValue({ id: "issue-1" }),
  listAssigneeCandidates: vi.fn().mockResolvedValue([]),
  listProjectOptions: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn(),
  attachLabel: vi.fn(),
  listLabels: vi.fn().mockResolvedValue([]),
  onClose: vi.fn(),
  onCreated: vi.fn(),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@douyinfe/semi-ui", () => {
  const Modal = ({ visible, children }: any) =>
    visible ? <div>{children}</div> : null;
  const Select: any = ({ children }: any) => <div>{children}</div>;
  Select.Option = ({ children }: any) => <>{children}</>;
  return {
    Modal,
    Select,
    Avatar: ({ children }: any) => <span>{children}</span>,
    Toast: { error: vi.fn() },
  };
});

vi.mock("../../api/issueApi", () => ({
  createIssue: (...args: any[]) => hoisted.createIssue(...args),
  listAssigneeCandidates: (...args: any[]) =>
    hoisted.listAssigneeCandidates(...args),
}));

vi.mock("../../api/directory", () => ({
  listProjectOptions: (...args: any[]) => hoisted.listProjectOptions(...args),
}));

vi.mock("../../api/attachmentApi", () => ({
  uploadAttachment: (...args: any[]) => hoisted.uploadAttachment(...args),
}));

vi.mock("../../api/labelApi", () => ({
  attachLabel: (...args: any[]) => hoisted.attachLabel(...args),
  listLabels: (...args: any[]) => hoisted.listLabels(...args),
}));

vi.mock("../../api/http", () => ({
  currentWorkspaceName: () => "workspace",
}));

vi.mock("../AssigneePicker", () => ({
  default: () => <div data-testid="assignee-picker" />,
}));

vi.mock("../LoopPropertyPill", () => ({
  default: () => <button type="button" data-testid="property-pill" />,
}));

import CreateIssueModal from "../CreateIssueModal";

let container: HTMLDivElement;

beforeEach(() => {
  hoisted.createIssue.mockReset().mockResolvedValue({ id: "issue-1" });
  hoisted.listAssigneeCandidates.mockReset().mockResolvedValue([]);
  hoisted.listProjectOptions.mockReset().mockResolvedValue([]);
  hoisted.listLabels.mockReset().mockResolvedValue([]);
  hoisted.onClose.mockReset();
  hoisted.onCreated.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async (): Promise<void> => {
  act(() => {
    ReactDOM.render(
      <CreateIssueModal
        visible
        onClose={hoisted.onClose}
        onCreated={hoisted.onCreated}
      />,
      container
    );
  });
  await flush();
};

const titleInput = (): HTMLInputElement =>
  container.querySelector<HTMLInputElement>(".loop-ci__title")!;

const fillTitle = (): void => {
  act(() => {
    Simulate.change(titleInput(), { target: { value: "测试任务" } } as any);
  });
};

const pressEnter = (isComposing: boolean): void => {
  act(() => {
    titleInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing,
        bubbles: true,
        cancelable: true,
      })
    );
  });
};

describe("CreateIssueModal title input Enter / IME composition", () => {
  it("does NOT submit when Enter fires during IME composition", async () => {
    await render();
    fillTitle();

    pressEnter(true);
    await flush();

    expect(hoisted.createIssue).not.toHaveBeenCalled();
  });

  it("submits when Enter fires outside composition", async () => {
    await render();
    fillTitle();

    pressEnter(false);
    await flush();

    expect(hoisted.createIssue).toHaveBeenCalledTimes(1);
  });
});
