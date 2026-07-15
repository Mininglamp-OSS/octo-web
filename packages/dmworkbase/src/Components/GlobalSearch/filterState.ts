import type { GlobalSearchFilters } from "./types";

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
