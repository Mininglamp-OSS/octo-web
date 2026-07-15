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
        name: "updated-skill",
        description: "updated-skill 提供可复用的自动化工作流。",
        tags: ["自动化", "Skill", "协作"],
        version: "1.2.0",
        readmeContent: "# updated-skill",
        fileName: "updated-skill.zip",
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

    expect(screen.getByDisplayValue("meeting-note-cleaner")).toBeInTheDocument();
    expect(screen.getByDisplayValue("会议纪要整理")).toBeInTheDocument();
    expect(screen.getByText("meeting-note-cleaner.zip")).toBeInTheDocument();
    expect(screen.getByText("重新上传 zip 包")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("请输入展示名称，最多20个字符"), { target: { value: "更新展示名" } });
    fireEvent.change(screen.getByLabelText("分类"), { target: { value: "dev-tools" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
      displayName: "更新展示名",
      categoryId: "dev-tools",
      name: "meeting-note-cleaner",
    })));
    expect(onUpdated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("guards closing after the form is changed", () => {
    const onClose = vi.fn();
    render(<EditSkillModal skill={skill} categories={categories} onClose={onClose} onUpdated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("请输入展示名称，最多20个字符"), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("确定离开？尚未完成编辑，已上传的文件和填写的信息将丢失。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "确认离开" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("can re-upload a zip package and save the new file metadata", async () => {
    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText("重新上传 zip 包"));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("选择新的 Skill zip 文件"), {
        target: { files: [new File(["zip"], "updated-skill.zip", { type: "application/zip" })] },
      });
    });

    // Wait for the upload/parse flow to complete
    await waitFor(() => {
      expect(screen.getByDisplayValue("updated-skill")).toBeInTheDocument();
    });

    expect(api.initReupload).toHaveBeenCalledWith("meeting-note-cleaner", "updated-skill.zip", 3);
    expect(api.uploadFile).toHaveBeenCalled();
    expect(api.triggerParse).toHaveBeenCalledWith("reupload-456");
    expect(api.pollParse).toHaveBeenCalledWith("task-456");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.updateSkill).toHaveBeenCalledWith("meeting-note-cleaner", expect.objectContaining({
        parseTaskId: "task-456",
        name: "updated-skill",
        version: "1.2.0",
      }));
    });
  });

  it("does not save file metadata when re-upload parsing fails", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "failed",
      error: { code: "parse.no_skill_md", message: "zip 包中未找到 SKILL.md" },
    });

    render(<EditSkillModal skill={skill} categories={categories} onClose={vi.fn()} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByText("重新上传 zip 包"));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("选择新的 Skill zip 文件"), {
        target: { files: [new File(["bad"], "broken-skill.zip", { type: "application/zip" })] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("zip 包中未找到 SKILL.md")).toBeInTheDocument();
    });

    expect(screen.getByText("meeting-note-cleaner.zip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(api.updateSkill).not.toHaveBeenCalled();
  });
});
