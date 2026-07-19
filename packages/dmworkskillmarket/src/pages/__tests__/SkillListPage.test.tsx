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

const mineTabName = /我的|skillMarket\.list\.mine/;
const categoryAriaLabel = /Skill 分类|skillMarket\.category\.ariaLabel/;
const searchPlaceholder = /搜索名称、描述\.\.\.|skillMarket\.filter\.searchNameDescription/;
const tagFilterName = /标签|skillMarket\.filter\.tags/;
const tagSearchPlaceholder = /搜索标签|skillMarket\.filter\.searchTags/;
const selectedTagsText = /已选择标签|skillMarket\.filter\.tagsSelected/;
const noSelectedTagsText = /未选择标签|skillMarket\.filter\.noTagsSelected/;
const clearFilterName = /清空|skillMarket\.filter\.clear/;
const editSkillName = /编辑 meeting-note-cleaner|skillMarket\.card\.editAriaLabel/;
const deleteSkillName = /删除 meeting-note-cleaner|skillMarket\.card\.deleteAriaLabel/;
const deleteConfirmText = /确定删除「meeting-note-cleaner」？|skillMarket\.delete\.confirmMessage/;
const deleteButtonName = /^删除$|^skillMarket\.common\.delete$/;
const saveButtonName = /保存|skillMarket\.common\.save/;
const displayNamePlaceholder = /请输入展示名称，最多20个字符|skillMarket\.form\.displayNamePlaceholder/;
const emptyText = /暂无数据|skillMarket\.list\.empty/;
const totalCountText = /共 1 个 Skill|skillMarket\.list\.totalCount/;

async function switchToMineTab() {
  fireEvent.click(screen.getByRole("button", { name: mineTabName }));
}

describe("SkillListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCategories).mockResolvedValue(categories);
    vi.mocked(api.getSkills).mockResolvedValue({
      items: [skill],
      nextCursor: null,
      total: 1,
    });
    vi.mocked(api.getMySkills).mockResolvedValue({
      items: [skill],
      nextCursor: null,
      total: 1,
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
      screen.queryByLabelText(categoryAriaLabel)
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "meeting-note-cleaner @我" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: editSkillName })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: deleteSkillName })
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
      screen.getByPlaceholderText(searchPlaceholder),
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
      screen.getByRole("button", { name: tagFilterName })
    );
    const tagOption = await screen.findByRole("option", { name: "纪要" });
    fireEvent.click(tagOption);

    expect(
      screen.getByPlaceholderText(tagSearchPlaceholder)
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "纪要" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByText(selectedTagsText)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: clearFilterName })
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "纪要" })).toHaveAttribute(
        "aria-selected",
        "false"
      );
    });
    expect(
      screen.getByText(noSelectedTagsText)
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
    expect(screen.getByText(totalCountText)).toBeInTheDocument();
    expect(screen.getByLabelText(/浏览次数：2|Views: 2/)).toHaveTextContent("2");
    expect(screen.getByLabelText(/下载次数：0|Downloads: 0/)).toHaveTextContent("0");

    fireEvent.click(card);

    await screen.findByText(skill.description);
    expect(screen.getByLabelText(/浏览次数：3|Views: 3/)).toHaveTextContent("3");
  });

  it("confirms deletion and removes the skill through the API", async () => {
    render(<SkillListPage />);
    await switchToMineTab();

    fireEvent.click(
      await screen.findByRole("button", {
        name: deleteSkillName,
      })
    );
    expect(
      screen.getByText(deleteConfirmText)
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: deleteButtonName }).at(-1)!);

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

    fireEvent.click(
      screen.getAllByRole("button", {
        name: deleteSkillName,
      })[1]
    );
    expect(
      screen.getByText(deleteConfirmText)
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: deleteButtonName }).at(-1)!);
    await waitFor(() =>
      expect(api.deleteSkill).toHaveBeenCalledWith("meeting-note-cleaner")
    );

    await waitFor(() =>
      expect(screen.queryByText(deleteConfirmText)).not.toBeInTheDocument()
    );
  });

  it("offers a clear-filter action when search returns no results", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });
    render(<SkillListPage />);

    await waitFor(() =>
      expect(screen.getByText(emptyText)).toBeInTheDocument()
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
        name: editSkillName,
      })[1]
    );
    fireEvent.change(
      screen.getByPlaceholderText(displayNamePlaceholder),
      { target: { value: updatedSkill.displayName } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: saveButtonName })
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
      (await screen.findAllByText(updatedSkill.description)).length
    ).toBeGreaterThan(0);
    expect(api.getSkill).toHaveBeenCalledTimes(2);
  });

  it("shows a search-specific empty state with a clear-search action", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });

    render(<SkillListPage />);

    fireEvent.change(
      screen.getByPlaceholderText(searchPlaceholder),
      {
        target: { value: "missing" },
      }
    );

    expect(
      await screen.findByText(emptyText)
    ).toBeInTheDocument();
  });

  it("shows a category-specific empty state when the selected category has no skills", async () => {
    vi.mocked(api.getSkills).mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });

    render(<SkillListPage />);

    fireEvent.click(await screen.findByRole("button", { name: /办公协作/ }));

    expect(
      await screen.findByText(emptyText)
    ).toBeInTheDocument();
  });

});
