import { describe, expect, it } from "vitest";
import { buildExpertPrompt } from "./buildExpertPrompt";
import type { ExpertAgent, ExpertSquad } from "../mock/expertMock";

const SPACE = "minglue_default";
const API = "https://im.deepminer.com.cn";

const agent: ExpertAgent = {
  id: "backend-architect",
  kind: "agent",
  shortName: "架构",
  name: "后端架构师",
  summary: "评审服务边界。",
  category: "研发工具",
  tags: ["架构评审"],
};

const squad: ExpertSquad = {
  id: "growth-squad",
  kind: "squad",
  shortName: "增长",
  name: "增长专家团",
  summary: "增长闭环。",
  category: "营销策划",
  tags: ["增长"],
  leader: "Leader",
  members: [],
};

describe("buildExpertPrompt — marketplace-fetch → loop-recreate", () => {
  it("agent prompt fetches from octo-cli marketplace then recreates via octo-daemon", () => {
    const p = buildExpertPrompt(agent, { spaceId: SPACE, apiBaseUrl: API });
    // marketplace read (octo-cli), addressed by id
    expect(p).toContain("octo-cli marketplace expert get backend-architect");
    expect(p).toContain("octo-cli marketplace expert skill-download backend-architect --index <i>");
    // loop recreate (octo-daemon)
    expect(p).toContain("octo-daemon runtime list --output json");
    expect(p).toContain("octo-daemon agent create --name");
    expect(p).toContain("octo-daemon agent get <agent-id> --output json");
    // both CLIs installed, both authed, both authoritative manuals
    expect(p).toContain("npm install -g @mininglamp-oss/octo-cli@latest");
    expect(p).toContain(
      "curl -fsSL https://codex.mlamp.cn/0000109/octo-daemon-publish/-/raw/main/install.js | node"
    );
    expect(p).toContain("octo-cli skills octo-marketplace");
    expect(p).toContain("octo-daemon builtin-skills show octo-loop");
  });

  it("squad prompt fetches members from marketplace and rebuilds leader + members in loop", () => {
    const p = buildExpertPrompt(squad, { spaceId: SPACE, apiBaseUrl: API });
    expect(p).toContain("octo-cli marketplace squad get growth-squad");
    expect(p).toContain(
      "octo-cli marketplace squad skill-download growth-squad --member <member_key> --index <i>"
    );
    expect(p).toContain("octo-daemon squad create --name");
    expect(p).toContain("octo-daemon squad member add <squad-id> --member-id <agent-id>");
    expect(p).toContain("octo-daemon squad get <squad-id> --output json");
  });

  it("embeds the marketplace space id + api base url into the octo-cli auth example", () => {
    const p = buildExpertPrompt(agent, { spaceId: SPACE, apiBaseUrl: API });
    expect(p).toContain(`--space ${SPACE}`);
    expect(p).toContain(`--profile space-${SPACE}`);
    expect(p).toContain(`--api-base-url ${API}`);
  });

  it("drops the stale prototype fiction (regression guard)", () => {
    for (const item of [agent, squad]) {
      const p = buildExpertPrompt(item, { spaceId: SPACE, apiBaseUrl: API });
      expect(p).not.toContain("squadTemplateId");
      expect(p).not.toContain("templateId");
      expect(p).not.toContain("create_local_copy");
      expect(p).not.toContain("SquadInstallPlan");
      expect(p).not.toContain("Octo Marketplace Installer");
    }
  });

  it("has a confirm gate and token guard, and ends with the authoritative-inputs footer", () => {
    const p = buildExpertPrompt(squad, { spaceId: SPACE, apiBaseUrl: API });
    expect(p).toContain("确认安装");
    expect(p).toContain("不得输出 Token");
    expect(p).toMatch(/是本次操作的权威输入。$/);
  });

  it("falls back to placeholders for a poisoned space id / missing api url / unsafe id", () => {
    const p = buildExpertPrompt(
      { ...agent, id: "$(whoami)" },
      { spaceId: "; rm -rf /", apiBaseUrl: "" }
    );
    expect(p).not.toContain("$(whoami)");
    expect(p).not.toContain("; rm -rf /");
    expect(p).toContain("<space-id>");
    expect(p).toContain("<api-base-url>");
    expect(p).toContain("<expert-id>");
  });
});
