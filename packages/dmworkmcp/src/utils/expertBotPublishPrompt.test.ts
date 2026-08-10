import { describe, expect, it } from "vitest";
import { getExpertBotPublishPrompt } from "./expertBotPublishPrompt";

const SLUG = "minglue_default";
const API = "https://example.com";

describe("getExpertBotPublishPrompt — command surface", () => {
  it("agent prompt targets the expert verbs and taxonomy", () => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: SLUG, apiBaseUrl: API });
    expect(p).toContain("将指定专家上架");
    expect(p).toContain("octo-cli marketplace expert-category list --kind agent");
    expect(p).toContain("octo-cli marketplace expert create --data @expert.json");
    expect(p).toContain("octo-cli marketplace expert get <expert-id>");
    // Whole-package skill upload flow is spelled out for a single expert.
    expect(p).toContain("octo-cli marketplace expert-skill-upload create");
    expect(p).toContain("upload_object_key");
  });

  it("squad prompt targets the squad verbs and inline members", () => {
    const p = getExpertBotPublishPrompt({ kind: "squad", spaceId: SLUG, apiBaseUrl: API });
    expect(p).toContain("将指定专家团上架");
    expect(p).toContain("octo-cli marketplace expert-category list --kind squad");
    expect(p).toContain("octo-cli marketplace squad create --data @squad.json");
    expect(p).toContain("octo-cli marketplace squad get <squad-id>");
    // Members are inline in the body, not template references.
    expect(p).toContain("member_key");
    expect(p).toContain("is_leader=true");
  });

  it("defers to the embedded octo-marketplace Skill's expert.md", () => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: SLUG, apiBaseUrl: API });
    expect(p).toContain("octo-cli skills octo-marketplace --profile <profile>");
    expect(p).toContain("`expert.md`");
  });

  it.each(["agent", "squad"] as const)(
    "%s prompt drops the stale prototype commands (regression guard)",
    (kind) => {
      const p = getExpertBotPublishPrompt({ kind, spaceId: SLUG, apiBaseUrl: API });
      expect(p).not.toContain("--version");
      // The prompt mentions created_by_type only to say "don't send it"; guard
      // against the nonexistent flag form the prototype prompt used.
      expect(p).not.toContain("--created-by-type");
      expect(p).not.toContain("validate");
      expect(p).not.toContain("expert search");
      expect(p).not.toContain("squad-category");
      expect(p).not.toContain("expertTemplateId");
    }
  );
});

describe("getExpertBotPublishPrompt — shell-safe interpolation", () => {
  it.each(["agent", "squad"] as const)(
    "%s embeds a readable slug spaceId verbatim into the login example",
    (kind) => {
      const p = getExpertBotPublishPrompt({ kind, spaceId: SLUG, apiBaseUrl: API });
      expect(p).toContain(`--profile space-${SLUG}`);
      expect(p).toContain(`--space ${SLUG}`);
      expect(p).toContain(API);
    }
  );

  it("embeds a compact 32-hex spaceId verbatim", () => {
    const hex = "9f5fda183d94482cb49bca5024439105";
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: hex, apiBaseUrl: API });
    expect(p).toContain(`--space ${hex}`);
  });

  it.each([
    "$(whoami)",
    "; rm -rf /",
    "`whoami`",
    "|| cat /etc/passwd",
    "a b",
    "",
  ])("substitutes the <space-id> placeholder for injection payload %j", (payload) => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: payload, apiBaseUrl: API });
    expect(p).not.toContain(payload || "__unreachable__");
    expect(p).toContain("--profile space-<space-id>");
    expect(p).toContain("--space <space-id>");
  });

  it("uses the placeholder when apiBaseUrl is empty", () => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: SLUG, apiBaseUrl: "" });
    expect(p).toContain("<api-base-url>");
  });

  it("carries the 'do not output token' guard verbatim", () => {
    const p = getExpertBotPublishPrompt({ kind: "squad", spaceId: SLUG, apiBaseUrl: API });
    expect(p).toContain("不得输出 Token");
  });

  it("ends with the authoritative-inputs footer", () => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: SLUG, apiBaseUrl: API });
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
    expect(p).toContain(`octo-cli marketplace expert update ${ID} --data @expert.json`);
    expect(p).toContain(`octo-cli marketplace expert get ${ID}`);
    expect(p).toContain("确认更新");
    // Must NOT fall back to the create verb.
    expect(p).not.toContain("expert create --data");
    expect(p).not.toContain("确认上架");
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
    expect(p).toContain(`octo-cli marketplace squad update ${ID} --data @squad.json`);
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
    expect(p).toContain("expert update <expert-id> --data @expert.json");
  });

  it("create mode (default) is unchanged", () => {
    const p = getExpertBotPublishPrompt({ kind: "agent", spaceId: SLUG, apiBaseUrl: API });
    expect(p).toContain("将指定专家上架");
    expect(p).toContain("octo-cli marketplace expert create --data @expert.json");
    expect(p).not.toContain("update");
  });
});
