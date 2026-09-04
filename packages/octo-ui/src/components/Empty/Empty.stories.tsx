import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IllustrationFailure,
  IllustrationNoAccess,
  IllustrationNoContent,
  IllustrationNoResult,
} from "@douyinfe/semi-illustrations";
import Button from "../Button";
import Empty from "./index";

const meta: Meta<typeof Empty> = {
  title: "Octo UI/Empty",
  component: Empty,
  parameters: {
    docs: {
      description: {
        component:
          "Empty primitive matched to Web Component Overview: Semi illustration slot, 150px illustration, 15/22 title, 13/20 description, and optional action area. Business copy, actions, and state decisions stay in business composition.",
      },
    },
  },
  argTypes: {
    illustration: { control: false },
    action: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof Empty>;

const cardStyle = {
  flex: "1 1 280px",
  minWidth: "280px",
  background: "var(--wk-bg-surface)",
  border: "1px solid var(--wk-border-default)",
  borderRadius: "calc(var(--wk-r-md) + var(--wk-sp-1))",
} as const;

export const Playground: Story = {
  args: {
    title: "暂无数据",
    description: "这里还什么都没有，先去新建一条试试吧",
    action: <Button variant="secondary">新建</Button>,
  },
};

export const DesignVariants: Story = {
  name: "Design Variants",
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--wk-sp-5)",
        alignItems: "flex-start",
      }}
    >
      <div style={cardStyle}>
        <Empty
          title="暂无数据"
          description="这里还什么都没有，先去新建一条试试吧"
          illustration={<IllustrationNoContent />}
          action={<Button variant="secondary">新建</Button>}
        />
      </div>
      <div style={cardStyle}>
        <Empty
          title="搜索无结果"
          description="没找到相关内容，换个关键词再试试"
          illustration={<IllustrationNoResult />}
          action={<Button variant="secondary">清空筛选</Button>}
        />
      </div>
      <div style={cardStyle}>
        <Empty
          title="暂无访问权限"
          description="你没有查看该内容的权限，可联系管理员开通"
          illustration={<IllustrationNoAccess />}
          action={<Button variant="secondary">申请权限</Button>}
        />
      </div>
      <div style={cardStyle}>
        <Empty
          title="网络连接失败"
          description="网络似乎出了点问题，请检查后重试"
          illustration={<IllustrationFailure />}
          action={<Button variant="secondary">重新加载</Button>}
        />
      </div>
    </div>
  ),
};

export const InlineText: Story = {
  name: "Inline Text",
  render: () => (
    <div
      style={{
        maxWidth: "440px",
        border: "1px solid var(--wk-border-default)",
        borderRadius: "calc(var(--wk-r-md) + var(--wk-sp-1))",
        background: "var(--wk-bg-surface)",
      }}
    >
      <Empty
        illustration={false}
        title="暂无数据"
        description="当前还没有任何内容"
      />
    </div>
  ),
};
