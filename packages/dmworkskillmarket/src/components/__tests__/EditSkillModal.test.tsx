import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditSkillModal from "../EditSkillModal";
import * as api from "../../api/skillApi";
import type { Category, Skill } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 1 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
  { id: "dev-tools", name: "开发工具", iconKey: "Code", sortOrder: 2, skillCount: 1 },
];

const displayNamePlaceholder = /请输入展示名称，最多20个字符|skillMarket\.form\.displayNamePlaceholder/;
const changelogPlaceholder = /简述此版本变更内容|skillMarket\.form\.changelogPlaceholder/;
const saveButton = /保存|skillMarket\.common\.save/;
const reuploadButton = /重新上传 Skill 包|skillMarket\.upload\.reupload/;
const selectNewZipLabel = /选择新的 Skill 包文件|skillMarket\.upload\.selectNewFileAriaLabel/;
const dirtyEditMessage = /确定离开？尚未完成编辑，已上传的文件和填写的信息将丢失。|skillMarket\.confirm\.dirtyEditMessage/;
const keepEditing = /继续编辑|skillMarket\.confirm\.keepEditing/;
const leaveButton = /确认离开|skillMarket\.confirm\.leave/;
const tagPlaceholder = /输入或选择标签|skillMarket\.form\.tagPlaceholder/;

const skill: Skill = {
  id: "meeting-note-cleaner",
  name: "meeting-note-cleaner",
  displayName: "会议纪要整理",
  iconUrl: "",
  description: "将会议纪要整理为决策、待办、风险和引用资料。",
  categoryId: "office",
  tags: ["纪要", "协作"],
  ownerId: "me",
  ownerName: "我",
  spaceId: "space-demo",
  visibility: "space",
  version: "1.1.3",
  readmeContent: "# meeting-note-cleaner\n\n- 输出待办",
  fileName: "meeting-note-cleaner.zip",
  fileUrl: "mock://skills/meeting-note-cleaner.zip",
  fileSize: 4096,
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
};

vi.mock("../../api/skillApi");

