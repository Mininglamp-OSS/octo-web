import { describe, expect, it } from "vitest";
import {
  createSkill,
  deleteSkill,
  getCategories,
  getMySkills,
  getSkill,
  getSkills,
  updateSkill,
} from "./skillApiMock";

describe("skillApi mock contract", () => {
  it("exposes 16 PRD categories with skill counts", async () => {
    const categories = await getCategories();

    expect(categories).toHaveLength(16);
    expect(categories.map((category) => category.name)).toEqual([
      "装机必备",
      "开发工具",
      "基础设施",
      "办公协作",
      "市场推广",
      "前端开发",
      "媒体处理",
      "代码质检",
      "洞察研究",
      "数据分析",
      "内容营销",
      "移动开发",
      "云效工具",
      "社交娱乐",
      "其他",
      "全部",
    ]);
    expect(categories.find((category) => category.id === "dev-tools")?.skillCount).toBeGreaterThan(5);
  });

  it("pages skills and returns a cursor for the next batch", async () => {
    const firstPage = await getSkills({ limit: 20 });
    const secondPage = await getSkills({ limit: 20, cursor: firstPage.nextCursor ?? undefined });

    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.nextCursor).toBe("20");
    expect(secondPage.items).toHaveLength(20);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
  });

  it("filters by search text, category, and current user ownership", async () => {
    const searched = await getSkills({ q: "CI", limit: 50 });
    const category = await getSkills({ categoryId: "quality", limit: 50 });
    const mine = await getMySkills({ limit: 50 });

    expect(
      searched.items.every((skill) =>
        `${skill.name} ${skill.description} ${skill.ownerName} ${skill.visibility} ${skill.categoryId} ${skill.tags.join(" ")}`
          .toLowerCase()
          .includes("ci"),
      ),
    ).toBe(true);
    expect(category.items.every((skill) => skill.categoryId === "quality")).toBe(true);
    expect(mine.items.length).toBeGreaterThanOrEqual(3);
    expect(mine.items.every((skill) => skill.ownerId === "me")).toBe(true);
  });

  it("search matches category name so users can find skills by visible category label", async () => {
    const devTools = await getSkills({ q: "开发工具", limit: 50 });
    const office = await getSkills({ q: "办公协作", limit: 50 });

    expect(devTools.items.length).toBeGreaterThan(0);
    expect(devTools.items.every((skill) => skill.categoryId === "dev-tools")).toBe(true);
    expect(office.items.length).toBeGreaterThan(0);
    expect(office.items.every((skill) => skill.categoryId === "office")).toBe(true);
  });

  it("creates, updates, loads, and deletes a skill in the mock store", async () => {
    const created = await createSkill({
      name: "workflow-note-builder",
      displayName: "test",
      description: "将工作流记录整理成可复用 Skill 说明。",
      categoryId: "office",
      tags: ["协作", "文档"],
      visibility: "space",
      readmeContent: "# workflow-note-builder\n\n- 整理输入\n- 输出清单",
      fileName: "workflow-note-builder.zip",
      fileSize: 2048,
    });

    expect(created.ownerId).toBe("me");
    expect((await getSkill(created.id)).name).toBe("workflow-note-builder");

    const updated = await updateSkill(created.id, {
      visibility: "private",
      tags: ["协作", "文档", "模板"],
    });
    expect(updated.visibility).toBe("private");
    expect(updated.tags).toContain("模板");

    await deleteSkill(created.id);
    await expect(getSkill(created.id)).rejects.toThrow("Skill not found");
  });
});
