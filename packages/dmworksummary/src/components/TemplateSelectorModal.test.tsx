import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TemplateSelectorModal, {
  topicTemplateToWorkbenchScope,
  type TemplateSelectorDataSource,
  type TemplateSelectorLabels,
} from "./TemplateSelectorModal";
import type { TopicTemplate } from "../types/summary";

vi.mock("@douyinfe/semi-ui", () => ({
  Modal: ({ visible, title, children, footer }: any) =>
    visible ? (
      <section aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer}
      </section>
    ) : null,
  Spin: () => <span data-testid="spinner" />,
  Empty: ({ description }: any) => <span>{description}</span>,
}));

const labels: TemplateSelectorLabels = {
  title: "Choose template",
  builtInTitle: "Built in",
  customTitle: (count, limit) => `Custom ${count}/${limit}`,
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  reset: "Reset",
  cancel: "Cancel",
  save: "Save",
  clear: "Clear",
  loading: "Loading",
  empty: "Empty",
  loadFailed: "Load failed",
  retry: "Retry",
  limitReached: "Limit reached",
  createTitle: "Create template",
  editTitle: "Edit template",
  nameLabel: "Name",
  descriptionLabel: "Requirement",
  namePlaceholder: "Template name",
  descriptionPlaceholder: "Template requirement",
  customPromptTopic: "Summary topic",
  customPromptContext: "Content focus",
  editHint: "Personal configuration",
  deleteConfirmTitle: "Delete template",
  deleteConfirmContent: (name) => `Delete ${name}?`,
  createFailed: "Create failed",
  updateFailed: "Update failed",
  resetFailed: "Reset failed",
  deleteFailed: "Delete failed",
};

const builtInTemplate: TopicTemplate & { version?: number } = {
  id: "weekly",
  label: "Weekly report",
  icon: "Calendar",
  description: "Summarize weekly work",
  type: "fixed",
  pattern: "List progress and risks",
  version: 3,
};

function dataSource(
  overrides: Partial<TemplateSelectorDataSource> = {}
): TemplateSelectorDataSource {
  return {
    load: vi.fn().mockResolvedValue({
      templates: [builtInTemplate],
      custom_template_limit: 5,
    }),
    create: vi.fn(),
    updateBuiltIn: vi.fn(),
    updateCustom: vi.fn(),
    resetBuiltIn: vi.fn(),
    deleteCustom: vi.fn(),
    ...overrides,
  };
}

describe("TemplateSelectorModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders as an inline expandable panel when requested", async () => {
    const view = render(
      <TemplateSelectorModal
        visible
        inline
        value={null}
        labels={labels}
        dataSource={dataSource()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
      { legacyRoot: true }
    );

    await view.findByText("Weekly report");
    expect(
      view.container.querySelector(".wk-template-selector--inline")
    ).toHaveAttribute("aria-label", "Choose template");
    expect(
      view.queryByRole("heading", { name: "Choose template" })
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Cancel" })
    ).not.toBeInTheDocument();
    expect(
      view.container.querySelector('[data-template-tone="purple"]')
    ).toBeInTheDocument();
  });

  it("separates the custom template title, count and empty create card", async () => {
    const view = render(
      <TemplateSelectorModal
        visible
        inline
        value={null}
        labels={{
          ...labels,
          customSectionTitle: "My templates",
          customCountLabel: (count, limit) => `${count}/${limit}`,
        }}
        dataSource={dataSource()}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
      { legacyRoot: true }
    );

    await view.findByText("Weekly report");
    expect(
      view.getByRole("heading", { name: "My templates" })
    ).toBeInTheDocument();
    expect(view.getByText("0/5")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: "Create" })).toHaveLength(1);
    expect(
      view.container.querySelector(".wk-template-selector__grid--empty")
    ).toContainElement(view.getByRole("button", { name: "Create" }));
  });

  it("maps a selected TopicTemplate to a structured workbench scope", async () => {
    const onChange = vi.fn();
    const view = render(
      <TemplateSelectorModal
        visible
        value={null}
        labels={labels}
        dataSource={dataSource()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
      { legacyRoot: true }
    );

    await waitFor(() =>
      expect(document.querySelector("[data-testid='spinner']")).toBeNull()
    );
    fireEvent.click(view.getByRole("button", { name: "Weekly report" }));

    expect(onChange).toHaveBeenCalledWith({
      templateId: "weekly",
      label: "Weekly report",
      requirement: "List progress and risks",
      version: 3,
    });
  });

  it("keeps template selection and editing as separate native controls", async () => {
    const onChange = vi.fn();
    const view = render(
      <TemplateSelectorModal
        visible
        value={null}
        labels={labels}
        dataSource={dataSource()}
        onChange={onChange}
        onCancel={vi.fn()}
      />,
      { legacyRoot: true }
    );

    await view.findByText("Weekly report");

    expect(view.queryAllByRole("option")).toHaveLength(0);
    expect(
      view.getByRole("button", { name: "Weekly report" })
    ).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Edit" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(
      view.getByRole("heading", { name: "Edit template" })
    ).toBeInTheDocument();
  });

  it("creates a custom template through the injected CRUD data source", async () => {
    const created: TopicTemplate = {
      id: "custom-1",
      label: "Decision log",
      icon: "FileText",
      description: "Only decisions",
      type: "fixed",
      pattern: "Only confirmed decisions",
      is_custom: true,
    };
    const create = vi.fn().mockResolvedValue(created);

    const view = render(
      <TemplateSelectorModal
        visible
        value={null}
        labels={labels}
        dataSource={dataSource({ create })}
        onChange={vi.fn()}
        onCancel={vi.fn()}
      />,
      { legacyRoot: true }
    );

    await view.findByText("Weekly report");
    fireEvent.click(view.getAllByRole("button", { name: "Create" })[0]);
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Decision log" },
    });
    fireEvent.change(view.getByLabelText("Requirement"), {
      target: { value: "Only decisions" },
    });

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Save" }));
    });

    expect(create).toHaveBeenCalledWith({
      label: "Decision log",
      description: "Only decisions",
    });
    expect(await view.findByText("Decision log")).toBeInTheDocument();
  });

  it("falls back to description when a template has no pattern", () => {
    expect(
      topicTemplateToWorkbenchScope(
        {
          ...builtInTemplate,
          pattern: "",
        },
        labels
      ).requirement
    ).toBe("Summarize weekly work");
  });

  it("resolves parameterized template tokens into user-facing labels", () => {
    const scope = topicTemplateToWorkbenchScope(
      {
        ...builtInTemplate,
        type: "parameterized",
        pattern: "Summarize {project_name} progress",
        placeholders: [
          { key: "project_name", label: "Project name", position: [10, 22] },
        ],
      },
      labels
    );

    expect(scope.requirement).toBe("Summarize Project name progress");
    expect(scope.requirement).not.toContain("{project_name}");
  });

  it("frames custom templates with localized topic and focus labels", () => {
    const scope = topicTemplateToWorkbenchScope(
      {
        ...builtInTemplate,
        id: "custom-1",
        label: "Decision log",
        description: "Only decisions and owners",
        pattern: "",
        is_custom: true,
      },
      labels
    );

    expect(scope.requirement).toBe(
      "Summary topic: Decision log\nContent focus: Only decisions and owners"
    );
  });
});
