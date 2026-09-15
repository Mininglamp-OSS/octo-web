import { describe, expect, it } from "vitest";
import { getExpertBotPublishPrompt } from "./expertBotPublishPrompt";

const SLUG = "minglue_default";
const API = "https://example.com";

describe("getExpertBotPublishPrompt — command surface", () => {
  it("agent prompt targets the unified expert plugin workflow", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("将指定专家上架");
    expect(p).toContain(
      "octo-cli marketplace plugin-category list --scene-code default --plugin-type expert"
    );
    expect(p).toContain('plugin_type: "expert"');
    expect(p).toContain("plugin upsert --data @expert-plugin.json");
    expect(p).toContain("plugin review-request create");
    expect(p).toContain("审核 payload 的文件名与结构以 `expert.md` 为准");
    expect(p).toContain(
      "octo-cli marketplace plugin get --plugin-id <plugin-id>"
    );
  });

  it("squad prompt targets the unified expert_team plugin workflow", () => {
    const p = getExpertBotPublishPrompt({
      kind: "squad",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("将指定专家团上架");
    expect(p).toContain(
      "octo-cli marketplace plugin-category list --scene-code default --plugin-type expert_team"
    );
    expect(p).toContain('plugin_type: "expert_team"');
    expect(p).toContain("plugin upsert --data @team-plugin.json");
    expect(p).toContain(
      "准备完整的 `manifest_json`、`plugin_json` 和完整 `relations`"
    );
  });

  it("defers to the embedded octo-marketplace Skill's expert.md", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("octo-cli skills octo-marketplace --profile <profile>");
    expect(p).toContain("`expert.md`");
    expect(p).toContain("确认当前版本 `>= 0.15.0`");
    expect(p).toContain("按 major/minor/patch 分段数字比较");
    expect(p).toContain("版本低于 `0.15.0`");
    expect(p).toContain('npm install -g "@mininglamp-oss/octo-cli@>=0.15.0"');
    expect(p).not.toContain("@mininglamp-oss/octo-cli@'>=0.15.0'");
    expect(p).not.toContain("@mininglamp-oss/octo-cli@^0.15.0");
    expect(p).not.toContain("@mininglamp-oss/octo-cli@latest");
    expect(p).toContain("先询问用户是否更新/安装 `octo-cli`");
    expect(p).toContain("重新运行");
    expect(p).toContain("给出可复制的安装命令");
    expect(p).toContain("用户未确认时停止");
  });

  it.each(["agent", "squad"] as const)(
    "%s prompt drops the stale prototype commands (regression guard)",
    (kind) => {
      const p = getExpertBotPublishPrompt({
        kind,
        spaceId: SLUG,
        apiBaseUrl: API,
      });
      // The prompt may mention created_by_type only to say "don't send it";
      // guard against the nonexistent flag form the prototype prompt used.
      expect(p).toContain("不需要也不要传 `created_by_type`");
      expect(p).not.toContain("--created-by-type");
      expect(p).not.toContain("@submission.json");
      expect(p).not.toContain("validate");
      expect(p).not.toContain("expert search");
      expect(p).not.toContain("squad-category");
      expect(p).not.toContain("expertTemplateId");
      expect(p).not.toContain("octo-cli marketplace expert-category");
      expect(p).not.toContain("octo-cli marketplace expert create");
      expect(p).not.toContain("octo-cli marketplace expert update");
      expect(p).not.toContain("octo-cli marketplace expert get");
      expect(p).not.toContain("octo-cli marketplace squad create");
      expect(p).not.toContain("octo-cli marketplace squad update");
      expect(p).not.toContain("octo-cli marketplace squad get");
      expect(p).not.toContain("octo-cli marketplace expert-skill-upload");
      expect(p).not.toContain("upload_object_key");
    }
  );
});

describe("getExpertBotPublishPrompt — shell-safe interpolation", () => {
  it.each(["agent", "squad"] as const)(
    "%s embeds a readable slug spaceId verbatim into the login example",
    (kind) => {
      const p = getExpertBotPublishPrompt({
        kind,
        spaceId: SLUG,
        apiBaseUrl: API,
      });
      expect(p).toContain(`--profile space-${SLUG}`);
      expect(p).toContain(`--space ${SLUG}`);
      expect(p).toContain(API);
    }
  );

  it("embeds a compact 32-hex spaceId verbatim", () => {
    const hex = "9f5fda183d94482cb49bca5024439105";
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: hex,
      apiBaseUrl: API,
    });
    expect(p).toContain(`--space ${hex}`);
  });

  it.each([
    "$(whoami)",
    "; rm -rf /",
    "`whoami`",
    "|| cat /etc/passwd",
    "a b",
    "",
  ])(
    "substitutes the <space-id> placeholder for injection payload %j",
    (payload) => {
      const p = getExpertBotPublishPrompt({
        kind: "agent",
        spaceId: payload,
        apiBaseUrl: API,
      });
      expect(p).not.toContain(payload || "__unreachable__");
      expect(p).toContain("--profile space-<space-id>");
      expect(p).toContain("--space <space-id>");
    }
  );

  it("uses the placeholder when apiBaseUrl is empty", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: "",
    });
    expect(p).toContain("<api-base-url>");
  });

  it("carries the 'do not output token' guard verbatim", () => {
    const p = getExpertBotPublishPrompt({
      kind: "squad",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("不得输出 Token");
  });

  it("ends with the authoritative-inputs footer", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toMatch(/以上 Space ID 和 API 地址是本次操作的权威输入。$/);
  });
});

