import type { Meta, StoryObj } from "@storybook/react-vite";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { I18nProvider } from "../../i18n";
import ChannelSearchPanel from "./index";
import { mockChannelSearchDataSource } from "./ChannelSearch.stories.mock";
import type { ChannelSearchFilters } from "./types";

const toSeconds = (value: string) =>
  Math.floor(new Date(value).getTime() / 1000);

const previewChannel = new Channel(
  "storybook-channel-search",
  ChannelTypeGroup
);
const previewFilter: ChannelSearchFilters = {
  senderUids: [
    "lilei",
    "litian",
    "wangduoyu",
    "jokequeen",
    "director",
    "zhanghui",
  ],
  sort: "time_asc",
  datePreset: "last_7_days",
  startAt: toSeconds("2026-06-01T00:00:00+08:00"),
  endAt: toSeconds("2026-06-08T23:59:59+08:00"),
};
const mediaPreviewFilter: ChannelSearchFilters = {
  senderUids: ["liubo", "zhangxingchao"],
  sort: "time_desc",
  datePreset: "last_7_days",
  startAt: toSeconds("2026-06-01T00:00:00+08:00"),
  endAt: toSeconds("2026-06-08T23:59:59+08:00"),
};
const filterOnlyPreviewFilter: ChannelSearchFilters = {
  senderUids: [],
  sort: "time_desc",
  startAt: toSeconds("2026-06-01T00:00:00+08:00"),
  endAt: toSeconds("2026-06-03T23:59:59+08:00"),
};

const meta: Meta<typeof ChannelSearchPanel> = {
  title: "Chat/ChannelSearch",
  component: ChannelSearchPanel,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story, context) => (
      <I18nProvider>
        {context.parameters.channelSearchShell ? (
          <Story />
        ) : (
          <div
            style={{
              width: 480,
              height: "100vh",
              marginLeft: "auto",
              borderLeft: "1px solid var(--wk-border-subtle)",
              background: "var(--wk-bg-surface)",
            }}
          >
            <Story />
          </div>
        )}
      </I18nProvider>
    ),
  ],
  args: {
    channel: previewChannel,
    dataSource: mockChannelSearchDataSource,
    onClose: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof ChannelSearchPanel>;

const ChatSearchEntryPreview: React.FC<
  React.ComponentProps<typeof ChannelSearchPanel>
> = (args) => {
  const [open, setOpen] = React.useState(false);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--wk-bg-base)",
        color: "var(--wk-text-primary)",
      }}
    >
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: 24,
          background: "var(--wk-bg-base)",
        }}
      >
        <button
          data-testid="channel-search-entry"
          style={{
            height: 36,
            padding: "0 14px",
            border: "1px solid var(--wk-border-default)",
            borderRadius: 6,
            background: "var(--wk-bg-surface)",
            color: "var(--wk-text-primary)",
            cursor: "pointer",
            font: "400 14px/20px var(--wk-font-sans)",
          }}
          type="button"
          onClick={() => setOpen(true)}
        >
          查找聊天内容
        </button>
      </main>
      {open && (
        <aside
          style={{
            width: 480,
            height: "100vh",
            borderLeft: "1px solid var(--wk-border-subtle)",
            background: "var(--wk-bg-surface)",
          }}
        >
          <ChannelSearchPanel {...args} onClose={() => setOpen(false)} />
        </aside>
      )}
    </div>
  );
};

async function waitForElement<T extends Element>(
  root: HTMLElement,
  selector: string
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const element = root.querySelector<T>(selector);
    if (element) return element;
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
  }
  throw new Error(`Expected ${selector} to render`);
}

async function waitForElementToClose(
  root: HTMLElement,
  selector: string
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    if (!root.querySelector(selector)) return;
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
  }
  throw new Error(`Expected ${selector} to close`);
}

export const Default: Story = {
  name: "Entry closed",
  parameters: {
    channelSearchShell: true,
  },
  render: (args) => <ChatSearchEntryPreview {...args} />,
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, "[data-testid='channel-search-entry']");
    if (canvasElement.querySelector(".wk-channel-search-panel")) {
      throw new Error("Expected search panel to stay closed by default");
    }
  },
};

