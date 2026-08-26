import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { i18n, I18nProvider } from "@octo/base";
import enUS from "../../i18n/en-US.json";
import zhCN from "../../i18n/zh-CN.json";
import SummaryWorkbench from ".";
import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchActions,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextItem,
  SummaryWorkbenchContextKind,
  SummaryWorkbenchMessageView,
  SummaryWorkbenchViewState,
} from "./types";

i18n.registerNamespace("summary", {
  "zh-CN": zhCN,
  "en-US": enUS,
});

const noop = () => undefined;

const staticActions: SummaryWorkbenchActions = {
  onInputChange: noop,
  onSend: noop,
  onOpenContext: noop,
  onRemoveContext: noop,
  onResultAction: noop,
};

const selectedChat: SummaryWorkbenchContextItem = {
  id: "chat-product-weekly",
  kind: "chat",
  label: "产品研发周会群",
};

const selectedTemplate: SummaryWorkbenchContextItem = {
  id: "template-weekly",
  kind: "template",
  label: "项目周报",
};

const selectedTimeRange: SummaryWorkbenchContextItem = {
  id: "range-this-week",
  kind: "time_range",
  label: "本周一至今天",
};

const selectedParticipants: SummaryWorkbenchContextItem[] = [
  {
    id: "participant-lin",
    kind: "participant",
    label: "林晓",
  },
  {
    id: "participant-chen",
    kind: "participant",
    label: "陈远",
  },
];

const initialState: SummaryWorkbenchViewState = {
  layout: "full",
  messages: [],
  contextItems: [],
  inputValue: "",
  placeholderKey: "summary.workbench.placeholder.initial",
  isSending: false,
  canSend: false,
};

const previewContent = `## 本周项目进展

- 统一智能总结入口的交互方案已确认，前后端进入双轨开发。
- 快速总结在用户明确选择会话与模板后直接生成正式总结。
- 自由对话由 Agent 生成可迭代预览，只有预览与修订版本允许保存。

## 风险与下一步

1. 等待多人总结后端依赖合并后接入真实工作流。
2. 补充埋点，验证三种路由的识别准确率。`;

const longPreviewContent = Array.from(
  { length: 8 },
  (_, index) => `## 主题 ${index + 1}

这是用于验证长内容滚动、段落换行和卡片布局的示例。讨论涵盖当前结论、关键依据、负责人、计划日期与待确认风险。

- 结论：方案可以继续推进。
- 负责人：产品、前端与后端共同跟进。
- 下一步：完成联调后进行灰度验证。`
).join("\n\n");

function stateWith(
  overrides: Partial<SummaryWorkbenchViewState>
): SummaryWorkbenchViewState {
  return {
    ...initialState,
    ...overrides,
  };
}

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1040,
        height: "100vh",
        minHeight: 680,
        margin: "0 auto",
        background: "var(--wk-bg-base)",
      }}
    >
      {children}
    </div>
  );
}

const meta: Meta<typeof SummaryWorkbench> = {
  title: "Summary/SummaryWorkbench",
  component: SummaryWorkbench,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "统一智能总结入口的纯展示工作台。所有故事使用本地状态，不发起网络请求。",
      },
    },
  },
  decorators: [
    (Story: React.ComponentType) => (
      <I18nProvider>
        <StoryFrame>
          <Story />
        </StoryFrame>
      </I18nProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SummaryWorkbench>;

export const Initial: Story = {
  args: {
    state: initialState,
    actions: staticActions,
  },
};

export const PersonalWorkflowCompleted: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat, selectedTemplate, selectedTimeRange],
      messages: [
        {
          id: "personal-user",
          role: "user",
          content: "按项目周报模板总结本周讨论。",
        },
        {
          id: "personal-completed",
          role: "assistant",
          resultType: "workflow_completed",
          content: "总结已经生成，可以直接查看正式结果。",
        },
      ],
      card: {
        kind: "workflow_completed",
        taskId: 1286,
        taskTitle: "产品研发周会群 · 本周项目周报",
        isStale: false,
        actions: ["view_summary", "save_preview", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.workflowCompleted",
    }),
    actions: staticActions,
  },
};

