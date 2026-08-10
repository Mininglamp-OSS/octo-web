// Install-prompt generation for the Expert Marketplace, ported from the HTML
// prototype's buildPrompt(). The whole point of the marketplace is "copy the
// prompt, hand it to an Agent" — same mental model as MCP / Skill install —
// so these strings are the actual product, not throwaway UI copy. Keep the
// wording in sync with the prototype unless product intentionally changes it.

import { DEFAULT_STRATEGIES } from "../mock/expertMock";
import type { ExpertAgent, ExpertItem, ExpertSquad } from "../mock/expertMock";

function buildAgentPrompt(item: ExpertAgent): string {
  return [
    "请帮我在当前 Octo Loop 空间创建一个专家。",
    "",
    `专家名称：${item.name}`,
    `目标：${item.summary}`,
    `擅长领域：${item.tags.join("、")}`,
    "",
    "请先展示专家的角色说明、工作边界和验收标准；我确认后再创建。",
  ].join("\n");
}

function buildSquadPrompt(item: ExpertSquad): string {
  const memberPlans = item.members.map((member, index) => ({
    ...member,
    key: member.key || `member_${String(index + 1).padStart(2, "0")}`,
    templateId: member.templateId || `expert-${item.id}-${String(index + 1).padStart(2, "0")}`,
  }));

  const leader = memberPlans.find((member) => member.leader) || memberPlans[0];
  // memberPlans is empty when the detail/install modal renders optimistically
  // with a squad LIST item (members hydrate a moment later), so `leader` can be
  // undefined — guard it so prompt generation never throws on an empty roster.
  const leaderKey = leader?.key ?? "leader";
  const leaderName = leader?.name ?? item.leader ?? "Leader";

  const members = memberPlans.flatMap((member, index) => [
    `${index + 1}. memberKey: ${member.key}`,
    `   templateId: ${member.templateId}`,
    `   displayName: ${member.name}${member.leader ? "（Leader）" : ""}`,
    `   role: ${member.role}`,
    "   installPolicy: create_local_copy",
  ]);

  const strategies = (item.strategies || DEFAULT_STRATEGIES).map(
    (strategy, index) => `${index + 1}. ${strategy}`
  );

  return [
    "请作为 Octo Marketplace Installer，在当前 Loop 空间安装并配置下面的专家团。",
    "把“安装专家”和“配置专家调取逻辑”作为同一个原子事务执行；不要让我逐个安装成员。",
    "",
    "【目标】",
    `- squadTemplateId: ${item.id}`,
    `- name: ${item.name}`,
    `- goal: ${item.summary}`,
    "- targetWorkspace: 当前 Loop 空间",
    "",
    "【阶段 A｜安装专家】",
    "按以下固定模板创建本地专家副本。不得按同名专家模糊匹配，也不得静默复用已有实例。",
    ...members,
    "",
    "每创建一位专家，记录 memberKey -> agentId；全部成功后才能进入阶段 B。",
    "",
    "【阶段 B｜配置专家调取逻辑】",
    `- entrypoint: ${leaderKey}（${leaderName}）`,
    "- contextPolicy: 所有成员共享目标、约束和上游产物；只向成员追加其当前任务所需上下文。",
    "- returnPolicy: 所有成员结果先回传 Leader，不允许成员绕过 Leader 直接提交最终答案。",
    "- routingRules:",
    ...strategies,
    "",
    "【闸门与失败处理】",
    "- 创建前先校验模板、依赖、权限以及成员间输入输出是否可连接。",
    "- 关键方案与最终交付保留人工确认；未确认不得继续执行高风险动作。",
    "- 单个成员失败时按路由规则重试或退回；超过上限后暂停并报告，不得假装成功。",
    "- 任一专家、关系或调度规则创建失败，回滚本次新建的全部专家实例和专家团配置。",
    "",
    "【执行协议】",
    "1. 现在只生成 SquadInstallPlan 预览：专家模板、预计创建的本地副本、Leader、调度节点、串并行关系、闸门、失败回退、依赖与权限。",
    "2. 等我回复“确认安装”后再执行。",
    "3. 确认后先创建专家副本并取得 agentId，再把 agentId 绑定到 dispatch 节点，最后创建 Squad 实体和 Leader/成员关系。",
    "4. 校验所有 memberKey 都已绑定 agentId、调度图无孤立节点且入口可达，然后一次性提交。",
    "5. 完成后返回 squadId、memberKey -> agentId 映射、已生效的调度摘要和回滚结果（如有）。",
  ].join("\n");
}

/** Build the copy-to-Agent install prompt for an expert or expert squad. */
export function buildExpertPrompt(item: ExpertItem): string {
  return item.kind === "agent" ? buildAgentPrompt(item) : buildSquadPrompt(item);
}