describe("EditSkillModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.updateSkill).mockResolvedValue(skill);
    vi.mocked(api.getSkillTags).mockResolvedValue([
      { name: "效率" },
      { name: "测试12" },
      { name: "协作" },
    ]);
    vi.mocked(api.initReupload).mockResolvedValue({
      uploadId: "reupload-456",
      presignedUrl: "http://localhost/upload/456",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    vi.mocked(api.uploadFile).mockResolvedValue(undefined);
    vi.mocked(api.triggerParse).mockResolvedValue({ taskId: "task-456" });
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "meeting-note-cleaner",
        description: "meeting-note-cleaner 提供可复用的自动化工作流。",
        tags: ["自动化", "Skill", "协作"],
        version: "1.2.0",
        readmeContent: "# meeting-note-cleaner",
        fileName: "meeting-note-cleaner.zip",
        fileSize: 3,
        fileSha256: "def456",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills current skill fields and saves updates", async () => {
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    render(<EditSkillModal skill={skill} categories={categories} onClose={onClose} onUpdated={onUpdated} />);

    expect(screen.getByDisplayValue("1.1.3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("会议纪要整理")).toBeInTheDocument();
    expect(screen.getByText("meeting-note-cleaner.zip")).toBeInTheDocument();
    expect(screen.getByText(reuploadButton)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "更新展示名" } });
    fireEvent.change(screen.getByLabelText(/分类|skillMarket\.form\.category/), { target: { value: "dev-tools" } });
    fireEvent.click(screen.getByRole("button", { name: saveButton }));

    await waitFor(() => expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
      displayName: "更新展示名",
      categoryId: "dev-tools",
      name: "meeting-note-cleaner",
    })));
    expect(onUpdated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks save while a tag validation error is visible", () => {
    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(tagPlaceholder), { target: { value: "bad<tag" } });

    expect(screen.getByText(/标签仅支持文字、数字、空格和 - _ \. \/ # \+|skillMarket\.form\.tagInvalidChars/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存|skillMarket\.common\.save/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /保存|skillMarket\.common\.save/ }));
    expect(api.updateSkill).not.toHaveBeenCalled();
  });

  it("suggests current-space tags while editing and saves the selected tag", async () => {
    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    const tagInput = screen.getByPlaceholderText(tagPlaceholder);
    fireEvent.change(tagInput, { target: { value: "效" } });

    await waitFor(() => {
      expect(api.getSkillTags).toHaveBeenCalledWith("效", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: "效率" }));

    fireEvent.click(screen.getByRole("button", { name: saveButton }));

    await waitFor(() => {
      expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
        tags: ["纪要", "协作", "效率"],
      }));
    });
  });

  it("guards closing after the form is changed and closes the confirm dialog after leaving", async () => {
    const onClose = vi.fn();
    render(<EditSkillModal skill={skill} categories={categories} onClose={onClose} onUpdated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: /取消|skillMarket\.common\.cancel/ }));

    expect(screen.getByText(dirtyEditMessage)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: keepEditing }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /取消|skillMarket\.common\.cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: leaveButton }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText(dirtyEditMessage)).not.toBeInTheDocument();
    });
  });

  it("can re-upload a Skill package and save the new file metadata", async () => {
    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText(reuploadButton));

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
        target: { files: [new File(["zip"], "updated-skill.skill", { type: "application/zip" })] },
      });
    });

    // Wait for the upload/parse flow to complete
    await waitFor(() => {
      expect(screen.getByText("updated-skill.skill")).toBeInTheDocument();
    });

    expect(api.initReupload).toHaveBeenCalledWith("meeting-note-cleaner", "updated-skill.skill", 3);
    expect(api.uploadFile).toHaveBeenCalled();
    expect(api.triggerParse).toHaveBeenCalledWith("reupload-456");
    expect(api.pollParse).toHaveBeenCalledWith("task-456");

    expect(screen.getByDisplayValue("1.1.4")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(changelogPlaceholder), { target: { value: "修复环境检测逻辑" } });
    fireEvent.click(screen.getByRole("button", { name: saveButton }));

    await waitFor(() => {
      expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
        parseTaskId: "task-456",
        name: "meeting-note-cleaner",
        version: "1.1.4",
        changelog: "修复环境检测逻辑",
      }));
    });
  });

  it("keeps existing tags when re-upload parsing returns no tags", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "meeting-note-cleaner",
        description: "meeting-note-cleaner 提供可复用的自动化工作流。",
        tags: [],
        version: "1.2.0",
        readmeContent: "# meeting-note-cleaner",
        fileName: "meeting-note-cleaner.zip",
        fileSize: 3,
        fileSha256: "def456",
      },
    });

    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText(reuploadButton));

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
        target: { files: [new File(["zip"], "updated-skill.zip", { type: "application/zip" })] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("updated-skill.zip")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(changelogPlaceholder), { target: { value: "修复环境检测逻辑" } });
    fireEvent.click(screen.getByRole("button", { name: saveButton }));

    await waitFor(() => {
      expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
        tags: ["纪要", "协作"],
      }));
    });
  });

  it("rejects re-uploaded packages whose SKILL.md name differs from the current skill", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "renamed-skill",
        description: "renamed-skill 提供可复用的自动化工作流。",
        tags: ["自动化"],
        version: "1.2.0",
        readmeContent: "# renamed-skill",
        fileName: "renamed-skill.zip",
        fileSize: 3,
        fileSha256: "def456",
      },
    });

    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText(reuploadButton));

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
        target: { files: [new File(["zip"], "renamed-skill.zip", { type: "application/zip" })] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/SKILL\.md 中的 name 必须保持为 meeting-note-cleaner，当前为 renamed-skill|skillMarket\.upload\.nameMismatch/)).toBeInTheDocument();
    });

    expect(screen.getByText("meeting-note-cleaner.zip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: saveButton })).toBeDisabled();
    expect(api.updateSkill).not.toHaveBeenCalled();
  });

  it("does not save file metadata when re-upload parsing fails", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "failed",
      error: { code: "parse.no_skill_md", message: "zip 包中未找到 SKILL.md" },
    });

    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText(reuploadButton));

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectNewZipLabel), {
        target: { files: [new File(["bad"], "broken-skill.zip", { type: "application/zip" })] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("zip 包中未找到 SKILL.md")).toBeInTheDocument();
    });

    expect(screen.getByText("meeting-note-cleaner.zip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: saveButton })).toBeDisabled();
    expect(api.updateSkill).not.toHaveBeenCalled();
  });
});
