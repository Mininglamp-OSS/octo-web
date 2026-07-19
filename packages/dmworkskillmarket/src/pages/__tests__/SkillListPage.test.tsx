import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillListPage from "../SkillListPage";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  {
    id: "all",
    name: "全部",
    iconKey: "LayoutGrid",
    sortOrder: 99,
    skillCount: 1,
  },
  {
    id: "office",
    name: "办公协作",
    iconKey: "FolderKanban",
    sortOrder: 1,
    skillCount: 1,
  },
];

const skill: Skill = {
  id: "meeting-note-cleaner",
  name: "meeting-note-cleaner",
  displayName: "会议纪要整理",
  iconUrl: "",
  description: "将会议纪要整理为决策、待办、风险和引用资料。",
  categoryId: "office",
  tags: ["纪要", "协作"],
  ownerId: "test-uid",
  ownerName: "我",
  spaceId: "space-demo",
  visibility: "space",
  version: "1.1.3",
  readmeContent: "# meeting-note-cleaner\n\n- 输出待办",
  fileName: "meeting-note-cleaner.zip",
  fileUrl: "mock://skills/meeting-note-cleaner.zip",
  fileSize: 4096,
  viewCount: 2,
  downloadCount: 0,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

vi.mock("../../api/skillApi");

async function switchToMineTab() {
  fireEvent.click(
    screen.getByRole("button", { name: "skillMarket.list.mine" })
  );
}

describe("SkillListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCategories).mockResolvedValue(categories);
    vi.mocked(api.getSkills).mockResolvedValue({
      items: [skill],
      nextCursor: null,
    });
    vi.mocked(api.getMySkills).mockResolvedValue({
      items: [skill],
      nextCursor: null,
    });
    vi.mocked(api.getSkillTags).mockResolvedValue([
      { name: "纪要" },
      { name: "协作" },
      { name: "代码" },
    ]);
    vi.mocked(api.getSkill).mockResolvedValue(skill);
    vi.mocked(api.trackSkillView).mockResolvedValue(undefined);
    vi.mocked(api.getSkillMd).mockResolvedValue(skill.readmeContent);
    vi.mocked(api.updateSkill).mockResolvedValue(skill);
    vi.mocked(api.deleteSkill).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides category chips on the mine tab and shows owner actions", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    expect(
      screen.queryByLabelText("skillMarket.category.ariaLabel")
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "meeting-note-cleaner @我" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "skillMarket.card.editAriaLabel" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "skillMarket.card.deleteAriaLabel" })
    ).toBeInTheDocument();
  });

  it("debounces search by 300ms before reloading the list", async () => {
    vi.useFakeTimers();
    render(<SkillListPage />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    vi.mocked(api.getSkills).mockClear();
    fireEvent.change(
      screen.getByPlaceholderText("skillMarket.filter.searchNameDescription"),
      {
        target: { value: "ci" },
      }
    );
    expect(api.getSkills).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(api.getSkills).toHaveBeenCalledWith(
      {
        q: "ci",
        categoryId: "all",
        tags: [],
        sort: "comprehensive",
        cursor: undefined,
        limit: 20,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps the tag filter open after selecting a tag and clears selected tags", async () => {
    render(<SkillListPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "skillMarket.filter.tags" })
    );
    const tagOption = await screen.findByRole("option", { name: "纪要" });
    fireEvent.click(tagOption);

    expect(
      screen.getByPlaceholderText("skillMarket.filter.searchTags")
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "纪要" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByText("skillMarket.filter.tagsSelected")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "skillMarket.filter.clear" })
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "纪要" })).toHaveAttribute(
        "aria-selected",
        "false"
      );
    });
    expect(
      screen.getByText("skillMarket.filter.noTagsSelected")
    ).toBeInTheDocument();
  });

  it("reloads skills with the selected sort option", async () => {
    render(<SkillListPage />);
    expect(
      await screen.findByRole("button", { name: "meeting-note-cleaner @我" })
    ).toBeInTheDocument();
    vi.mocked(api.getSkills).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "浏览最多" }));

    await waitFor(() => {
      expect(api.getSkills).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "views" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("shows stats on cards and increments the visible view count when opening detail", async () => {
    render(<SkillListPage />);

    const card = await screen.findByRole("button", {
      name: "meeting-note-cleaner @我",
    });
    expect(screen.getByLabelText(/浏览次数：2|Views: 2/)).toHaveTextContent("2");
    expect(screen.getByLabelText(/下载次数：0|Downloads: 0/)).toHaveTextContent("0");

    fireEvent.click(card);

    await screen.findByText(skill.fileName);
    expect(screen.getByLabelText(/浏览次数：3|Views: 3/)).toHaveTextContent("3");
  });

  it("confirms deletion and removes the skill through the API", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "skillMarket.card.deleteAriaLabel",
      })
    );
    expect(
      screen.getByText("skillMarket.delete.confirmMessage")
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "skillMarket.common.delete" })
    );

    await waitFor(() =>
      expect(api.deleteSkill).toHaveBeenCalledWith("meeting-note-cleaner")
    );
  });

  it("closes the detail modal when deleting a skill from within it", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(
      await screen.findByRole("button", { name: "meeting-note-cleaner @我" })
    );
    expect(await screen.findByText(skill.description)).toBeInTheDocument();
    expect(await screen.findByText(skill.fileName)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "skillMarket.card.deleteAriaLabel",
      })[1]
    );
    expect(
      screen.getByText("skillMarket.delete.confirmMessage")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "skillMarket.common.delete" })
    );
    await waitFor(() =>
      expect(api.deleteSkill).toHaveBeenCalledWith("meeting-note-cleaner")
    );

    await waitFor(() =>
      expect(screen.queryByText(skill.fileName)).not.toBeInTheDocument()
    );
  });

  it("offers a clear-filter action when search returns no results", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });
    render(<SkillListPage />);

    await waitFor(() =>
      expect(screen.getByText("skillMarket.list.empty")).toBeInTheDocument()
    );
  });

  it("refreshes an open detail modal after saving from detail edit", async () => {
    const updatedSkill: Skill = {
      ...skill,
      displayName: "更新后的展示名",
      description: "更新后的详情说明",
      updatedAt: "2026-07-14T08:00:00.000Z",
    };
    vi.mocked(api.updateSkill).mockResolvedValue(updatedSkill);
    vi.mocked(api.getSkill)
      .mockResolvedValueOnce(skill)
      .mockResolvedValueOnce(updatedSkill);

    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(
      await screen.findByRole("button", { name: "meeting-note-cleaner @我" })
    );
    expect(await screen.findByText(skill.description)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "skillMarket.card.editAriaLabel",
      })[1]
    );
    fireEvent.change(
      screen.getByPlaceholderText("skillMarket.form.displayNamePlaceholder"),
      { target: { value: updatedSkill.displayName } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "skillMarket.common.save" })
    );

    await waitFor(() =>
      expect(api.updateSkill).toHaveBeenCalledWith(
        "meeting-note-cleaner",
        expect.objectContaining({
          displayName: updatedSkill.displayName,
        })
      )
    );
    expect(
      await screen.findByText(updatedSkill.description)
    ).toBeInTheDocument();
    expect(api.getSkill).toHaveBeenCalledTimes(2);
  });

  it("shows a search-specific empty state with a clear-search action", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });

    render(<SkillListPage />);

    fireEvent.change(
      screen.getByPlaceholderText("skillMarket.filter.searchNameDescription"),
      {
        target: { value: "missing" },
      }
    );

    expect(
      await screen.findByText("skillMarket.list.empty")
    ).toBeInTheDocument();
  });

  it("shows a category-specific empty state when the selected category has no skills", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({ items: [], nextCursor: null });

    render(<SkillListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /办公协作/ }));

    expect(
      await screen.findByText("skillMarket.list.empty")
    ).toBeInTheDocument();
  });

});
