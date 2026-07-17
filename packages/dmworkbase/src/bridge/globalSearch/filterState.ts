import type {
  GlobalContentTab,
  GlobalSearchFilters,
} from "../../Service/SearchTypes";

export function hasGlobalSearchCriteria(
  tab: GlobalContentTab,
  keyword: string,
  filters: GlobalSearchFilters
) {
  if (keyword.trim().length > 0) return true;
  if (
    filters.senderUids.length > 0 ||
    filters.memberUids.length > 0 ||
    filters.channels.length > 0 ||
    filters.channelTypes.length > 0 ||
    filters.sort !== "time_desc" ||
    filters.datePreset ||
    filters.startAt ||
    filters.endAt
  ) {
    return true;
  }
  if (tab === "messages") return filters.contentTypes.length > 0;
  return (
    filters.fileExts.length > 0 ||
    (typeof filters.fileSizeMin === "number" && filters.fileSizeMin > 0) ||
    (typeof filters.fileSizeMax === "number" && filters.fileSizeMax > 0)
  );
}

// Independent of activeChannelSearchFilterCount: covers channels /
// channelTypes / contentTypes / fileExts / fileSize / memberUids as well as
// the base sender + date + sort fields.
export function activeGlobalSearchFilterCount(filters: GlobalSearchFilters) {
  let count = 0;
  if (filters.senderUids.length > 0) count += 1;
  if (filters.memberUids.length > 0) count += 1;
  if (filters.channels.length > 0) count += 1;
  if (filters.channelTypes.length > 0) count += 1;
  if (filters.contentTypes.length > 0) count += 1;
  if (filters.fileExts.length > 0) count += 1;
  if (
    (typeof filters.fileSizeMin === "number" && filters.fileSizeMin > 0) ||
    (typeof filters.fileSizeMax === "number" && filters.fileSizeMax > 0)
  ) {
    count += 1;
  }
  if (filters.sort !== "time_desc") count += 1;
  if (filters.datePreset || filters.startAt || filters.endAt) count += 1;
  return count;
}

// WeCom-style badge count: count every selected value, not merely every
// active dimension. For example sender(1) + member(1) + chat types(2) +
// message types(2) is displayed as 6.
export function selectedGlobalSearchFilterValueCount(
  filters: GlobalSearchFilters
) {
  let count =
    filters.senderUids.length +
    filters.memberUids.length +
    filters.channels.length +
    filters.contentTypes.length +
    filters.fileExts.length;
  if (filters.channelTypes.includes(1)) count += 1;
  if (filters.channelTypes.includes(2) || filters.channelTypes.includes(5)) {
    count += 1;
  }
  if (
    (typeof filters.fileSizeMin === "number" && filters.fileSizeMin > 0) ||
    (typeof filters.fileSizeMax === "number" && filters.fileSizeMax > 0)
  ) {
    count += 1;
  }
  if (filters.sort !== "time_desc") count += 1;
  if (filters.datePreset || filters.startAt || filters.endAt) count += 1;
  return count;
}
