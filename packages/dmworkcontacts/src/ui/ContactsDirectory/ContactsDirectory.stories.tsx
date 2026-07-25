import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { Bot, Users, UsersRound } from "lucide-react";
import ContactsDirectory, { ContactsDirectorySection } from "./index";

const meta: Meta<typeof ContactsDirectory> = {
  title: "Contacts/ContactsDirectory",
  component: ContactsDirectory,
  parameters: {
    docs: {
      description: {
        component:
          "通讯录群聊、已添加 AI 和全部联系人三个手风琴区的纯 UI 外壳，不读取 WKSDK 或业务数据。",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ContactsDirectory>;

const onToggle = () => undefined;

function sectionSet(expanded: "groups" | "myBots" | "allContacts" | null) {
  return (
    <>
      <ContactsDirectorySection
        sectionKey="groups"
        expanded={expanded === "groups"}
        icon={<UsersRound size={16} />}
        label="群聊"
        count={8}
        onToggle={onToggle}
      >
        <div className="wk-contacts-section-item">产品交流群</div>
      </ContactsDirectorySection>
      <ContactsDirectorySection
        sectionKey="myBots"
        expanded={expanded === "myBots"}
        icon={<Bot size={16} />}
        label="已添加 AI"
        count={3}
        onToggle={onToggle}
      >
        <div className="wk-contacts-section-item">Octo AI</div>
      </ContactsDirectorySection>
      <ContactsDirectorySection
        sectionKey="allContacts"
        expanded={expanded === "allContacts"}
        icon={<Users size={16} />}
        label="全部联系人"
        count={128}
        onToggle={onToggle}
      >
        <div className="wk-contacts-section-item">联系人列表区域</div>
      </ContactsDirectorySection>
    </>
  );
}

export const Default: Story = { args: { children: sectionSet("allContacts") } };

export const AllVariants: Story = { args: { children: sectionSet("groups") } };

export const States: Story = { args: { children: sectionSet(null) } };

export const EdgeCases: Story = {
  args: {
    children: (
      <ContactsDirectorySection
        sectionKey="allContacts"
        expanded
        icon={<Users size={16} />}
        label="名称很长的全部联系人分组"
        count={10_000}
        onToggle={onToggle}
      >
        <div className="wk-contacts-section-item">名称很长的联系人内容区域</div>
      </ContactsDirectorySection>
    ),
  },
};
