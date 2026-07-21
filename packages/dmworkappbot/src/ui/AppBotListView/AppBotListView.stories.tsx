import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import AppBotListView, { AppBotListViewProps } from "."
import "./index.css"

const sampleBots = [
  {
    id: "platform-doc",
    uid: "robot_platform_doc",
    displayName: "Knowledge Assistant",
    description: "Answers questions from platform documentation and workspace notes.",
    scope: "platform" as const,
  },
  {
    id: "space-report",
    uid: "robot_space_report",
    displayName: "Weekly Report Bot",
    description: "Creates recurring project updates for the current Space.",
    scope: "space" as const,
  },
]

function PreviewAvatar({ name }: { name: string }) {
  return <div className="appbot-story-avatar">{name.slice(0, 1)}</div>
}

function Preview(args: AppBotListViewProps) {
  return (
    <div className="appbot-story-frame">
      <AppBotListView {...args} />
    </div>
  )
}

const baseArgs: AppBotListViewProps = {
  title: "Apps",
  searchPlaceholder: "Search",
  keyword: "",
  state: "ready",
  sections: [
    { key: "platform", title: "Platform apps", bots: [sampleBots[0]] },
    { key: "space", title: "Space apps · Product", bots: [sampleBots[1]] },
  ],
  selectedUid: "",
  loadingText: "Loading...",
  loadFailedText: "Failed to load",
  retryLabel: "Retry",
  emptyText: "No apps available",
  noMatchesText: "No matching apps found",
  defaultDescription: "App Bot",
  onKeywordChange: () => undefined,
  onRetry: () => undefined,
  onSelect: () => undefined,
  renderAvatar: (bot) => <PreviewAvatar name={bot.displayName} />,
}

const meta: Meta<typeof Preview> = {
  title: "Business/AppBot/AppBotListView",
  component: Preview,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof Preview>

export const Default: Story = {
  name: "Default",
}

export const Loading: Story = {
  name: "Loading",
  args: {
    state: "loading",
  },
}

export const Error: Story = {
  name: "Error",
  args: {
    state: "error",
  },
}

export const Empty: Story = {
  name: "Empty",
  args: {
    sections: [
      { key: "platform", title: "Platform apps", bots: [] },
      { key: "space", title: "Space apps", bots: [] },
    ],
  },
}

export const NoMatches: Story = {
  name: "No matches",
  args: {
    keyword: "finance",
    sections: [
      { key: "platform", title: "Platform apps", bots: [] },
      { key: "space", title: "Space apps", bots: [] },
    ],
  },
}

export const LongText: Story = {
  name: "Long text",
  args: {
    sections: [
      {
        key: "platform",
        title: "Platform apps",
        bots: [{
          ...sampleBots[0],
          displayName: "A very long application bot name that should truncate cleanly",
          description: "A long description that explains a complicated automation flow without expanding the sidebar or pushing controls out of place.",
        }],
      },
      { key: "space", title: "Space apps · Product", bots: [sampleBots[1]] },
    ],
  },
}
