import type { ReactNode } from "react";

export interface ContactsSearchCopy {
  placeholder: string;
  emptyText: string;
  contactsTitle: string;
  groupsTitle: string;
}

export interface ContactsSearchState {
  keyword: string;
  isSearching: boolean;
  hasResults: boolean;
}

export interface ContactsSearchResults {
  contacts?: ReactNode;
  groups?: ReactNode;
}

export interface ContactsSearchProps {
  copy: ContactsSearchCopy;
  state: ContactsSearchState;
  results: ContactsSearchResults;
  onKeywordChange: (value: string) => void;
  onClear: () => void;
}
