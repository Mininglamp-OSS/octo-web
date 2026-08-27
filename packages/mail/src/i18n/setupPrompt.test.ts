import { describe, expect, it } from "vitest";
import enUS from "./en-US.json";
import zhCN from "./zh-CN.json";

describe("Agent Mail setup prompt", () => {
  it.each([zhCN, enUS])(
    "provides the public ClawHub install and binding commands without credentials or internal tools",
    (messages) => {
      const prompt = messages["mail.agentMailboxes.setupPrompt"];
      expect(prompt).toContain("{{address}}");
      expect(prompt).toContain("{{spaceId}}");
      expect(prompt).toContain(
        "openclaw plugins install clawhub:openclaw-octo-mail-plugin"
      );
      expect(prompt).toContain("openclaw octo-mail setup");
      expect(prompt).toContain("openclaw octo-mail bind");
      expect(prompt).toContain("--space-id {{spaceId}}");
      expect(prompt).toMatch(/<agent标识>|<agent-id>/);
      expect(prompt).not.toContain("octo-cli");
      expect(prompt).not.toContain("npx");
      expect(prompt).not.toContain("mail_connect");
      expect(prompt).not.toContain("mail_connection_status");
      expect(prompt).not.toContain("Bot ID");
      expect(prompt).not.toContain("omb_");
      expect(prompt).not.toContain("--bot-token");
      expect(prompt).not.toContain("--api-url");
      expect(prompt).toMatch(/请帮我把邮箱|Please connect mailbox/);
      expect(prompt).toContain("/install");
    }
  );

  it.each([zhCN, enUS])(
    "provides the official CLI installation, identity check, and mailbox authorization prompt",
    (messages) => {
      const prompt = messages["mail.agentMailboxes.cliSetupPrompt"];
      expect(prompt).toContain("{{address}}");
      expect(prompt).toContain("{{spaceId}}");
      expect(prompt).toContain(
        "npm install -g @mininglamp-oss/octo-cli@latest"
      );
      expect(prompt).toContain("octo-cli skills octo-mail");
      expect(prompt).toContain("octo-cli mail auth status");
      expect(prompt).toMatch(
        /octo-cli --space \{\{spaceId\}\} mail auth login --mailbox \{\{address\}\}/
      );
      expect(prompt).not.toContain("--bot-id");
      expect(prompt).not.toContain("openclaw plugins install");
      expect(messages["mail.agentMailboxes.cliSkillGuide"]).toMatch(
        /octo-mail Skill/
      );
    }
  );

  it.each([zhCN, enUS])(
    "describes automatic completion without implementation details",
    (messages) => {
      const description = messages["mail.authorization.connectingDescription"];
      expect(description).not.toContain("mail_connection_status");
      expect(description).not.toContain("octo-cli");
      expect(description).toMatch(
        /完成邮箱接入|Finishing the mailbox connection/
      );
    }
  );

  it("asks the Agent to state unsupported capability directly", () => {
    expect(zhCN["mail.agentMailboxes.setupPrompt"]).toContain("请直接说明");
    expect(enUS["mail.agentMailboxes.setupPrompt"]).toContain(
      "tell me directly"
    );
  });

  it.each([zhCN, enUS])(
    "describes the automatic-send boundary on the authorization page",
    (messages) => {
      expect(messages["mail.authorization.permissionLegend"]).toBeTruthy();
      expect(messages["mail.authorization.manualReviewTitle"]).toBeTruthy();
      expect(messages["mail.authorization.manualReviewDescription"]).toMatch(
        /人工确认|require your confirmation/
      );
      expect(messages["mail.authorization.automaticSendTitle"]).toBeTruthy();
      expect(messages["mail.authorization.automaticSendDescription"]).toMatch(
        /主动发送纯文本邮件|send plain-text messages/
      );
      expect(messages["mail.authorization.automaticSendEnabled"]).toBeTruthy();
    }
  );
});
