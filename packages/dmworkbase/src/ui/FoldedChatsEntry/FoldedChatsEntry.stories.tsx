import type { Meta, StoryObj } from "@storybook/react-vite"
import FoldedChatsEntry from "./index"
const meta: Meta<typeof FoldedChatsEntry> = { title: "UI/FoldedChatsEntry", component: FoldedChatsEntry, args: { title: "折叠的聊天", mentionLabel: "@我", unread: 12, hasUnread: true, mention: false, onClick: () => {} } }
export default meta
 type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Mention: Story = { args: { mention: true } }
export const Muted: Story = { args: { unread: 0 } }
export const Read: Story = { args: { unread: 0, hasUnread: false } }
export const English: Story = { args: { title: "Folded chats", mentionLabel: "@Me", unread: 120, mention: true } }
