import type { ReactNode } from "react";

export type ContactsDirectorySectionKey = "groups" | "myBots" | "allContacts";

export interface ContactsDirectorySectionProps {
  sectionKey: ContactsDirectorySectionKey;
  expanded: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  children?: ReactNode;
  onToggle: (section: ContactsDirectorySectionKey) => void;
}

export interface ContactsDirectoryProps {
  children: ReactNode;
}