describe("getExpertBotPublishPrompt — update mode", () => {
  const ID = "a6634f22-c51e-4be3-a4d7-4c2279782491";

  it("agent update targets the update verb with the id and reads it back", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      mode: "update",
      id: ID,
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("更新 OCTO Marketplace 上已上架的专家");
    expect(p).toContain(`专家 ID：\`${ID}\``);
    expect(p).toContain(`plugin.plugin_id = "${ID}"`);
    expect(p).toContain(
      `octo-cli marketplace plugin get --plugin-id ${ID} --include-relations`
    );
    expect(p).toContain("全量替换语义");
    expect(p).toContain(
      "`plugin_name` / `publisher` / `icon` / `tags` / `visibility` / `category_id`"
    );
    expect(p).toContain("`relation_id` 和 `data`");
    expect(p).toContain("未上架的 Space 可见记录");
    expect(p).toContain("任何 409");
    expect(p).toContain("`listed_requires_review` / `review_pending`");
    expect(p).toContain("plugin review-request create");
    expect(p).toContain("不要引用未在本流程中实际生成的文件");
    expect(p).toContain("不要把展示用的 `icon_url` 写回");
    expect(p).toContain("不要伪造成功");
    expect(p).toContain("可重试命令和错误摘要");
    expect(p).toContain("确认更新");
    // Must NOT fall back to retired per-type verbs.
    expect(p).not.toContain("expert update");
    expect(p).not.toContain("expert create --data");
    expect(p).not.toContain("确认上架");
  });

  it.each([
    ["agent", "create", "确认上架"],
    ["agent", "update", "确认更新"],
    ["squad", "create", "确认上架"],
    ["squad", "update", "确认更新"],
  ] as const)(
    "places every %s %s write command after the explicit confirmation gate",
    (kind, mode, confirmation) => {
      const p = getExpertBotPublishPrompt({
        kind,
        mode,
        id: ID,
        spaceId: SLUG,
        apiBaseUrl: API,
      });
      const gateIndex = p.indexOf(`明确等待我回复“${confirmation}”`);
      expect(gateIndex).toBeGreaterThan(-1);
      expect(p).toContain("将要新建或覆盖的每个 skill plugin");
      expect(p.match(/plugin import/g)).toHaveLength(1);

      const mutatingCommands = [
        "plugin import",
        "plugin upsert",
        "plugin publish",
        "plugin review-request create",
        "plugin review-request cancel",
        "plugin delete",
      ];
      for (const command of mutatingCommands) {
        const commandIndex = p.indexOf(command);
        if (commandIndex !== -1) {
          expect(commandIndex).toBeGreaterThan(gateIndex);
        }
      }
    }
  );

  it("documents normalized secret placeholders and presigned upload secrecy", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("非字母数字字符替换为 `_`");
    expect(p).toContain("header `Authorization`");
    expect(p).toContain("${AUTHORIZATION}");
    expect(p).toContain("`X-Api-Secret` 写 `${X_API_SECRET}`");
    expect(p).toContain("不得输出 `presigned_url` / `method` / `headers`");
    expect(p).toContain("不得写入 payload 文件");
    expect(p).toContain("键 `TOKEN` 配 `${GITHUB_TOKEN}`");
    expect(p).toContain("规范化键名占位 `${TOKEN}`");
  });

  it("squad update targets the squad update verb with the id", () => {
    const p = getExpertBotPublishPrompt({
      kind: "squad",
      mode: "update",
      id: ID,
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("更新 OCTO Marketplace 上已上架的专家团");
    expect(p).toContain(`专家团 ID：\`${ID}\``);
    expect(p).toContain(`plugin.plugin_id = "${ID}"`);
    expect(p).toContain(
      `octo-cli marketplace plugin get --plugin-id ${ID} --include-relations`
    );
    expect(p).toContain("缺失关系会被软删");
    expect(p).not.toContain("squad create --data");
  });

  it("substitutes the id placeholder for an injection payload", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      mode: "update",
      id: "; rm -rf /",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).not.toContain("; rm -rf /");
    expect(p).toContain('plugin.plugin_id = "<expert-id>"');
    expect(p).toContain("plugin get --plugin-id <expert-id>");
  });

  it("create mode (default) is unchanged", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("将指定专家上架");
    expect(p).toContain("plugin upsert --data @expert-plugin.json");
    expect(p).toContain(
      "只有在 `expert.md` 要求且版本来源明确时才传 `--version`"
    );
    expect(p).not.toContain("octo-cli marketplace expert update");
    expect(p).not.toContain("确认更新");
  });

  it("keeps update version omitted and uses a copyable upsert command", () => {
    const p = getExpertBotPublishPrompt({
      kind: "agent",
      mode: "update",
      id: ID,
      spaceId: SLUG,
      apiBaseUrl: API,
    });
    expect(p).toContain("`version` 保持省略");
    expect(p).toContain("plugin upsert --data @expert-plugin.json");
  });
});
