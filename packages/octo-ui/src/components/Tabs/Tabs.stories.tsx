import type { Meta, StoryObj } from "@storybook/react-vite";
import Badge from "../Badge";
import Tabs from "./index";

const meta: Meta<typeof Tabs> = {
  title: "Octo UI/Tabs",
  component: Tabs,
  parameters: {
    docs: {
      description: {
        component:
          "Generic tabs with line and segmented variants. Routing and business state stay with the caller.",
      },
    },
  },
  argTypes: {
    size: { control: "radio", options: ["md", "sm"] },
    variant: {
      control: "radio",
      options: ["line", "segmented", "segmented-plain"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const DesignVariants: Story = {
  name: "Design Variants",
  render: () => (
    <div style={{ display: "grid", gap: "var(--wk-sp-6)" }}>
      <style>{`
        .octo-ui-tabs-design-preview .octo-ui-tabs__tab:nth-child(3):not([aria-selected="true"]) {
          color: var(--octo-ui-tabs-hover-color);
        }
      `}</style>
      <section>
        <h3>Tab · 标签页 / 分栏（激活墨黑 · 高40 · 间距24）</h3>
        <div style={{ width: 520 }}>
          <Tabs
            aria-label="Line tabs"
            className="octo-ui-tabs-design-preview"
            defaultActiveKey="messages"
            items={[
              { key: "messages", label: "消息" },
              {
                key: "files",
                label: (
                  <span
                    aria-label="文件 12"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--wk-sp-1)",
                    }}
                  >
                    文件
                    <Badge count={12} variant="soft" aria-hidden />
                  </span>
                ),
              },
              { key: "members", label: "成员" },
              { key: "settings", label: "设置", isDisabled: true },
            ]}
          />
        </div>
      </section>

      <section>
        <h3>Segmented · 分段控件 · 样式一（滑块胶囊 / 有底色）</h3>
        <Tabs
          aria-label="Filled segmented tabs"
          variant="segmented"
          defaultActiveKey="list"
          items={[
            { key: "list", label: "列表" },
            { key: "board", label: "看板" },
            { key: "calendar", label: "日历" },
          ]}
        />
      </section>

      <section>
        <h3>Segmented · 分段控件 · 样式二（无底色 / 选中加底）</h3>
        <Tabs
          aria-label="Plain segmented tabs"
          variant="segmented-plain"
          defaultActiveKey="all"
          items={[
            {
              key: "all",
              label: (
                <>
                  <svg
                    aria-hidden
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      color: "var(--octo-ui-tabs-segmented-text-color)",
                    }}
                  >
                    <path
                      d="M2 4h12M2 8h12M2 12h12"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  全部
                </>
              ),
            },
            { key: "unread", label: "未读" },
            { key: "mentions", label: "@我" },
          ]}
        />
      </section>
    </div>
  ),
};
