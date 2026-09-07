import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import Avatar from "./index";

const meta: Meta<typeof Avatar> = {
  title: "Octo UI/Avatar",
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component:
          "Pure visual avatar. User, channel, upload, presence, navigation, and SDK responsibilities remain with business adapters.",
      },
    },
  },
  argTypes: {
    kind: { control: "radio", options: ["person", "group"] },
    size: { control: "radio", options: [16, 20, 28, 32, 40] },
    tone: { control: "radio", options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

const Row = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: "var(--wk-sp-3)",
    }}
  >
    {children}
  </div>
);

export const Playground: Story = {
  args: {
    alt: "刘一",
    fallbackText: "刘一",
    kind: "person",
    size: 32,
    tone: 0,
  },
};

export const PersonPalette: Story = {
  render: () => (
    <Row>
      {[
        "刘一",
        "张三",
        "王五",
        "李四",
        "陈七",
        "AB",
        "CD",
        "赵九",
        "孙二",
        "郑十",
      ].map((name, tone) => (
        <Avatar
          key={name}
          alt={name}
          fallbackText={name}
          tone={tone as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}
        />
      ))}
    </Row>
  ),
};

export const GroupPalette: Story = {
  render: () => (
    <Row>
      {[
        "架构讨论",
        "三个字",
        "abcd",
        "云服务",
        "发",
        "efgh",
        "开发",
        "支",
        "igkl",
      ].map((name, tone) => (
        <Avatar
          key={name}
          alt={name}
          fallbackText={name}
          kind="group"
          tone={tone as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}
        />
      ))}
      <Avatar alt="Unnamed group" kind="group" tone={9} />
    </Row>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Row>
      {[40, 32, 28, 20, 16].map((size) => (
        <Avatar
          key={size}
          alt={`${size}px avatar`}
          fallbackText="刘"
          size={size as 16 | 20 | 28 | 32 | 40}
          tone={8}
        />
      ))}
    </Row>
  ),
};

export const ImagesAndFallbacks: Story = {
  render: () => (
    <Row>
      {[40, 32, 28, 20, 16].map((size, index) => (
        <Avatar
          key={size}
          src={`https://i.pravatar.cc/${size}?img=${index + 1}`}
          alt={`${size}px photo avatar`}
          fallbackText="图"
          size={size as 16 | 20 | 28 | 32 | 40}
        />
      ))}
      <Avatar
        src="/intentionally-missing-avatar.png"
        alt="Broken image fallback"
        fallbackText="兜底"
        tone={6}
      />
    </Row>
  ),
};
