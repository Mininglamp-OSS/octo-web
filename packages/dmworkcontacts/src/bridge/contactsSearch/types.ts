import type { SpaceMember } from "@octo/base/src/Service/SpaceService";

export interface ContactsSearchBot {
  uid: string;
  name?: string;
  robot?: number;
  avatar?: string;
  status?: string;
  description?: string;
}

export interface ContactsSearchGroup {
  group_no: string;
  name?: string;
  member_count?: number;
}

export interface ContactsSearchSource {
  spaceMembers: SpaceMember[];
  spaceBots: ContactsSearchBot[];
  myGroups: ContactsSearchGroup[];
  currentUid: string;
}

export interface ContactsSearchResult {
  contacts: Array<SpaceMember | ContactsSearchBot>;
  groups: ContactsSearchGroup[];
}
