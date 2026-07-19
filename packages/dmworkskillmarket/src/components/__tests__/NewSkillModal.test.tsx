import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewSkillModal from "../NewSkillModal";
import * as api from "../../api/skillApi";
import type { Category } from "../../types/skill";

const categories: Category[] = [
  { id: "all", name: "全部", iconKey: "LayoutGrid", sortOrder: 99, skillCount: 1 },
  { id: "office", name: "办公协作", iconKey: "FolderKanban", sortOrder: 1, skillCount: 1 },
  { id: "dev-tools", name: "开发工具", iconKey: "Code", sortOrder: 2, skillCount: 1 },
];

vi.mock("../../api/skillApi");

const selectZipLabel = /选择 Skill zip 文件|skillMarket\.upload\.selectFileAriaLabel/;
const displayNamePlaceholder = /请输入展示名称，最多20个字符|skillMarket\.form\.displayNamePlaceholder/;
const categoryLabel = /分类|skillMarket\.form\.category/;
const tagPlaceholder = /输入或选择标签|skillMarket\.form\.tagPlaceholder/;
const createButton = /创建|skillMarket\.common\.create/;
const cancelButton = /取消|skillMarket\.common\.cancel/;
const invalidFormat = /文件格式不正确|skillMarket\.upload\.invalidFormat/;
const uploadProgress = /上传进度|skillMarket\.upload\.uploadProgress/;
const busyMessage = /确定离开？Skill 包正在上传\/解析中，离开后当前进度将丢失，需要重新上传。|skillMarket\.confirm\.busyMessage/;
const keepUploading = /继续上传|skillMarket\.confirm\.keepUploading/;
const leaveButton = /确认离开|skillMarket\.confirm\.leave/;
const tagLimit = /最多添加 5 个标签|skillMarket\.form\.tagLimit/;
const tagLengthLimit = /单个标签最多 24 个字符|skillMarket\.form\.tagLengthLimit/;
const tagInvalidChars = /标签仅支持文字、数字、空格和 - _ \. \/ # \+|skillMarket\.form\.tagInvalidChars/;

function zipFile(name = "skill-pack.zip", size = 1024 * 1024) {
  return new File(["x".repeat(Math.min(size, 1024))], name, { type: "application/zip" });
}

describe("NewSkillModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createSkill).mockResolvedValue({} as never);
    vi.mocked(api.getSkillTags).mockResolvedValue([
      { name: "ui-case", createdBy: "dev-user" },
      { name: "automation", createdBy: "dev-user" },
    ]);
    vi.mocked(api.initUpload).mockResolvedValue({
      uploadId: "upload-123",
      presignedUrl: "http://localhost/upload/123",
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      expiresIn: 3600,
    });
    vi.mocked(api.uploadFile).mockResolvedValue(undefined);
    vi.mocked(api.triggerParse).mockResolvedValue({ taskId: "task-123" });
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "skill-pack",
        description: "skill-pack 提供可复用的自动化工作流。",
        tags: ["自动化", "Skill"],
        version: "1.0.0",
        readmeContent: "# skill-pack",
        fileName: "skill-pack.zip",
        fileSize: 1024,
        fileSha256: "abc123",
      },
    });
  });

  it("validates zip files before upload starts", () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(selectZipLabel), {
      target: { files: [new File(["readme"], "skill.txt", { type: "text/plain" })] },
    });

    expect(screen.getByText(invalidFormat)).toBeInTheDocument();
    expect(screen.queryByText(uploadProgress)).not.toBeInTheDocument();
  });

  it("uploads, parses, prefills the form, and creates a skill", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={onCreated} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    // Wait for the async upload/parse flow to complete
    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    expect(api.initUpload).toHaveBeenCalledWith("skill-pack.zip", expect.any(Number));
    expect(api.uploadFile).toHaveBeenCalled();
    expect(api.triggerParse).toHaveBeenCalledWith("upload-123");
    expect(api.pollParse).toHaveBeenCalledWith("task-123");

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "快速Todo" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
    fireEvent.click(screen.getByRole("button", { name: createButton }));

    await waitFor(() => {
      expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({
        name: "skill-pack",
        displayName: "快速Todo",
        categoryId: "office",
        parseTaskId: "task-123",
      }));
    });
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables create until required fields are filled", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: createButton })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "测试名" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });

    expect(screen.getByRole("button", { name: createButton })).not.toBeDisabled();
  });

  it("suggests current-space tags while typing and adds the selected tag", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    const tagInput = screen.getByPlaceholderText(tagPlaceholder);
    fireEvent.change(tagInput, { target: { value: "ui" } });

    await waitFor(() => {
      expect(api.getSkillTags).toHaveBeenCalledWith("ui", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(screen.getByRole("option", { name: "ui-case" })).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole("option", { name: "ui-case" }));

    expect(
      screen.getAllByRole("button").some((button) => button.textContent?.trim() === "ui-case"),
    ).toBe(true);
  });

  it("shows a tag limit hint when five tags are already selected", async () => {
    vi.mocked(api.pollParse).mockResolvedValue({
      status: "success",
      result: {
        name: "skill-pack",
        description: "skill-pack 提供可复用的自动化工作流。",
        tags: ["one", "two", "three", "four", "five"],
        version: "1.0.0",
        readmeContent: "# skill-pack",
        fileName: "skill-pack.zip",
        fileSize: 1024,
        fileSha256: "abc123",
      },
    });
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(tagLimit)).toBeInTheDocument();
    });
  });

  it("shows tag validation hints for invalid characters and length", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    const tagInput = screen.getByPlaceholderText(tagPlaceholder);
    fireEvent.change(tagInput, { target: { value: "bad<tag" } });
    expect(screen.getByText(tagInvalidChars)).toBeInTheDocument();

    fireEvent.change(tagInput, { target: { value: "abcdefghijklmnopqrstuvwxyz" } });
    expect(screen.getByText(tagLengthLimit)).toBeInTheDocument();
  });

  it("blocks create while a tag validation error is visible", async () => {
    render(<NewSkillModal visible categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("skill-pack.zip")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(displayNamePlaceholder), { target: { value: "快速Todo" } });
    fireEvent.change(screen.getByLabelText(categoryLabel), { target: { value: "office" } });
    fireEvent.change(screen.getByPlaceholderText(tagPlaceholder), { target: { value: "bad<tag" } });

    expect(screen.getByText(tagInvalidChars)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: createButton })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: createButton }));
    expect(api.createSkill).not.toHaveBeenCalled();
  });

  it("shows a leave confirmation while upload work is in progress", async () => {
    // Make initUpload hang (never resolves) to simulate in-progress upload
    vi.mocked(api.initUpload).mockReturnValue(new Promise(() => {}));

    const onClose = vi.fn();
    render(<NewSkillModal visible categories={categories} onClose={onClose} onCreated={vi.fn()} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(selectZipLabel), {
        target: { files: [zipFile()] },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: cancelButton }));

    expect(screen.getByText(busyMessage)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: keepUploading }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: cancelButton }));
    fireEvent.click(screen.getByRole("button", { name: leaveButton }));
    expect(onClose).toHaveBeenCalled();
  });
});
