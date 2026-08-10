import { describe, expect, it } from "vitest";
import {
  getLoopBotPublishPrompt,
  resolveLoopServerUrl,
} from "./loopBotPublishPrompt";

const WS = "minglue_default";
const SERVER = "https://im.deepminer.com.cn";

describe("getLoopBotPublishPrompt — command surface (octo-daemon, not octo-cli)", () => {
  it("agent prompt targets octo-daemon agent verbs + runtime + skills", () => {
    const p = getLoopBotPublishPrompt({ kind: "agent", workspaceId: WS, serverUrl: SERVER });
    expect(p).toContain("将指定专家创建到 Loop 工作区");
    expect(p).toContain("octo-daemon runtime list --output json");
    expect(p).toContain("octo-daemon agent create --name");
    expect(p).toContain("--runtime-id");
    expect(p).toContain("octo-daemon agent get <agent-id> --output json");
    expect(p).toContain("--mcp-config-stdin");
  });

  it("squad prompt references existing agents (leader + member add), not inline members", () => {
    const p = getLoopBotPublishPrompt({ kind: "squad", workspaceId: WS, serverUrl: SERVER });
    expect(p).toContain("将指定专家团创建到 Loop 工作区");
    expect(p).toContain("octo-daemon squad create --name");
    expect(p).toContain("--leader");
    expect(p).toContain("octo-daemon squad member add <squad-id> --member-id <agent-id>");
    expect(p).toContain("octo-daemon squad get <squad-id> --output json");
  });

  it("defers to the bundled octo-loop skill and uses the codex installer", () => {
    const p = getLoopBotPublishPrompt({ kind: "agent", workspaceId: WS, serverUrl: SERVER });
    expect(p).toContain("octo-daemon builtin-skills show octo-loop");
    expect(p).toContain(
      "curl -fsSL https://codex.mlamp.cn/0000109/octo-daemon-publish/-/raw/main/install.js | node"
    );
    expect(p).toContain("octo-daemon login --token");
  });

  it.each(["agent", "squad"] as const)(
    "%s prompt does not leak marketplace/octo-cli commands (regression guard)",
    (kind) => {
      const p = getLoopBotPublishPrompt({ kind, workspaceId: WS, serverUrl: SERVER });
      expect(p).not.toContain("octo-cli");
      expect(p).not.toContain("marketplace");
      expect(p).not.toContain("--space ");
      expect(p).not.toContain("expert-category");
      expect(p).not.toContain("--data @");
    }
  );
});

describe("getLoopBotPublishPrompt — shell-safe interpolation", () => {
  it.each(["agent", "squad"] as const)(
    "%s embeds a readable slug workspaceId + server origin verbatim",
    (kind) => {
      const p = getLoopBotPublishPrompt({ kind, workspaceId: WS, serverUrl: SERVER });
      expect(p).toContain(`workspace switch ${WS}`);
      expect(p).toContain(`--server-url ${SERVER}`);
    }
  );

  it("embeds a UUID workspaceId verbatim", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const p = getLoopBotPublishPrompt({ kind: "agent", workspaceId: uuid, serverUrl: SERVER });
    expect(p).toContain(`workspace switch ${uuid}`);
  });

  it.each([
    "$(whoami)",
    "; rm -rf /",
    "`whoami`",
    "a b",
    "",
  ])("substitutes <workspace-id> for injection payload %j", (payload) => {
    const p = getLoopBotPublishPrompt({ kind: "agent", workspaceId: payload, serverUrl: SERVER });
    expect(p).not.toContain(payload || "__unreachable__");
    expect(p).toContain("workspace switch <workspace-id>");
  });

  it("normalizes the server URL to its origin (drops path/query)", () => {
    const p = getLoopBotPublishPrompt({
      kind: "agent",
      workspaceId: WS,
      serverUrl: "https://im.deepminer.com.cn/some/path?x=1",
    });
    expect(p).toContain("--server-url https://im.deepminer.com.cn");
    expect(p).not.toContain("/some/path");
  });

  it.each([
    "not a url",
    "ftp://x",
    "https://x;rm -rf /",
    "",
  ])("substitutes <server-url> for unsafe/invalid server %j", (bad) => {
    const p = getLoopBotPublishPrompt({ kind: "agent", workspaceId: WS, serverUrl: bad });
    expect(p).toContain("--server-url <server-url>");
  });

  it("carries the token guard and authoritative-inputs footer", () => {
    const p = getLoopBotPublishPrompt({ kind: "squad", workspaceId: WS, serverUrl: SERVER });
    expect(p).toContain("不得输出 Token");
    expect(p).toMatch(/以上 Server URL 和 Workspace ID 是本次操作的权威输入。$/);
  });
});

describe("resolveLoopServerUrl", () => {
  it("returns the origin of an absolute https URL", () => {
    expect(resolveLoopServerUrl("https://api.example.com/v1")).toBe("https://api.example.com");
  });
  it("returns '' for empty / non-http / unsafe input", () => {
    expect(resolveLoopServerUrl("")).toBe("");
    expect(resolveLoopServerUrl("ftp://x")).toBe("");
    expect(resolveLoopServerUrl("not a url")).toBe("");
  });
});
