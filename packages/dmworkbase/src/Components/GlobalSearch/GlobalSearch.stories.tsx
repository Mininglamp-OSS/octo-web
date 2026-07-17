import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import GlobalSearch from "../../features/globalSearch/GlobalSearchPanel";
import GlobalSearchVM from "../../bridge/globalSearch/GlobalSearchVM";
import {
  defaultGlobalSearchFilters,
  type ChannelSearchItem,
  type GlobalSearchDataSource,
} from "../../Service/SearchTypes";

type ResultState = "ready" | "loading" | "empty" | "error";

const senders = [
  { uid: "alex", name: "Alex Chen" },
  { uid: "river", name: "River Zhang" },
];

function createFileItem(isLongText = false): ChannelSearchItem {
  const fileName = isLongText
    ? "octo-web-global-search-migration-verification-with-a-very-long-file-name.md"
    : "octo-web-search-migration.md";
  return {
    id: isLongText ? "file-long" : "file-default",
    messageId: isLongText ? "message-long" : "message-default",
    messageSeq: 128,
    channelId: "octo-web",
    channelType: 2,
    senderUid: "alex",
    timestamp: 1_787_155_200,
    kind: "file",
    text: fileName,
    file: {
      name: fileName,
      size: 2_457_600,
      extension: "md",
    },
  };
}

function createDataSource(
  state: ResultState,
  isLongText = false
): GlobalSearchDataSource {
  return {
    getSenders: () => senders,
    getSender: (uid) =>
      senders.find((sender) => sender.uid === uid) ?? { uid, name: uid },
    searchSenders: async () => senders,
    searchChannels: async () => [
      {
        channelId: "octo-web",
        channelType: 2,
        name: "OCTO Web 研发内部群",
      },
    ],
    getSelfUid: () => "story-user",
    searchMessages: async () => {
      if (state === "loading") {
        return new Promise(() => undefined);
      }
      if (state === "error") {
        throw new Error("story search failure");
      }
      return {
        items: state === "empty" ? [] : [createFileItem(isLongText)],
        hasMore: false,
      };
    },
    getFileTypeCategories: async () => [
      { key: "document", label: "Document", exts: ["md", "pdf", "docx"] },
    ],
  };
}

function createViewModel(keyword: string) {
  return () => {
    const vm = new GlobalSearchVM();
    vm.keyword = keyword;
    vm.selectedTabKey = "files";
    vm.didMount = () => undefined;
    vm.didUnMount = () => undefined;
    vm.requestSearch = () => undefined;
    return vm;
  };
}

const defaultKeyword = "octo";
const defaultArgs = {
  contentSearchEnabled: true,
  createViewModel: createViewModel(defaultKeyword),
  dataSource: createDataSource("ready"),
  initialState: {
    searchValue: defaultKeyword,
  },
  onLocateContentItem: () => undefined,
};

const meta = {
  title: "Chat/GlobalSearch",
  component: GlobalSearch,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{
          width: "min(100%, 1040px)",
          height: "720px",
          margin: "0 auto",
          background: "var(--wk-bg-surface)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: defaultArgs,
} satisfies Meta<typeof GlobalSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FiltersOpen: Story = {
  args: {
    initialState: {
      filterOpen: true,
      filters: {
        ...defaultGlobalSearchFilters(),
        senderUids: ["alex"],
        fileExts: ["md"],
      },
      searchValue: defaultKeyword,
    },
  },
};

export const Loading: Story = {
  args: {
    dataSource: createDataSource("loading"),
  },
};

export const Empty: Story = {
  args: {
    dataSource: createDataSource("empty"),
  },
};

export const Error: Story = {
  args: {
    dataSource: createDataSource("error"),
  },
};

export const LongText: Story = {
  args: {
    dataSource: createDataSource("ready", true),
    createViewModel: createViewModel(
      "migration verification with a deliberately long search keyword"
    ),
    initialState: {
      searchValue:
        "migration verification with a deliberately long search keyword",
    },
  },
};
