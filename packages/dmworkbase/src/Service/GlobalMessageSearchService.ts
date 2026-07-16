import APIClient from "./APIClient";

export interface GlobalMessageGroupWire {
  channel_id?: string;
  channel_type?: number;
  parent_group_no?: string;
  group_name?: string;
  thread_id?: string;
  thread_name?: string;
  match_count?: number;
  match_count_approx?: boolean;
  latest_at?: string;
  preview?: unknown[];
}

export interface GlobalMessageGroupsDataWire {
  sequence?: number;
  query_id?: string;
  total_groups?: number;
  total_groups_approx?: boolean;
  groups?: GlobalMessageGroupWire[];
}

export interface GlobalMessageGroupsResponseWire {
  data?: GlobalMessageGroupsDataWire;
  pagination?: {
    has_more?: boolean;
    next_cursor?: string;
  };
}

export interface GlobalMessageGroupsRequest {
  keyword: string;
  sequence: number;
  filters: Record<string, unknown>;
}

const GlobalMessageSearchService = {
  searchGroups(
    request: GlobalMessageGroupsRequest,
    signal?: AbortSignal
  ): Promise<GlobalMessageGroupsResponseWire> {
    return APIClient.shared.post("messages/_search_global_groups", request, {
      signal,
    });
  },
};

export default GlobalMessageSearchService;