export const TeamConfirmation: Story = {
  args: {
    state: stateWith({
      contextItems: [
        selectedChat,
        ...selectedParticipants,
        selectedTemplate,
        selectedTimeRange,
      ],
      messages: [
        {
          id: "team-user",
          role: "user",
          content: "邀请林晓和陈远一起确认本周项目总结。",
        },
        {
          id: "team-confirmation",
          role: "assistant",
          resultType: "workflow_confirmation",
          content: "邀请范围和总结要求已整理，请确认后发起多人总结。",
        },
      ],
      card: {
        kind: "team_confirmation",
        participantNames: ["林晓", "陈远"],
        requirement: "提炼本周关键决策、未决问题和每位参与者的下一步行动。",
        templateLabel: "项目周报",
        timeRangeLabel: "本周一至今天",
        isStale: false,
        actions: ["confirm_workflow", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.teamConfirmation",
    }),
    actions: staticActions,
  },
};

export const TeamWorkflowRunning: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat, ...selectedParticipants, selectedTemplate],
      messages: [
        {
          id: "team-running-user",
          role: "user",
          content: "确认邀请并发起多人总结。",
        },
        {
          id: "team-running",
          role: "assistant",
          resultType: "workflow_started",
          content: "邀请已发出，正在等待参与者补充并汇总结果。",
        },
      ],
      card: {
        kind: "workflow_started",
        taskId: 1291,
        taskTitle: "统一总结入口方案 · 多人协作总结",
        participantCount: 2,
        isStale: false,
        actions: ["view_progress", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.workflowRunning",
    }),
    actions: staticActions,
  },
};

export const AgentPreview: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat],
      messages: [
        {
          id: "preview-user",
          role: "user",
          content: "先帮我梳理本周讨论，重点突出风险。",
        },
        {
          id: "preview-agent",
          role: "assistant",
          resultType: "agent_preview",
          content: "我先按风险优先生成了一版预览，你可以继续提出修改要求。",
        },
      ],
      card: {
        kind: "agent_preview",
        version: 1,
        content: previewContent,
        assumptions: ["时间范围按最近 7 天处理", "只提取已经形成共识的行动项"],
        isStale: false,
        actions: ["save_preview", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.preview",
    }),
    actions: staticActions,
  },
};

export const AgentRevision: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat, selectedTimeRange],
      messages: [
        {
          id: "revision-user-1",
          role: "user",
          content: "先帮我总结，重点突出风险。",
        },
        {
          id: "revision-preview",
          role: "assistant",
          resultType: "agent_preview",
          content: "这是第一版预览。",
        },
        {
          id: "revision-user-2",
          role: "user",
          content: "再精简一点，并把下一步按负责人分组。",
        },
        {
          id: "revision-agent",
          role: "assistant",
          resultType: "agent_revision",
          content: "已按负责人重组并压缩重复信息。",
        },
      ],
      card: {
        kind: "agent_revision",
        version: 2,
        content: previewContent,
        assumptions: ["负责人以群内明确认领的信息为准"],
        isStale: false,
        actions: ["save_preview", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.preview",
    }),
    actions: staticActions,
  },
};

export const StalePreview: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat, selectedTemplate],
      messages: [
        {
          id: "stale-agent",
          role: "assistant",
          resultType: "agent_preview",
          content: "这版预览基于之前选择的会话范围生成。",
        },
      ],
      card: {
        kind: "agent_preview",
        version: 1,
        content: previewContent,
        assumptions: ["生成后会话或模板发生了变化"],
        isStale: true,
        actions: ["save_preview", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.scopeChanged",
    }),
    actions: staticActions,
  },
};

export const LongContent: Story = {
  args: {
    state: stateWith({
      contextItems: [selectedChat],
      messages: [
        {
          id: "long-user",
          role: "user",
          content:
            "生成一份覆盖全部主题的详细复盘，保留关键结论、负责人和风险。",
        },
        {
          id: "long-agent",
          role: "assistant",
          resultType: "agent_preview",
          content: "已生成详细版预览。",
        },
      ],
      card: {
        kind: "agent_preview",
        version: 1,
        content: longPreviewContent,
        assumptions: ["长内容仅用于验证滚动容器与卡片排版"],
        isStale: false,
        actions: ["save_preview", "continue_chat"],
      },
      placeholderKey: "summary.workbench.placeholder.preview",
    }),
    actions: staticActions,
  },
};

