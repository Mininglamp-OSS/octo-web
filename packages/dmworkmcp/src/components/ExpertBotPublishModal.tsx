import React, { useEffect, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { copyToClipboard, t, useI18n, WKButton, WKModal } from "@octo/base";
import { EXPERT_WORKSPACE } from "../mock/expertMock";

interface ExpertBotPublishModalProps {
  visible: boolean;
  /** Which catalog the Bot prompt targets: single expert or a squad. */
  kind: "agent" | "squad";
  onClose: () => void;
  onToast: (message: string) => void;
}

// The squad-publishing prompt handed to an Agent, ported from the prototype's
// botPublishPrompt. This is the "publish via Bot" counterpart to the install
// prompt — same copy-to-Agent model as MCP / Skill publishing.
function buildSquadBotPublishPrompt(): string {
  return [
    "请作为 Octo Marketplace 专家团上架助手，帮我把一组专家和专家调取逻辑发布成一个可复用的专家团模板。",
    "",
    "【目标空间】",
    `- workspace: ${EXPERT_WORKSPACE}`,
    "- source: 优先读取我随后提供的 squad.json / squad.yaml；如果没有文件，就在对话中逐项收集。",
    "",
    "【必须同时包含】",
    "1. 专家成员：每位成员必须使用准确的 expertTemplateId 和 version，标明角色，并且只能有一位 Leader。",
    "2. 调取逻辑：必须包含 entrypoint、routingMode、routingRules、contextPolicy、returnPolicy、humanGates 和 failurePolicy。",
    "专家成员与调取逻辑属于同一个 Manifest 和同一个版本，不允许拆成两次上架。",
    "",
    "【执行步骤】",
    "1. 运行 `octo-cli marketplace squad-category list` 获取有效分类。",
    "2. 用 `octo-cli marketplace expert search --query <关键词>` 查找成员，再用 `octo-cli marketplace expert get <template-id> --version <version>` 锁定准确版本；不要按名称猜测或静默替换。",
    "3. 收集名称、简介、分类、标签、版本、更新说明、成员角色、Leader、路由规则、重试次数、失败策略和人工闸门。信息不完整时先向我提问。",
    "4. 生成完整的 `squad.json`，其中成员与 orchestrationSpec 必须在同一个对象内。",
    "5. 运行 `octo-cli marketplace squad validate --data @squad.json`。若有错误，修正后重新校验；不得跳过。",
    "6. 向我展示发布预览：基础信息、固定版本成员、Leader、调取顺序、人工闸门、失败处理和最终 Manifest。",
    "7. 到这里暂停，明确等待我回复“确认上架”。未收到这四个字，不得创建或修改市场数据。",
    "8. 确认后运行 `octo-cli marketplace squad create --data @squad.json --created-by-type bot`。访问令牌只能通过 stdin 或安全凭据读取，不得写入文件或输出到对话。",
    "9. 用 `octo-cli marketplace squad get <squad-id> --version <version>` 回读核验，并返回 squadId、version、成员版本锁、调取逻辑摘要和上架结果。",
    "",
    "【失败规则】",
    "- 任一专家不存在、版本不可用、入口不可达或路由形成非法循环时，停止上架并告诉我如何修正。",
    "- 创建失败时不要伪造成功；保留本地 Manifest，并返回可重试的命令和错误摘要。",
  ].join("\n");
}

// Single-expert publishing prompt — the 专家 counterpart to the squad prompt
// above. No members / dispatch logic; just one reusable expert template.
function buildAgentBotPublishPrompt(): string {
  return [
    "请作为 Octo Marketplace 专家上架助手，帮我把一个专家发布成可复用的专家模板。",
    "",
    "【目标空间】",
    `- workspace: ${EXPERT_WORKSPACE}`,
    "- source: 优先读取我随后提供的 expert.json / expert.yaml；如果没有文件，就在对话中逐项收集。",
    "",
    "【必须包含】",
    "- 名称、简介、分类、标签、版本、更新说明。",
    "- 角色说明（system prompt）、擅长领域、工作边界与验收标准，以及所需权限。",
    "",
    "【执行步骤】",
    "1. 运行 `octo-cli marketplace expert-category list` 获取有效分类。",
    "2. 收集上述字段；信息不完整时先向我提问，不要按名称猜测或静默替换。",
    "3. 生成完整的 `expert.json`。",
    "4. 运行 `octo-cli marketplace expert validate --data @expert.json`。若有错误，修正后重新校验；不得跳过。",
    "5. 向我展示发布预览：基础信息、角色说明、工作边界、验收标准与所需权限。",
    "6. 到这里暂停，明确等待我回复“确认上架”。未收到这四个字，不得创建或修改市场数据。",
    "7. 确认后运行 `octo-cli marketplace expert create --data @expert.json --created-by-type bot`。访问令牌只能通过 stdin 或安全凭据读取，不得写入文件或输出到对话。",
    "8. 用 `octo-cli marketplace expert get <expert-id> --version <version>` 回读核验，并返回 expertId、version 和上架结果。",
    "",
    "【失败规则】",
    "- 分类无效、版本不可用或校验失败时，停止上架并告诉我如何修正。",
    "- 创建失败时不要伪造成功；保留本地 Manifest，并返回可重试的命令和错误摘要。",
  ].join("\n");
}

/** "Publish via Bot" — copy a prompt that instructs an Agent to publish. */
export default function ExpertBotPublishModal({
  visible,
  kind,
  onClose,
  onToast,
}: ExpertBotPublishModalProps) {
  useI18n();
  const [copied, setCopied] = useState(false);
  const prompt =
    kind === "squad"
      ? buildSquadBotPublishPrompt()
      : buildAgentBotPublishPrompt();

  useEffect(() => {
    if (visible) setCopied(false);
  }, [visible]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(prompt);
    onToast(ok ? t("mcp.expert.copied") : t("mcp.expert.copyFailed"));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const header = (
    <div className="wk-mcp-expert-botpub__header">
      <span className="wk-mcp-expert-botpub__icon" aria-hidden="true">
        <Bot size={18} />
      </span>
      <div>
        <h2>
          {kind === "squad"
            ? t("mcp.expert.botPublishTitle")
            : t("mcp.expert.botPublishTitleAgent")}
        </h2>
        <p>{t("mcp.expert.botPublishHint")}</p>
      </div>
    </div>
  );

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      width="min(720px, calc(100vw - 32px))"
      className="wk-mcp-expert-botpub"
      header={header}
    >
      <pre className="wk-mcp-expert-prompt__preview wk-mcp-expert-botpub__preview">{prompt}</pre>
      <div className="wk-mcp-expert-botpub__footer">
        <WKButton
          variant="primary"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopy}
        >
          {copied ? t("mcp.expert.copied") : t("mcp.expert.copyPrompt")}
        </WKButton>
      </div>
    </WKModal>
  );
}
