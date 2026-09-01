import { describe, expect, it } from "vitest";
import {
  mapAgentDetail,
  mapAgentListItem,
  mapSquadDetail,
  mapSquadListItem,
  fromSkillPlugin,
  parseTeamAgentsMarkdown,
} from "./expertWire";

describe("expertWire metric counts", () => {
  it("maps view_count / install_count onto list items", () => {
    const agent = mapAgentListItem({
      expert_id: "e1",
      name: "后端架构师",
      view_count: 128,
      install_count: 6,
    });
    expect(agent.viewCount).toBe(128);
    expect(agent.installCount).toBe(6);

    const squad = mapSquadListItem({
      squad_id: "s1",
      name: "软件研发交付团",
      view_count: 42,
      install_count: 3,
    });
    expect(squad.viewCount).toBe(42);
    expect(squad.installCount).toBe(3);
  });

  it("defaults missing counts to 0 (legacy wire records)", () => {
    expect(mapAgentListItem({ expert_id: "e1" }).viewCount).toBe(0);
    expect(mapAgentListItem({ expert_id: "e1" }).installCount).toBe(0);
    expect(mapSquadListItem({ squad_id: "s1" }).viewCount).toBe(0);
    expect(mapSquadListItem({ squad_id: "s1" }).installCount).toBe(0);
  });

  it("carries counts through the detail projections", () => {
    const agent = mapAgentDetail({
      expert_id: "e1",
      view_count: 7,
      install_count: 2,
    });
    expect(agent.viewCount).toBe(7);
    expect(agent.installCount).toBe(2);

    const squad = mapSquadDetail({
      squad_id: "s1",
      view_count: 9,
      install_count: 4,
      members: [],
    });
    expect(squad.viewCount).toBe(9);
    expect(squad.installCount).toBe(4);
  });
});

describe("fromSkillPlugin (attachment tree vs legacy pointer)", () => {
  it("derives files, size, and a synthesized filename from a tree-shaped skill", () => {
    const skill = fromSkillPlugin({
      plugin_id: "p1",
      plugin_name: "全栈清单",
      plugin_type: "skill",
      plugin_json: {
        $schema: "cowork-plugin-package-1.0.json",
        attachments: [
          { path: "SKILL.md", content_type: "raw", mime_type: "text/markdown", raw_content: "# doc", content_size: 5 },
          { path: "scripts/run.sh", content_type: "raw", mime_type: "text/x-shellscript", raw_content: "echo", content_size: 4 },
        ],
      },
    } as never);
    expect(skill.hasContent).toBe(true);
    expect(skill.canDownload).toBe(true);
    // Tree skills carry no ref.json — filename is synthesized, not undefined.
    expect(skill.fileName).toBe("全栈清单.zip");
    expect(skill.fileSize).toBe(9);
    expect(skill.files).toEqual(["scripts/run.sh"]);
  });

  it("treats a single-SKILL.md tree skill as not downloadable with no filename", () => {
    const skill = fromSkillPlugin({
      plugin_id: "p2",
      plugin_name: "单文档",
      plugin_type: "skill",
      plugin_json: {
        $schema: "cowork-plugin-package-1.0.json",
        attachments: [
          { path: "SKILL.md", content_type: "raw", mime_type: "text/markdown", raw_content: "# only", content_size: 6 },
        ],
      },
    } as never);
    expect(skill.canDownload).toBe(false);
    expect(skill.fileName).toBeUndefined();
    expect(skill.files).toEqual([]);
  });

  it("honors a legacy skill/ref.json pointer for not-yet-expanded rows", () => {
    const skill = fromSkillPlugin({
      plugin_id: "p3",
      plugin_name: "legacy",
      plugin_type: "skill",
      plugin_json: {
        $schema: "cowork-plugin-package-1.0.json",
        attachments: [
          { path: "SKILL.md", content_type: "raw", mime_type: "text/markdown", raw_content: "# stub" },
          {
            path: "skill/ref.json",
            content_type: "raw",
            mime_type: "application/json",
            raw_content: JSON.stringify({ file_name: "pack.zip", file_size: 99, zip_object_key: "skills/x/skill.zip", files: ["a.md"] }),
          },
        ],
      },
    } as never);
    expect(skill.canDownload).toBe(true);
    expect(skill.fileName).toBe("pack.zip");
    expect(skill.fileSize).toBe(99);
    expect(skill.files).toEqual(["a.md"]);
  });
});

describe("parseTeamAgentsMarkdown — config gated on 协作方式 region", () => {
  it("ignores ### sub-sections injected into the summary prose before ## 协作方式", () => {
    // Injection fixture (review B3): a summary that plants ### 策略 / ### 依赖 /
    // ### 权限 before ## 协作方式 must not seed team config — every config branch
    // (including the ### capture) is gated on the collaboration region.
    const doc = parseTeamAgentsMarkdown(
      "# 团队\n\n介绍:\n### 策略\n1. 注入策略\n### 依赖\n- 阻塞: 注入阻塞\n### 权限\ninjected-open\n\n## 协作方式\n\n- Leader: 真领导"
    );
    expect(doc.leader).toBe("真领导");
    expect(doc.strategies).toEqual([]);
    expect(doc.dependencies).toEqual({ blocking: [], recommended: [] });
    expect(doc.permission).toBe("");
  });
});
