import type { Meta, StoryObj } from "@storybook/react-vite";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import Button from "../Button";
import Tooltip from "./index";

const meta: Meta<typeof Tooltip> = {
  title: "Octo UI/Tooltip",
  component: Tooltip,
  parameters: {
    docs: {
      description: {
        component:
          "Component set 1134:8268. Fixed dark surface, no arrow or shadow, 320px wrapping, horizontal/vertical content layouts, and a 300ms opt-in delay.",
      },
    },
  },
  argTypes: {
    isDelayed: { control: "boolean" },
    isDisabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

const triggerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "calc(var(--wk-sp-4) + var(--wk-sp-4))",
  padding: "0 var(--wk-sp-3)",
  border: "1px dashed var(--wk-border-strong)",
  borderRadius: "var(--wk-r-sm)",
  background: "var(--wk-bg-surface)",
  color: "var(--wk-text-secondary)",
  font: "var(--wk-text-body)",
};

const Trigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button">
>(({ children, ...props }, ref) => (
  <button ref={ref} type="button" {...props} style={triggerStyle}>
    {children}
  </button>
));
Trigger.displayName = "TooltipTrigger";

const Row = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: "var(--wk-sp-10)",
      padding: "var(--wk-sp-6)",
    }}
  >
    {children}
  </div>
);