export const Panel440px: Story = {
  render: () => (
    <div style={{ width: 440, height: "100%", margin: "0 auto" }}>
      <SummaryWorkbench
        state={stateWith({
          layout: "panel",
          contextItems: [selectedChat, selectedTemplate],
          messages: [
            {
              id: "panel-user",
              role: "user",
              content: "总结今天的关键决策。",
            },
            {
              id: "panel-agent",
              role: "assistant",
              resultType: "agent_preview",
              content: "已生成适合侧边面板查看的预览。",
            },
          ],
          card: {
            kind: "agent_preview",
            version: 1,
            content: previewContent,
            assumptions: [],
            isStale: false,
            actions: ["save_preview", "continue_chat"],
          },
          placeholderKey: "summary.workbench.placeholder.preview",
        })}
        actions={staticActions}
      />
    </div>
  ),
};

const contextSamples: Record<
  SummaryWorkbenchContextKind,
  SummaryWorkbenchContextItem
> = {
  chat: selectedChat,
  participant: selectedParticipants[0],
  template: selectedTemplate,
  time_range: selectedTimeRange,
};

function InteractiveWorkbench() {
  const [contextItems, setContextItems] = React.useState<
    SummaryWorkbenchContextItem[]
  >([]);
  const [messages, setMessages] = React.useState<SummaryWorkbenchMessageView[]>(
    []
  );
  const [card, setCard] = React.useState<SummaryWorkbenchCardView>();
  const [inputValue, setInputValue] = React.useState("");

  const hasContext = (kind: SummaryWorkbenchContextKind) =>
    contextItems.some(
      (item: SummaryWorkbenchContextItem) => item.kind === kind
    );
  const hasPreview =
    card?.kind === "agent_preview" || card?.kind === "agent_revision";
  const placeholderKey =
    card?.kind === "team_confirmation"
      ? "summary.workbench.placeholder.teamConfirmation"
      : card?.kind === "workflow_started"
      ? "summary.workbench.placeholder.workflowRunning"
      : card?.kind === "workflow_completed"
      ? "summary.workbench.placeholder.workflowCompleted"
      : hasPreview
      ? "summary.workbench.placeholder.preview"
      : hasContext("participant")
      ? "summary.workbench.placeholder.participantsSelected"
      : hasContext("chat") && hasContext("template")
      ? "summary.workbench.placeholder.structuredReady"
      : hasContext("chat")
      ? "summary.workbench.placeholder.chatSelected"
      : "summary.workbench.placeholder.initial";

  const appendAssistantMessage = (
    resultType: SummaryWorkbenchMessageView["resultType"],
    content: string
  ) => {
    setMessages((current: SummaryWorkbenchMessageView[]) => [
      ...current,
      {
        id: `assistant-${current.length + 1}`,
        role: "assistant",
        resultType,
        content,
      },
    ]);
  };

  const expireScopeBoundCard = () => {
    setCard((current: SummaryWorkbenchCardView | undefined) => {
      if (
        !current ||
        (current.kind !== "agent_preview" &&
          current.kind !== "agent_revision" &&
          current.kind !== "team_confirmation")
      ) {
        return current;
      }

      return {
        ...current,
        isStale: true,
        actions: current.actions.filter(
          (action: SummaryWorkbenchAction) =>
            action !== "save_preview" && action !== "confirm_workflow"
        ),
      };
    });
  };

  const handleSend = () => {
    const requirement = inputValue.trim();
    if (!requirement) return;

    setMessages((current: SummaryWorkbenchMessageView[]) => [
      ...current,
      {
        id: `user-${current.length + 1}`,
        role: "user",
        content: requirement,
      },
    ]);
    setInputValue("");

    if (hasContext("chat") && hasContext("participant")) {
      setCard({
        kind: "team_confirmation",
        participantNames: contextItems
          .filter(
            (item: SummaryWorkbenchContextItem) => item.kind === "participant"
          )
          .map((item: SummaryWorkbenchContextItem) => item.label),
        requirement,
        templateLabel: contextItems.find(
          (item: SummaryWorkbenchContextItem) => item.kind === "template"
        )?.label,
        timeRangeLabel: contextItems.find(
          (item: SummaryWorkbenchContextItem) => item.kind === "time_range"
        )?.label,
        isStale: false,
        actions: ["confirm_workflow", "continue_chat"],
      });
      appendAssistantMessage(
        "workflow_confirmation",
        "我已整理邀请范围和总结要求，请确认后发起多人总结。"
      );
      return;
    }

    if (hasContext("chat") && hasContext("template")) {
      setCard({
        kind: "workflow_completed",
        taskId: 1302,
        taskTitle: `${selectedChat.label} · ${selectedTemplate.label}`,
        isStale: false,
        actions: ["view_summary"],
      });
      appendAssistantMessage(
        "workflow_completed",
        "需求明确，已通过快速总结工作流生成正式总结。"
      );
      return;
    }

    const nextVersion = hasPreview ? card.version + 1 : 1;
    const nextKind = hasPreview ? "agent_revision" : "agent_preview";
    setCard({
      kind: nextKind,
      version: nextVersion,
      content: `${previewContent}\n\n补充要求：${requirement}`,
      assumptions: hasContext("chat")
        ? ["总结范围使用当前选择的会话"]
        : ["未选择会话，示例使用当前对话上下文"],
      isStale: false,
      actions: ["save_preview", "continue_chat"],
    });
    appendAssistantMessage(
      nextKind,
      nextKind === "agent_revision"
        ? "我已根据新要求修订预览。"
        : "我先生成了一版预览，你可以继续补充或直接保存。"
    );
  };

  const handleResultAction = (action: SummaryWorkbenchAction) => {
    if (action === "confirm_workflow") {
      setCard({
        kind: "workflow_started",
        taskId: 1303,
        taskTitle: "产品研发周会群 · 多人协作总结",
        participantCount: contextItems.filter(
          (item: SummaryWorkbenchContextItem) => item.kind === "participant"
        ).length,
        isStale: false,
        actions: ["view_progress", "continue_chat"],
      });
      appendAssistantMessage(
        "workflow_started",
        "邀请已发出，多人总结任务正在进行。"
      );
      return;
    }

    if (action === "view_progress" && card?.kind === "workflow_started") {
      setCard({
        ...card,
        kind: "workflow_completed",
        actions: ["view_summary"],
      });
      appendAssistantMessage(
        "workflow_completed",
        "模拟任务已完成，可以查看正式总结。"
      );
      return;
    }

    if (action === "save_preview") {
      setCard({
        kind: "workflow_completed",
        taskId: 1304,
        taskTitle: "Agent 预览保存结果",
        isStale: false,
        actions: ["view_summary"],
      });
      appendAssistantMessage(
        "workflow_completed",
        "当前预览已模拟保存为正式总结。"
      );
      return;
    }

    if (action === "view_summary") {
      appendAssistantMessage("explanation", "这里将打开正式总结详情页。");
      return;
    }

    setInputValue("请继续根据以下要求调整：");
  };

  return (
    <SummaryWorkbench
      state={stateWith({
        contextItems,
        messages,
        card,
        inputValue,
        placeholderKey,
        canSend: inputValue.trim().length > 0,
      })}
      actions={{
        onInputChange: setInputValue,
        onSend: handleSend,
        onOpenContext: (kind: SummaryWorkbenchContextKind) => {
          const sample = contextSamples[kind];
          if (hasContext(kind)) return;
          setContextItems((current: SummaryWorkbenchContextItem[]) => [
            ...current,
            sample,
          ]);
          expireScopeBoundCard();
        },
        onRemoveContext: (kind: SummaryWorkbenchContextKind, id: string) => {
          const hasMatchingItem = contextItems.some(
            (item: SummaryWorkbenchContextItem) =>
              item.kind === kind && item.id === id
          );
          if (!hasMatchingItem) return;
          setContextItems((current: SummaryWorkbenchContextItem[]) =>
            current.filter(
              (item: SummaryWorkbenchContextItem) =>
                item.kind !== kind || item.id !== id
            )
          );
          expireScopeBoundCard();
        },
        onResultAction: handleResultAction,
      }}
    />
  );
}

export const InteractiveMock: Story = {
  render: () => <InteractiveWorkbench />,
  parameters: {
    docs: {
      description: {
        story:
          "点击范围按钮会加入本地示例；发送后由本地 Mock 模拟服务端返回三类 result_type，生产前端不自行决定路由。确认、查看进度和保存同样只更新本地状态。",
      },
    },
  },
};