export const OpenEmpty: Story = {
  name: "Open default results",
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-result-list");
    if (
      canvasElement.querySelectorAll(".wk-channel-search-result").length === 0
    ) {
      throw new Error("Expected empty keyword to browse default results");
    }
  },
};

export const AllResults: Story = {
  name: "All results",
  args: {
    initialState: {
      keyword: "哈哈",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-result-list");
    if (
      canvasElement.querySelectorAll(".wk-channel-search-result").length === 0
    ) {
      throw new Error("Expected all results to render");
    }
  },
};

export const MessageResults: Story = {
  name: "Message results",
  args: {
    initialState: {
      activeTab: "message",
      keyword: "哈哈",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-message-result");
  },
};

export const FilterOpen: Story = {
  name: "Filter open",
  args: {
    initialState: {
      filterOpen: true,
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-filter-popover");
    const filterTrigger = await waitForElement<HTMLElement>(
      canvasElement,
      ".wk-channel-search-filter-trigger"
    );
    const filterIcon = filterTrigger.querySelector("svg");
    if (!filterIcon) {
      throw new Error("Expected filter trigger icon to render");
    }
    if (
      window.getComputedStyle(filterIcon).color !==
      window.getComputedStyle(filterTrigger).color
    ) {
      throw new Error("Expected filter icon to inherit trigger color");
    }

    const sortField = await waitForElement<HTMLElement>(
      canvasElement,
      ".wk-channel-search-select-field"
    );
    await userEvent.click(sortField);
    await waitForElement(canvasElement, ".wk-channel-search-select-menu");

    const sendTimeTitle = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        ".wk-channel-search-filter-title"
      )
    ).find((item) => item.textContent?.includes("发送时间"));
    if (!sendTimeTitle) {
      throw new Error("Expected send time section title to render");
    }
    await userEvent.click(sendTimeTitle);
    await waitForElementToClose(
      canvasElement,
      ".wk-channel-search-select-menu"
    );

    const dateTriggers = canvasElement.querySelectorAll(
      ".wk-channel-search-date-input"
    );
    if (dateTriggers.length !== 2) {
      throw new Error("Expected start and end date picker triggers to render");
    }
    const dateTriggerText = Array.from(dateTriggers)
      .map((item) => item.textContent?.trim())
      .join(" ");
    if (
      !dateTriggerText.includes("开始日期") ||
      !dateTriggerText.includes("结束日期")
    ) {
      throw new Error("Expected date picker placeholders to render");
    }
  },
};

export const FilterApplied: Story = {
  name: "Filter applied",
  args: {
    initialState: {
      filterOpen: true,
      filters: previewFilter,
      keyword: "哈哈",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-filter-chip");
    if (
      canvasElement
        .querySelector(".wk-channel-search-filter-trigger")
        ?.textContent?.trim() !== "筛选3"
    ) {
      throw new Error(
        "Expected filter trigger to show selected condition count"
      );
    }
    if (
      canvasElement.querySelectorAll(".wk-channel-search-filter-chip")
        .length !== 6
    ) {
      throw new Error("Expected selected senders to render as chips");
    }
    if (
      canvasElement.querySelectorAll(".wk-channel-search-filter-clear-section")
        .length !== 3
    ) {
      throw new Error(
        "Expected each active filter section to show clear action"
      );
    }
    if (canvasElement.querySelector(".wk-channel-search-filter-senders")) {
      throw new Error("Expected sender dropdown to stay closed by default");
    }
  },
};

export const FilterOnlyResults: Story = {
  name: "Filter only results",
  args: {
    initialState: {
      filters: filterOnlyPreviewFilter,
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-result-list");
    if (
      canvasElement
        .querySelector(".wk-channel-search-filter-trigger")
        ?.textContent?.trim() !== "筛选1"
    ) {
      throw new Error("Expected date-only filter to count as one condition");
    }
    if (
      canvasElement.querySelectorAll(".wk-channel-search-result").length === 0
    ) {
      throw new Error("Expected filter-only search to request results");
    }
  },
};

export const FilterSenderSearchOpen: Story = {
  name: "Filter sender search open",
  args: {
    initialState: {
      filterOpen: true,
    },
  },
  play: async ({ canvasElement }) => {
    const senderInput = await waitForElement<HTMLInputElement>(
      canvasElement,
      ".wk-channel-search-sender-field input"
    );
    await userEvent.click(senderInput);
    await waitForElement(canvasElement, ".wk-channel-search-filter-senders");

    await userEvent.type(senderInput, "张");

    const options = await waitForElement(
      canvasElement,
      ".wk-channel-search-filter-senders"
    );
    const zhangxingchao = Array.from(
      options.querySelectorAll<HTMLButtonElement>("button")
    ).find((option) => option.textContent?.includes("张兴朝"));
    if (!zhangxingchao) {
      throw new Error("Expected sender search to filter matching members");
    }
    await userEvent.click(zhangxingchao);
    if (senderInput.value !== "") {
      throw new Error("Expected sender keyword to clear after selecting");
    }
    if (
      !canvasElement
        .querySelector(".wk-channel-search-filter-senders button.is-selected")
        ?.textContent?.includes("张兴朝")
    ) {
      throw new Error("Expected selected sender option to show checkbox state");
    }
  },
};

export const MediaGrid: Story = {
  name: "Media grid",
  args: {
    initialState: {
      activeTab: "media",
      keyword: "哈哈",
    },
  },
  play: async ({ canvasElement }) => {
    const tip = await waitForElement(
      canvasElement,
      ".wk-channel-search-media-tip"
    );
    if (!tip.textContent?.includes("图片和视频暂不支持")) {
      throw new Error("Expected media tab to explain keyword is unsupported");
    }
    await waitForElement(canvasElement, ".wk-channel-search-media-grid");
  },
};

export const MediaFilterOnly: Story = {
  name: "Media filter only",
  args: {
    initialState: {
      activeTab: "media",
      keyword: "哈哈",
      filters: mediaPreviewFilter,
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-media-tip");
    await waitForElement(canvasElement, ".wk-channel-search-media-grid");
    if (
      canvasElement
        .querySelector(".wk-channel-search-media-thumb")
        ?.getAttribute("title")
    ) {
      throw new Error("Expected media thumbnails to avoid name tooltips");
    }
  },
};

export const FileList: Story = {
  name: "File list",
  args: {
    initialState: {
      activeTab: "file",
      keyword: "pdf",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-file-list");
    await waitForElement(canvasElement, ".wk-channel-search-file-result");
  },
};

export const FileBrowseWithoutKeyword: Story = {
  name: "File browse without keyword",
  args: {
    initialState: {
      activeTab: "file",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-file-list");
    await waitForElement(canvasElement, ".wk-channel-search-file-result");
  },
};

export const FileMenuOpen: Story = {
  name: "File menu open",
  args: {
    initialState: {
      activeTab: "file",
      keyword: "pdf",
    },
  },
  play: async ({ canvasElement }) => {
    const menuButton = await waitForElement<HTMLElement>(
      canvasElement,
      ".wk-channel-search-file-menu-wrap .wk-iconclick"
    );
    menuButton.click();
    await waitForElement(canvasElement, ".wk-channel-search-file-menu");
    if (
      canvasElement.querySelectorAll(".wk-channel-search-file-menu button")
        .length !== 2
    ) {
      throw new Error("Expected file menu actions to render");
    }
  },
};

export const FileMenuClosesOnFilter: Story = {
  name: "File menu closes on filter",
  args: {
    initialState: {
      activeTab: "file",
      keyword: "pdf",
    },
  },
  play: async ({ canvasElement }) => {
    const menuButton = await waitForElement<HTMLElement>(
      canvasElement,
      ".wk-channel-search-file-menu-wrap .wk-iconclick"
    );
    menuButton.click();
    await waitForElement(canvasElement, ".wk-channel-search-file-menu");

    const filterButton = await waitForElement<HTMLElement>(
      canvasElement,
      ".wk-channel-search-filter-trigger"
    );
    filterButton.click();
    await waitForElement(canvasElement, ".wk-channel-search-filter-popover");

    if (canvasElement.querySelector(".wk-channel-search-file-menu")) {
      throw new Error("Expected file menu to close before opening filter");
    }
  },
};

export const NoResults: Story = {
  name: "No results",
  args: {
    initialState: {
      keyword: "not-found",
    },
  },
  play: async ({ canvasElement }) => {
    await waitForElement(canvasElement, ".wk-channel-search-empty");
  },
};