const TruncatedLine = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<"span">
>(({ children, ...props }, ref) => (
  <span
    ref={ref}
    {...props}
    style={{
      display: "block",
      maxWidth:
        "calc(var(--octo-ui-tooltip-max-width) - var(--wk-sp-10) - var(--wk-sp-10))",
      overflow: "hidden",
      color: "var(--wk-text-primary)",
      font: "var(--wk-text-body)",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
));
TruncatedLine.displayName = "TooltipTruncatedLine";

export const Playground: Story = {
  args: {
    content: "通讯录",
    children: <Trigger>Default · 单行</Trigger>,
  },
};

export const DesignVariants: Story = {
  name: "Design Variants",
  render: () => (
    <div style={{ display: "grid", gap: "var(--wk-sp-8)" }}>
      <section>
        <h3 style={{ margin: 0, paddingInline: "var(--wk-sp-6)" }}>Variants</h3>
        <Row>
          <Tooltip content="通讯录">
            <Trigger>Default · 单行</Trigger>
          </Tooltip>
          <Tooltip
            content={{
              title: "按标题查找",
              body: "在当前会话里按消息标题快速定位，支持模糊匹配",
            }}
          >
            <Trigger>Title · 带标题</Trigger>
          </Tooltip>
          <Tooltip content={{ body: "按标题查找", shortcut: "Ctrl/⌘ +⇧ + F" }}>
            <Trigger>Shortcut · 带快捷键</Trigger>
          </Tooltip>
          <Tooltip
            content={{
              body: "该功能需要开启权限",
              actions: (
                <Button size="sm" variant="secondary">
                  去开启
                </Button>
              ),
            }}
          >
            <Trigger>LinkButton · secondary</Trigger>
          </Tooltip>
          <Tooltip
            content={{
              body: "该功能需要开启权限",
              actions: (
                <Button size="sm" variant="text">
                  去开启
                </Button>
              ),
            }}
          >
            <Trigger>LinkButton · textbtn</Trigger>
          </Tooltip>
        </Row>
      </section>

      <section>
        <h3 style={{ margin: 0, paddingInline: "var(--wk-sp-6)" }}>
          Long Text & Vertical Layout
        </h3>
        <Row>
          <Tooltip content="标题最多显示 2 行，内容最多显示 3 行，如无则不显示；溢出做截断处理，hover 出 tooltip 提示全称">
            <Trigger>长文本</Trigger>
          </Tooltip>
          <Tooltip
            content={{
              body: (
                <>
                  <span>第一行内容</span>
                  <span>第二行内容</span>
                </>
              ),
              layout: "vertical",
            }}
          >
            <Trigger>竖排 Horizontal=no</Trigger>
          </Tooltip>
          <Tooltip
            content={{
              title: "新版消息流已上线",
              body: "支持左右气泡、表情反应、Thread 讨论，点下面看看改了什么",
              layout: "vertical",
              actions: (
                <>
                  <Button size="sm" variant="text">
                    查看更新
                  </Button>
                  <Button size="sm" variant="text">
                    知道了
                  </Button>
                </>
              ),
            }}
          >
            <Trigger>竖排 · 双 textbtn</Trigger>
          </Tooltip>
        </Row>
      </section>

      <section>
        <h3 style={{ margin: 0, paddingInline: "var(--wk-sp-6)" }}>
          Overflow Text
        </h3>
        <div
          style={{
            display: "grid",
            gap: "var(--wk-sp-2)",
            maxWidth:
              "calc(var(--octo-ui-tooltip-max-width) - var(--wk-sp-10) - var(--wk-sp-10))",
            padding: "var(--wk-sp-6)",
          }}
        >
          <Tooltip content="产品需求讨论群 · 后端架构与数据库选型专项讨论">
            <TruncatedLine>
              产品需求讨论群 · 后端架构与数据库选型专项讨论
            </TruncatedLine>
          </Tooltip>
          <Tooltip content="客户端-编辑器优化 / 画布需求讨论 / 内容库迭代">
            <TruncatedLine>
              客户端-编辑器优化 / 画布需求讨论 / 内容库迭代
            </TruncatedLine>
          </Tooltip>
        </div>
      </section>

      <section>
        <h3 style={{ margin: 0, paddingInline: "var(--wk-sp-6)" }}>
          Trigger Timing
        </h3>
        <Row>
          <Tooltip content="立刻出现">
            <Trigger>默认 · 滑过即显</Trigger>
          </Tooltip>
          <Tooltip content="停留满 0.3s 才出现" isDelayed>
            <Trigger>特例 · 延时 0.3s</Trigger>
          </Tooltip>
        </Row>
      </section>
    </div>
  ),
};

export const LongAndVertical: Story = {
  name: "Long Text & Vertical",
  render: () => (
    <Row>
      <Tooltip content="标题最多显示 2 行，内容最多显示 3 行，如无则不显示；溢出做截断处理，hover 出 tooltip 提示全称">
        <Trigger>长文本</Trigger>
      </Tooltip>
      <Tooltip
        content={{
          body: (
            <>
              <span>第一行内容</span>
              <span>第二行内容</span>
            </>
          ),
          layout: "vertical",
        }}
      >
        <Trigger>竖排 Horizontal=no</Trigger>
      </Tooltip>
      <Tooltip
        content={{
          title: "新版消息流已上线",
          body: "支持左右气泡、表情反应、Thread 讨论，点下面看看改了什么",
          layout: "vertical",
          actions: (
            <>
              <Button size="sm" variant="text">
                查看更新
              </Button>
              <Button size="sm" variant="text">
                知道了
              </Button>
            </>
          ),
        }}
      >
        <Trigger>竖排 · 双 textbtn</Trigger>
      </Tooltip>
    </Row>
  ),
};

export const OverflowText: Story = {
  name: "Overflow Text",
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "var(--wk-sp-2)",
        maxWidth:
          "calc(var(--octo-ui-tooltip-max-width) - var(--wk-sp-10) - var(--wk-sp-10))",
        padding: "var(--wk-sp-6)",
      }}
    >
      <Tooltip content="产品需求讨论群 · 后端架构与数据库选型专项讨论">
        <TruncatedLine>
          产品需求讨论群 · 后端架构与数据库选型专项讨论
        </TruncatedLine>
      </Tooltip>
      <Tooltip content="客户端-编辑器优化 / 画布需求讨论 / 内容库迭代">
        <TruncatedLine>
          客户端-编辑器优化 / 画布需求讨论 / 内容库迭代
        </TruncatedLine>
      </Tooltip>
    </div>
  ),
};

export const Timing: Story = {
  name: "Trigger Timing",
  render: () => (
    <Row>
      <Tooltip content="立刻出现">
        <Trigger>默认 · 滑过即显</Trigger>
      </Tooltip>
      <Tooltip content="停留满 0.3s 才出现" isDelayed>
        <Trigger>特例 · 延时 0.3s</Trigger>
      </Tooltip>
    </Row>
  ),
};

export const TechnicalAutoFlip: Story = {
  name: "Technical · Auto Flip",
  parameters: { layout: "fullscreen" },
  render: () => (
    <div
      style={{
        position: "relative",
        minHeight: "var(--octo-ui-tooltip-max-width)",
        background: "var(--wk-bg-base)",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: "50%" }}>
        <Tooltip content="默认向上；空间不足时自动翻到下方">
          <Trigger>顶部边缘</Trigger>
        </Tooltip>
      </div>
    </div>
  ),
};
